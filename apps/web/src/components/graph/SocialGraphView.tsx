/**
 * SocialGraphView - Force-directed social graph visualization
 *
 * Displays in main workspace (not side panel).
 * Visualizes Facebook relationship graph:
 * - Nodes: People (sized by connection weight)
 * - Edges: Relationships (colored by type)
 *
 * Uses d3-force for layout, React+SVG for rendering.
 * All styling uses design tokens - NO hardcoded values.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import { getArchiveServerUrl } from '../../lib/platform';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  weight: number;
  relationshipCount: number;
  isFriend: boolean;
  isDiscovered: boolean;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  id: string;
  type: string;
  weight: number;
}

interface TopConnection {
  person: {
    id: string;
    name: string;
    is_friend: boolean | number;
  };
  total_weight: number;
  relationship_count: number;
}

interface RelationshipStats {
  totalRelationships: number;
  avgWeight: number;
  byType: Array<{ relationship_type: string; count: number; avg_weight: number }>;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

interface SocialGraphViewProps {
  onClose: () => void;
}

export function SocialGraphView({ onClose }: SocialGraphViewProps) {
  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [stats, setStats] = useState<RelationshipStats | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [maxNodes, setMaxNodes] = useState(100);
  const [showLabels, setShowLabels] = useState(true);
  const [linkOpacity, setLinkOpacity] = useState(0.4);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);

  // Zoom and pan state
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Fetch data on mount or when maxNodes changes
  useEffect(() => {
    fetchGraphData();
  }, [maxNodes]);

  const fetchGraphData = async () => {
    setLoading(true);
    setError(null);

    try {
      const archiveServer = await getArchiveServerUrl();
      const [connectionsRes, statsRes] = await Promise.all([
        fetch(`${archiveServer}/api/facebook/graph/top-connections?limit=${maxNodes}`),
        fetch(`${archiveServer}/api/facebook/graph/relationships/stats`),
      ]);

      if (!connectionsRes.ok) throw new Error('Failed to fetch connections');
      if (!statsRes.ok) throw new Error('Failed to fetch stats');

      const connectionsData = await connectionsRes.json();
      const statsResult = await statsRes.json();

      const connections: TopConnection[] = connectionsData.connections || connectionsData;
      const statsData: RelationshipStats = statsResult.stats || statsResult;

      setStats(statsData);

      // Build node map
      const nodeMap = new Map<string, GraphNode>();

      // Self node at center
      const selfId = 'fb_person_self';
      nodeMap.set(selfId, {
        id: selfId,
        name: 'You',
        weight: 10000,
        relationshipCount: connections.length,
        isFriend: true,
        isDiscovered: false,
        x: 0,
        y: 0,
        fx: 0,
        fy: 0,
      });

      // Connected people
      for (const conn of connections) {
        const isFriend = conn.person.is_friend === true || conn.person.is_friend === 1;
        nodeMap.set(conn.person.id, {
          id: conn.person.id,
          name: conn.person.name,
          weight: conn.total_weight,
          relationshipCount: conn.relationship_count,
          isFriend,
          isDiscovered: !isFriend,
        });
      }

      // Links from self to each person
      const linksData: GraphLink[] = connections.map(conn => ({
        id: `${selfId}_${conn.person.id}`,
        source: selfId,
        target: conn.person.id,
        type: 'connection',
        weight: conn.total_weight,
      }));

      setNodes(Array.from(nodeMap.values()));
      setLinks(linksData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  };

  // Initialize force simulation
  useEffect(() => {
    if (nodes.length === 0 || !containerRef.current) return;

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 600;

    const simulation = forceSimulation<GraphNode>(nodes)
      .force('link', forceLink<GraphNode, GraphLink>(links)
        .id(d => d.id)
        .distance(d => 100 / Math.sqrt(d.weight || 1) * 10 + 50)
        .strength(d => Math.min(1, (d.weight || 1) / 100))
      )
      .force('charge', forceManyBody<GraphNode>()
        .strength(d => -Math.sqrt(d.weight) * 10 - 100)
        .distanceMax(400)
      )
      .force('center', forceCenter(width / 2, height / 2))
      .force('collision', forceCollide<GraphNode>()
        .radius(d => getNodeRadius(d.weight) + 5)
      )
      .force('x', forceX(width / 2).strength(0.05))
      .force('y', forceY(height / 2).strength(0.05));

    simulation.on('tick', () => {
      setNodes([...nodes]);
      setLinks([...links]);
    });

    // Auto-fit after simulation settles
    simulation.on('end', () => {
      // Give a short delay for final positions
      setTimeout(() => {
        if (containerRef.current) {
          // Calculate bounds and fit
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const node of nodes) {
            if (node.x !== undefined && node.y !== undefined) {
              minX = Math.min(minX, node.x);
              maxX = Math.max(maxX, node.x);
              minY = Math.min(minY, node.y);
              maxY = Math.max(maxY, node.y);
            }
          }
          if (isFinite(minX)) {
            const rect = containerRef.current.getBoundingClientRect();
            const padding = 100;
            const graphWidth = maxX - minX + padding * 2;
            const graphHeight = maxY - minY + padding * 2;
            const graphCenterX = (minX + maxX) / 2;
            const graphCenterY = (minY + maxY) / 2;
            const scaleX = rect.width / graphWidth;
            const scaleY = rect.height / graphHeight;
            const newK = Math.min(scaleX, scaleY, 2);
            setTransform({
              x: rect.width / 2 - graphCenterX * newK,
              y: rect.height / 2 - graphCenterY * newK,
              k: newK,
            });
          }
        }
      }, 100);
    });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [nodes.length, links.length]);

  // Calculate node radius based on weight
  const getNodeRadius = useCallback((weight: number) => {
    const minRadius = 6;
    const maxRadius = 40;
    const logWeight = Math.log(weight + 1);
    const maxLogWeight = Math.log(1500);
    return minRadius + (maxRadius - minRadius) * Math.min(1, logWeight / maxLogWeight);
  }, []);

  // Mouse handlers for pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
    }
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setTransform(prev => ({
        ...prev,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      }));
    }
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Wheel handler for zoom - extended range for large/small graphs
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
    // Extended range: 0.02 (see entire large graph) to 10 (zoom into details)
    const newK = Math.max(0.02, Math.min(10, transform.k * scaleFactor));

    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setTransform(prev => ({
        x: mouseX - (mouseX - prev.x) * (newK / prev.k),
        y: mouseY - (mouseY - prev.y) * (newK / prev.k),
        k: newK,
      }));
    }
  }, [transform]);

  // Zoom controls
  const zoomIn = useCallback(() => {
    setTransform(prev => {
      const newK = Math.min(10, prev.k * 1.3);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, k: newK };
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        x: cx - (cx - prev.x) * (newK / prev.k),
        y: cy - (cy - prev.y) * (newK / prev.k),
        k: newK,
      };
    });
  }, []);

  const zoomOut = useCallback(() => {
    setTransform(prev => {
      const newK = Math.max(0.02, prev.k / 1.3);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, k: newK };
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        x: cx - (cx - prev.x) * (newK / prev.k),
        y: cy - (cy - prev.y) * (newK / prev.k),
        k: newK,
      };
    });
  }, []);

  // Fit all nodes in view
  const fitToScreen = useCallback(() => {
    if (nodes.length === 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Calculate bounding box of all nodes
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const node of nodes) {
      if (node.x !== undefined && node.y !== undefined) {
        minX = Math.min(minX, node.x);
        maxX = Math.max(maxX, node.x);
        minY = Math.min(minY, node.y);
        maxY = Math.max(maxY, node.y);
      }
    }

    if (!isFinite(minX)) return;

    const padding = 100;
    const graphWidth = maxX - minX + padding * 2;
    const graphHeight = maxY - minY + padding * 2;
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    // Calculate scale to fit
    const scaleX = rect.width / graphWidth;
    const scaleY = rect.height / graphHeight;
    const newK = Math.min(scaleX, scaleY, 2); // Cap at 2x zoom

    // Center the graph
    setTransform({
      x: rect.width / 2 - graphCenterX * newK,
      y: rect.height / 2 - graphCenterY * newK,
      k: newK,
    });
  }, [nodes]);

  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, k: 1 });
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="social-graph social-graph--loading">
        <div className="social-graph__spinner" />
        <p className="social-graph__status">Loading social graph...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="social-graph social-graph--error">
        <div className="social-graph__error-icon">!</div>
        <p className="social-graph__status social-graph__status--error">{error}</p>
        <button onClick={fetchGraphData} className="social-graph__action">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="social-graph" ref={containerRef}>
      {/* Header */}
      <header className="social-graph__header">
        <button className="social-graph__close" onClick={onClose}>
          ← Back
        </button>
        <h1 className="social-graph__title">Social Graph</h1>
        <div className="social-graph__stats">
          <span className="social-graph__stat">
            <strong>{nodes.length}</strong> people
          </span>
          <span className="social-graph__stat">
            <strong>{stats?.totalRelationships.toLocaleString()}</strong> relationships
          </span>
        </div>
      </header>

      {/* Controls */}
      <div className="social-graph__controls">
        {/* Zoom controls */}
        <div className="social-graph__zoom-controls">
          <button onClick={zoomOut} className="social-graph__zoom-btn" title="Zoom out">
            −
          </button>
          <span className="social-graph__zoom-level">{(transform.k * 100).toFixed(0)}%</span>
          <button onClick={zoomIn} className="social-graph__zoom-btn" title="Zoom in">
            +
          </button>
          <button onClick={fitToScreen} className="social-graph__action" title="Fit all nodes in view">
            Fit All
          </button>
          <button onClick={resetView} className="social-graph__action social-graph__action--secondary">
            Reset
          </button>
        </div>

        <div className="social-graph__control">
          <label className="social-graph__label">Nodes: {maxNodes}</label>
          <input
            type="range"
            min="20"
            max="500"
            step="20"
            value={maxNodes}
            onChange={e => setMaxNodes(Number(e.target.value))}
            className="social-graph__slider"
          />
        </div>

        <label className="social-graph__checkbox">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={e => setShowLabels(e.target.checked)}
          />
          Labels
        </label>

        <div className="social-graph__control">
          <label className="social-graph__label">Links: {(linkOpacity * 100).toFixed(0)}%</label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={linkOpacity}
            onChange={e => setLinkOpacity(Number(e.target.value))}
            className="social-graph__slider"
          />
        </div>
      </div>

      {/* SVG Canvas */}
      <svg
        className="social-graph__canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <g style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})` }}>
          {/* Links */}
          <g className="social-graph__links">
            {links.map(link => {
              const source = link.source as GraphNode;
              const target = link.target as GraphNode;
              if (!source.x || !source.y || !target.x || !target.y) return null;

              const strokeWidth = Math.max(1, Math.log(link.weight + 1) / 2);
              const isHighlighted = hoveredNode &&
                (source.id === hoveredNode.id || target.id === hoveredNode.id);

              return (
                <line
                  key={link.id}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className="social-graph__link"
                  strokeWidth={strokeWidth}
                  strokeOpacity={isHighlighted ? 1 : linkOpacity}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g className="social-graph__nodes">
            {nodes.map(node => {
              if (!node.x || !node.y) return null;

              const radius = getNodeRadius(node.weight);
              const isHovered = hoveredNode?.id === node.id;
              const isSelected = selectedNode?.id === node.id;
              const isSelf = node.id === 'fb_person_self';

              const nodeClasses = [
                'social-graph__node',
                isSelf && 'social-graph__node--self',
                node.isDiscovered && 'social-graph__node--discovered',
                isHovered && 'social-graph__node--hovered',
                isSelected && 'social-graph__node--selected',
              ].filter(Boolean).join(' ');

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onMouseEnter={() => setHoveredNode(node)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => setSelectedNode(node === selectedNode ? null : node)}
                  className="social-graph__node-group"
                >
                  <circle r={radius} className={nodeClasses} />
                  {(showLabels || isHovered || isSelected || isSelf) && (
                    <text
                      y={radius + 12}
                      textAnchor="middle"
                      className={`social-graph__node-label ${isSelf ? 'social-graph__node-label--self' : ''}`}
                    >
                      {node.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* Detail Panel */}
      {(hoveredNode || selectedNode) && (
        <aside className="social-graph__detail">
          <h3 className="social-graph__detail-name">
            {(selectedNode || hoveredNode)!.name}
          </h3>
          <dl className="social-graph__detail-stats">
            <dt>Weight</dt>
            <dd>{(selectedNode || hoveredNode)!.weight.toLocaleString()}</dd>
            <dt>Relationships</dt>
            <dd>{(selectedNode || hoveredNode)!.relationshipCount}</dd>
            <dt>Status</dt>
            <dd>
              {(selectedNode || hoveredNode)!.id === 'fb_person_self' ? 'You' :
               (selectedNode || hoveredNode)!.isFriend ? 'Friend' : 'Discovered'}
            </dd>
          </dl>
        </aside>
      )}

      {/* Legend */}
      <aside className="social-graph__legend">
        <h4 className="social-graph__legend-title">Legend</h4>
        <div className="social-graph__legend-item">
          <span className="social-graph__legend-dot social-graph__legend-dot--self" />
          <span>You</span>
        </div>
        <div className="social-graph__legend-item">
          <span className="social-graph__legend-dot social-graph__legend-dot--friend" />
          <span>Friend</span>
        </div>
        <div className="social-graph__legend-item">
          <span className="social-graph__legend-dot social-graph__legend-dot--discovered" />
          <span>Discovered</span>
        </div>
      </aside>
    </div>
  );
}

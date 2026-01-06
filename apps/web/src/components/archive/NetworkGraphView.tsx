/**
 * NetworkGraphView - Force-directed social graph visualization
 *
 * Visualizes the Facebook relationship graph:
 * - Nodes: People (sized by connection weight)
 * - Edges: Relationships (colored by type)
 *
 * Uses d3-force for layout simulation, React+SVG for rendering.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

// Relationship type colors using CSS custom properties where possible
const RELATIONSHIP_COLORS: Record<string, string> = {
  reacted_like: 'var(--color-archive-facebook)',
  reacted_love: 'var(--color-status-error)',
  reacted_haha: 'var(--color-status-warning)',
  reacted_wow: '#8b5cf6',
  reacted_sorry: 'var(--studio-text-tertiary)',
  reacted_anger: '#dc2626',
  commented_on: 'var(--color-status-success)',
  tagged_in: '#f97316',
  default: 'var(--studio-text-tertiary)',
};

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function NetworkGraphView() {
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

      // Handle wrapped response format: {success: true, connections: [...]}
      const connections: TopConnection[] = connectionsData.connections || connectionsData;
      const statsData: RelationshipStats = statsResult.stats || statsResult;

      setStats(statsData);

      // Build node map from top connections
      const nodeMap = new Map<string, GraphNode>();

      // Add self node at center
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

      // Add connected people
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

      // Build links from self to each person
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

  // Get color for relationship type
  const getLinkColor = useCallback((type: string) => {
    return RELATIONSHIP_COLORS[type] || RELATIONSHIP_COLORS.default;
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

  // Wheel handler for zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newK = Math.max(0.1, Math.min(4, transform.k * scaleFactor));

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

  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, k: 1 });
  }, []);

  // Memoized stats summary
  const statsSummary = useMemo(() => {
    if (!stats) return null;
    return stats.byType.slice(0, 5).map(t => ({
      type: t.relationship_type,
      count: t.count,
      avg_weight: t.avg_weight,
    }));
  }, [stats]);

  // Loading state
  if (loading) {
    return (
      <div className="network-graph network-graph--loading">
        <div className="network-graph__spinner" />
        <p className="network-graph__loading-text">Loading social graph...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="network-graph network-graph--error">
        <div className="network-graph__error-icon">!</div>
        <p className="network-graph__error-text">{error}</p>
        <button onClick={fetchGraphData} className="network-graph__retry-btn">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="network-graph" ref={containerRef}>
      {/* Controls */}
      <div className="network-graph__controls">
        <div className="network-graph__control-group">
          <label className="network-graph__label">
            Nodes: {maxNodes}
          </label>
          <input
            type="range"
            min="20"
            max="500"
            step="20"
            value={maxNodes}
            onChange={e => setMaxNodes(Number(e.target.value))}
            className="network-graph__slider"
          />
        </div>

        <label className="network-graph__checkbox">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={e => setShowLabels(e.target.checked)}
          />
          Labels
        </label>

        <div className="network-graph__control-group">
          <label className="network-graph__label">
            Opacity: {(linkOpacity * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={linkOpacity}
            onChange={e => setLinkOpacity(Number(e.target.value))}
            className="network-graph__slider"
          />
        </div>

        <button onClick={resetView} className="network-graph__btn">
          Reset
        </button>
        <button onClick={fetchGraphData} className="network-graph__btn">
          Refresh
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="network-graph__stats">
          <span className="network-graph__stat">
            <strong>{nodes.length}</strong> people
          </span>
          <span className="network-graph__stat">
            <strong>{stats.totalRelationships.toLocaleString()}</strong> relationships
          </span>
          {statsSummary?.map(s => (
            <span key={s.type} className="network-graph__stat-type">
              <span
                className="network-graph__stat-dot"
                style={{ backgroundColor: getLinkColor(s.type) }}
              />
              {s.type.replace('reacted_', '').replace('_', ' ')}: {s.count}
            </span>
          ))}
        </div>
      )}

      {/* SVG Canvas */}
      <svg
        className="network-graph__svg"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <g style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})` }}>
          {/* Links */}
          <g className="network-graph__links">
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
                  stroke={getLinkColor(link.type)}
                  strokeWidth={strokeWidth}
                  strokeOpacity={isHighlighted ? 1 : linkOpacity}
                  className="network-graph__link"
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g className="network-graph__nodes">
            {nodes.map(node => {
              if (!node.x || !node.y) return null;

              const radius = getNodeRadius(node.weight);
              const isHovered = hoveredNode?.id === node.id;
              const isSelected = selectedNode?.id === node.id;
              const isSelf = node.id === 'fb_person_self';

              const nodeClasses = [
                'network-graph__node',
                isSelf && 'network-graph__node--self',
                node.isDiscovered && 'network-graph__node--discovered',
                isHovered && 'network-graph__node--hovered',
                isSelected && 'network-graph__node--selected',
              ].filter(Boolean).join(' ');

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onMouseEnter={() => setHoveredNode(node)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => setSelectedNode(node === selectedNode ? null : node)}
                  className="network-graph__node-group"
                >
                  <circle r={radius} className={nodeClasses} />
                  {(showLabels || isHovered || isSelected || isSelf) && (
                    <text
                      y={radius + 12}
                      textAnchor="middle"
                      className={`network-graph__label-text ${isSelf ? 'network-graph__label-text--self' : ''}`}
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
        <div className="network-graph__detail">
          <h3 className="network-graph__detail-name">
            {(selectedNode || hoveredNode)!.name}
          </h3>
          <p className="network-graph__detail-stat">
            <strong>Weight:</strong> {(selectedNode || hoveredNode)!.weight.toLocaleString()}
          </p>
          <p className="network-graph__detail-stat">
            <strong>Relationships:</strong> {(selectedNode || hoveredNode)!.relationshipCount}
          </p>
          <p className="network-graph__detail-stat">
            <strong>Status:</strong> {
              (selectedNode || hoveredNode)!.id === 'fb_person_self' ? 'You' :
              (selectedNode || hoveredNode)!.isFriend ? 'Friend' : 'Discovered'
            }
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="network-graph__legend">
        <div className="network-graph__legend-title">Legend</div>
        <div className="network-graph__legend-item">
          <span className="network-graph__legend-circle network-graph__legend-circle--self" />
          <span>You</span>
        </div>
        <div className="network-graph__legend-item">
          <span className="network-graph__legend-circle network-graph__legend-circle--friend" />
          <span>Friend</span>
        </div>
        <div className="network-graph__legend-item">
          <span className="network-graph__legend-circle network-graph__legend-circle--discovered" />
          <span>Discovered</span>
        </div>
      </div>
    </div>
  );
}

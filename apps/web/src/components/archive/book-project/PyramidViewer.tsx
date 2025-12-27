/**
 * PyramidViewer - Interactive hierarchical view of a pyramid structure
 *
 * Provides:
 * - Visual hierarchy from apex down to chunks
 * - Expandable/collapsible nodes
 * - Click to view full content
 * - Path highlighting from selected chunk to apex
 */

import { useMemo, useCallback } from 'react';
import type { PyramidStructure, PyramidChunk, PyramidSummary, PyramidApex } from '@humanizer/core';
import type { BookProjectViewState } from './types';

// ============================================
// Props
// ============================================

interface PyramidViewerProps {
  pyramid: PyramidStructure;
  viewState: BookProjectViewState;
  setViewState: React.Dispatch<React.SetStateAction<BookProjectViewState>>;
  /** Compact mode for embedding in other views */
  compact?: boolean;
}

// ============================================
// Main Component
// ============================================

export function PyramidViewer({
  pyramid,
  viewState,
  setViewState,
  compact = false,
}: PyramidViewerProps) {
  const { selectedNodeId, expandedNodes, selectedLevel } = viewState.pyramidView;

  // Build a parent map for navigation
  const parentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const summary of pyramid.summaries) {
      for (const childId of summary.childIds) {
        map.set(childId, summary.id);
      }
    }
    return map;
  }, [pyramid.summaries]);

  // Get path from node to apex
  const getPathToApex = useCallback((nodeId: string): string[] => {
    const path: string[] = [nodeId];
    let current = nodeId;
    while (parentMap.has(current)) {
      current = parentMap.get(current)!;
      path.push(current);
    }
    return path;
  }, [parentMap]);

  // Current selected path (for highlighting)
  const selectedPath = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    return new Set(getPathToApex(selectedNodeId));
  }, [selectedNodeId, getPathToApex]);

  // Toggle node expansion
  const toggleNode = useCallback((nodeId: string) => {
    setViewState(prev => {
      const next = new Set(prev.pyramidView.expandedNodes);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return {
        ...prev,
        pyramidView: { ...prev.pyramidView, expandedNodes: next },
      };
    });
  }, [setViewState]);

  // Select a node
  const selectNode = useCallback((nodeId: string) => {
    setViewState(prev => ({
      ...prev,
      pyramidView: { ...prev.pyramidView, selectedNodeId: nodeId },
    }));
  }, [setViewState]);

  // Get nodes at a specific level
  const getNodesAtLevel = useCallback((level: number): (PyramidChunk | PyramidSummary)[] => {
    if (level === 0) return pyramid.chunks;
    return pyramid.summaries.filter(s => s.level === level);
  }, [pyramid]);

  // Max level (not counting apex)
  const maxLevel = pyramid.meta.depth - 1;

  // Render based on mode
  if (compact) {
    return (
      <CompactPyramidView
        pyramid={pyramid}
        selectedLevel={selectedLevel}
        selectedNodeId={selectedNodeId}
        onSelectLevel={(level) => setViewState(prev => ({
          ...prev,
          pyramidView: { ...prev.pyramidView, selectedLevel: level },
        }))}
        onSelectNode={selectNode}
        getNodesAtLevel={getNodesAtLevel}
      />
    );
  }

  return (
    <div className="pyramid-viewer">
      {/* Apex */}
      <div className="pyramid-viewer__apex">
        <ApexCard apex={pyramid.apex} />
      </div>

      {/* Hierarchical Tree */}
      <div className="pyramid-viewer__tree">
        {/* Render from highest summary level down */}
        {Array.from({ length: maxLevel }, (_, i) => maxLevel - i).map(level => (
          <div key={level} className="pyramid-level">
            <div className="level-header">
              <span className="level-label">Level {level}</span>
              <span className="level-count">
                {getNodesAtLevel(level).length} nodes
              </span>
            </div>
            <div className="level-nodes">
              {getNodesAtLevel(level).map(node => (
                <PyramidNode
                  key={node.id}
                  node={node}
                  isExpanded={expandedNodes.has(node.id)}
                  isSelected={selectedNodeId === node.id}
                  isInPath={selectedPath.has(node.id)}
                  onToggle={() => toggleNode(node.id)}
                  onSelect={() => selectNode(node.id)}
                  pyramid={pyramid}
                  level={level}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Level 0 - Chunks */}
        <div className="pyramid-level pyramid-level--chunks">
          <div className="level-header">
            <span className="level-label">Level 0 (Chunks)</span>
            <span className="level-count">{pyramid.chunks.length} chunks</span>
          </div>
          <div className="level-nodes level-nodes--grid">
            {pyramid.chunks.slice(0, 50).map(chunk => (
              <ChunkCard
                key={chunk.id}
                chunk={chunk}
                isSelected={selectedNodeId === chunk.id}
                isInPath={selectedPath.has(chunk.id)}
                onSelect={() => selectNode(chunk.id)}
              />
            ))}
            {pyramid.chunks.length > 50 && (
              <div className="chunks-overflow">
                +{pyramid.chunks.length - 50} more chunks
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Selected Node Detail */}
      {selectedNodeId && (
        <SelectedNodeDetail
          pyramid={pyramid}
          nodeId={selectedNodeId}
          path={getPathToApex(selectedNodeId)}
          onNavigate={selectNode}
        />
      )}
    </div>
  );
}

// ============================================
// Apex Card
// ============================================

function ApexCard({ apex }: { apex?: PyramidApex }) {
  if (!apex) {
    return (
      <div className="apex-card apex-card--empty">
        <span className="apex-icon">🔺</span>
        <p>No apex generated yet</p>
      </div>
    );
  }

  return (
    <div className="apex-card">
      <div className="apex-card__header">
        <span className="apex-icon">🔺</span>
        <span className="apex-title">Apex</span>
      </div>
      <p className="apex-card__summary">{apex.summary}</p>
      <div className="apex-card__themes">
        {apex.themes.map((theme, i) => (
          <span key={i} className="theme-badge">{theme}</span>
        ))}
      </div>
      {apex.mood && (
        <div className="apex-card__mood">
          <span className="label">Mood:</span>
          <span className="value">{apex.mood}</span>
        </div>
      )}
    </div>
  );
}

// ============================================
// Pyramid Node (Summary)
// ============================================

interface PyramidNodeProps {
  node: PyramidChunk | PyramidSummary;
  isExpanded: boolean;
  isSelected: boolean;
  isInPath: boolean;
  onToggle: () => void;
  onSelect: () => void;
  pyramid: PyramidStructure;
  level: number;
}

function PyramidNode({
  node,
  isExpanded,
  isSelected,
  isInPath,
  onToggle,
  onSelect,
  pyramid,
}: PyramidNodeProps) {
  const isSummary = 'childIds' in node;
  const summary = isSummary ? (node as PyramidSummary) : null;

  // Get children if expanded
  const children = useMemo(() => {
    if (!summary || !isExpanded) return [];
    return summary.childIds
      .map(id =>
        pyramid.chunks.find(c => c.id === id) ||
        pyramid.summaries.find(s => s.id === id)
      )
      .filter(Boolean);
  }, [summary, isExpanded, pyramid]);

  return (
    <div
      className={`pyramid-node ${isSelected ? 'selected' : ''} ${isInPath ? 'in-path' : ''}`}
    >
      <div className="pyramid-node__header" onClick={onSelect}>
        {isSummary && (
          <button className="expand-btn" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
        <span className="node-index">#{node.index}</span>
        <span className="node-preview">
          {node.content.slice(0, 100)}...
        </span>
        <span className="node-words">{node.wordCount}w</span>
      </div>
      {isExpanded && children.length > 0 && (
        <div className="pyramid-node__children">
          {children.map(child => (
            <div key={child!.id} className="child-preview">
              <span className="child-index">#{child!.index}</span>
              <span className="child-content">
                {child!.content.slice(0, 60)}...
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Chunk Card
// ============================================

function ChunkCard({
  chunk,
  isSelected,
  isInPath,
  onSelect,
}: {
  chunk: PyramidChunk;
  isSelected: boolean;
  isInPath: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`chunk-card ${isSelected ? 'selected' : ''} ${isInPath ? 'in-path' : ''}`}
      onClick={onSelect}
    >
      <div className="chunk-card__header">
        <span className="chunk-index">#{chunk.index}</span>
        <span className="chunk-words">{chunk.wordCount}w</span>
      </div>
      <p className="chunk-card__preview">
        {chunk.content.slice(0, 80)}...
      </p>
    </div>
  );
}

// ============================================
// Selected Node Detail
// ============================================

function SelectedNodeDetail({
  pyramid,
  nodeId,
  path,
  onNavigate,
}: {
  pyramid: PyramidStructure;
  nodeId: string;
  path: string[];
  onNavigate: (nodeId: string) => void;
}) {
  const chunk = pyramid.chunks.find(c => c.id === nodeId);
  const summary = pyramid.summaries.find(s => s.id === nodeId);
  const node = chunk || summary;

  if (!node) return null;

  const isChunk = chunk !== undefined;

  return (
    <div className="selected-node-detail">
      <div className="detail-header">
        <span className="detail-type">{isChunk ? 'Chunk' : 'Summary'}</span>
        <span className="detail-level">Level {node.level}</span>
        <span className="detail-index">#{node.index}</span>
      </div>

      {/* Path breadcrumbs */}
      <div className="detail-path">
        <span className="path-label">Path to apex:</span>
        <div className="path-crumbs">
          {path.slice().reverse().map((id, i) => (
            <button
              key={id}
              className={`path-crumb ${id === nodeId ? 'current' : ''}`}
              onClick={() => onNavigate(id)}
            >
              {i === path.length - 1 ? 'Apex' : `L${pyramid.summaries.find(s => s.id === id)?.level || 0}`}
            </button>
          ))}
        </div>
      </div>

      <div className="detail-content">
        <p>{node.content}</p>
      </div>

      <div className="detail-meta">
        <span className="meta-item">
          <span className="label">Words:</span>
          <span className="value">{node.wordCount}</span>
        </span>
        {isChunk && chunk && (
          <>
            <span className="meta-item">
              <span className="label">Sentences:</span>
              <span className="value">{chunk.sentenceCount}</span>
            </span>
            <span className="meta-item">
              <span className="label">Characters:</span>
              <span className="value">{chunk.charCount}</span>
            </span>
          </>
        )}
        {!isChunk && summary && (
          <>
            <span className="meta-item">
              <span className="label">Children:</span>
              <span className="value">{summary.childIds.length}</span>
            </span>
            <span className="meta-item">
              <span className="label">Compression:</span>
              <span className="value">{summary.compressionRatio.toFixed(1)}x</span>
            </span>
          </>
        )}
      </div>

      {!isChunk && summary?.keyPoints && summary.keyPoints.length > 0 && (
        <div className="detail-keypoints">
          <span className="label">Key Points:</span>
          <ul>
            {summary.keyPoints.map((kp, i) => (
              <li key={i}>{kp}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================================
// Compact Pyramid View
// ============================================

function CompactPyramidView({
  pyramid,
  selectedLevel,
  selectedNodeId,
  onSelectLevel,
  onSelectNode,
  getNodesAtLevel,
}: {
  pyramid: PyramidStructure;
  selectedLevel: number;
  selectedNodeId?: string;
  onSelectLevel: (level: number) => void;
  onSelectNode: (nodeId: string) => void;
  getNodesAtLevel: (level: number) => (PyramidChunk | PyramidSummary)[];
}) {
  const maxLevel = pyramid.meta.depth - 1;
  const nodesAtLevel = getNodesAtLevel(selectedLevel);

  return (
    <div className="pyramid-compact">
      {/* Level selector */}
      <div className="pyramid-compact__levels">
        {Array.from({ length: maxLevel + 1 }, (_, i) => (
          <button
            key={i}
            className={`level-btn ${selectedLevel === i ? 'active' : ''}`}
            onClick={() => onSelectLevel(i)}
          >
            L{i}
          </button>
        ))}
      </div>

      {/* Nodes at selected level */}
      <div className="pyramid-compact__nodes">
        {nodesAtLevel.slice(0, 20).map(node => (
          <div
            key={node.id}
            className={`compact-node ${selectedNodeId === node.id ? 'selected' : ''}`}
            onClick={() => onSelectNode(node.id)}
          >
            <span className="node-index">#{node.index}</span>
            <span className="node-preview">{node.content.slice(0, 50)}...</span>
          </div>
        ))}
        {nodesAtLevel.length > 20 && (
          <div className="nodes-overflow">+{nodesAtLevel.length - 20} more</div>
        )}
      </div>
    </div>
  );
}

export default PyramidViewer;

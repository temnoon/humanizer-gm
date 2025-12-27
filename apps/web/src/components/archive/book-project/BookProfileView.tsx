/**
 * BookProfileView - Displays the book's profile and pyramid summary
 *
 * Shows:
 * - Apex summary (themes, characters, arc, mood)
 * - Philosophy (stances, assumptions, influences)
 * - Tone (overall, register, emotional arc)
 * - Setting (context, constraints)
 * - Pyramid navigation
 */

import { useState, useCallback } from 'react';
import type { BookProject, PyramidStructure } from '@humanizer/core';
import type { BookProjectViewState } from './types';
import { buildPyramid, searchChunks } from '../../../lib/pyramid';
import type { PyramidBuildProgress } from '../../../lib/pyramid';

// ============================================
// Props
// ============================================

interface BookProfileViewProps {
  project: BookProject;
  viewState: BookProjectViewState;
  setViewState: React.Dispatch<React.SetStateAction<BookProjectViewState>>;
  onBuildPyramid?: (pyramid: PyramidStructure) => void;
}

// ============================================
// Main Component
// ============================================

export function BookProfileView({
  project,
  viewState,
  setViewState,
  onBuildPyramid,
}: BookProfileViewProps) {
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState<PyramidBuildProgress | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ chunk: { id: string; content: string }; score: number }>>([]);

  const profile = project.profile;
  const pyramid = project.pyramid;
  const hasProfile = profile !== undefined;
  const hasPyramid = pyramid?.apex !== undefined;

  // Handle building pyramid from approved passages
  const handleBuildPyramid = useCallback(async () => {
    const approvedPassages = (project.passages || project.sources?.passages || [])
      .filter(p => {
        const status = p.curation?.status || p.status;
        return status === 'approved' || status === 'gem';
      });

    if (approvedPassages.length === 0) {
      return;
    }

    setBuilding(true);
    setBuildProgress({
      phase: 'chunking',
      currentLevel: 0,
      totalLevels: 0,
      itemsProcessed: 0,
      itemsTotal: 0,
      message: 'Starting pyramid build...',
    });

    try {
      const combinedText = approvedPassages
        .map(p => p.text || p.content || '')
        .join('\n\n');

      const result = await buildPyramid(combinedText, {
        sourceInfo: {
          bookTitle: project.name,
          author: project.author,
        },
        onProgress: setBuildProgress,
      });

      if (result.success && result.pyramid) {
        onBuildPyramid?.(result.pyramid);
      }
    } finally {
      setBuilding(false);
      setBuildProgress(null);
    }
  }, [project, onBuildPyramid]);

  // Handle searching within pyramid
  const handleSearch = useCallback(() => {
    if (!pyramid || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const results = searchChunks(pyramid as PyramidStructure, searchQuery, { limit: 10 });
    setSearchResults(results.map(r => ({
      chunk: { id: r.chunk.id, content: r.chunk.content },
      score: r.score,
    })));
  }, [pyramid, searchQuery]);

  // Select a pyramid node
  const selectNode = useCallback((nodeId: string) => {
    setViewState(prev => ({
      ...prev,
      pyramidView: {
        ...prev.pyramidView,
        selectedNodeId: nodeId,
      },
    }));
  }, [setViewState]);

  return (
    <div className="profile-tab">
      {/* Profile Header with Build Action */}
      <div className="profile-tab__header">
        <h3>Book Profile</h3>
        {!hasPyramid && (
          <button
            className="profile-tab__build-btn"
            onClick={handleBuildPyramid}
            disabled={building}
          >
            {building ? 'Building...' : 'Build Pyramid'}
          </button>
        )}
      </div>

      {/* Build Progress */}
      {building && buildProgress && (
        <div className="profile-tab__progress">
          <div className="progress-bar">
            <div
              className="progress-bar__fill"
              style={{
                width: buildProgress.itemsTotal > 0
                  ? `${(buildProgress.itemsProcessed / buildProgress.itemsTotal) * 100}%`
                  : '0%',
              }}
            />
          </div>
          <span className="progress-message">{buildProgress.message}</span>
        </div>
      )}

      {/* No Profile State */}
      {!hasProfile && !hasPyramid && !building && (
        <div className="profile-tab__empty">
          <span className="empty-icon">📊</span>
          <p>No profile yet</p>
          <p className="empty-hint">
            Approve passages and click "Build Pyramid" to generate a profile.
          </p>
        </div>
      )}

      {/* Apex Summary */}
      {(hasPyramid || hasProfile) && (
        <section className="profile-section">
          <h4>
            <span className="section-icon">🔺</span>
            Apex Summary
          </h4>
          <div className="apex-content">
            <p className="apex-summary">
              {pyramid?.apex?.summary || profile?.apex?.summary || 'No summary available'}
            </p>

            {/* Themes */}
            <div className="apex-themes">
              <span className="label">Themes:</span>
              <div className="theme-list">
                {(pyramid?.apex?.themes || profile?.apex?.themes || []).map((theme, i) => (
                  <span key={i} className="theme-tag">{theme}</span>
                ))}
              </div>
            </div>

            {/* Characters */}
            {((pyramid?.apex?.characters || profile?.apex?.characters)?.length ?? 0) > 0 && (
              <div className="apex-characters">
                <span className="label">Key Figures:</span>
                <div className="character-list">
                  {(pyramid?.apex?.characters || profile?.apex?.characters || []).map((char, i) => (
                    <span key={i} className="character-tag">{char}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Arc */}
            {(pyramid?.apex?.arc || profile?.apex?.arc) && (
              <div className="apex-arc">
                <span className="label">Arc:</span>
                <p>{pyramid?.apex?.arc || profile?.apex?.arc}</p>
              </div>
            )}

            {/* Mood */}
            {pyramid?.apex?.mood && (
              <div className="apex-mood">
                <span className="label">Mood:</span>
                <span className="mood-badge">{pyramid.apex.mood}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Philosophy */}
      {profile?.philosophy && (
        <section className="profile-section">
          <h4>
            <span className="section-icon">🎓</span>
            Philosophy
          </h4>
          <div className="philosophy-content">
            {profile.philosophy.stances.length > 0 && (
              <div className="philosophy-stances">
                <span className="label">Stances:</span>
                <ul>
                  {profile.philosophy.stances.map((stance, i) => (
                    <li key={i}>{stance}</li>
                  ))}
                </ul>
              </div>
            )}
            {profile.philosophy.assumptions.length > 0 && (
              <div className="philosophy-assumptions">
                <span className="label">Assumptions:</span>
                <ul>
                  {profile.philosophy.assumptions.map((assumption, i) => (
                    <li key={i}>{assumption}</li>
                  ))}
                </ul>
              </div>
            )}
            {profile.philosophy.influences.length > 0 && (
              <div className="philosophy-influences">
                <span className="label">Influences:</span>
                <div className="influence-list">
                  {profile.philosophy.influences.map((influence, i) => (
                    <span key={i} className="influence-tag">{influence}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Tone */}
      {profile?.tone && (
        <section className="profile-section">
          <h4>
            <span className="section-icon">🎭</span>
            Tone
          </h4>
          <div className="tone-content">
            <div className="tone-overall">
              <span className="label">Overall:</span>
              <span className="tone-value">{profile.tone.overall}</span>
            </div>
            <div className="tone-register">
              <span className="label">Register:</span>
              <span className="tone-value">{profile.tone.register}</span>
            </div>
            {profile.tone.emotionalArc && (
              <div className="tone-arc">
                <span className="label">Emotional Arc:</span>
                <p>{profile.tone.emotionalArc}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Setting */}
      {profile?.setting && (
        <section className="profile-section">
          <h4>
            <span className="section-icon">🌍</span>
            Setting
          </h4>
          <div className="setting-content">
            <div className="setting-context">
              <span className="label">Context:</span>
              <p>{profile.setting.context}</p>
            </div>
            {profile.setting.constraints.length > 0 && (
              <div className="setting-constraints">
                <span className="label">Constraints:</span>
                <ul>
                  {profile.setting.constraints.map((constraint, i) => (
                    <li key={i}>{constraint}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Pyramid Navigator */}
      {hasPyramid && (
        <section className="profile-section profile-section--pyramid">
          <h4>
            <span className="section-icon">🏔️</span>
            Pyramid Structure
          </h4>

          {/* Pyramid Stats */}
          <div className="pyramid-stats">
            <span className="stat">
              <span className="stat-value">{pyramid?.meta?.depth || 0}</span>
              <span className="stat-label">Levels</span>
            </span>
            <span className="stat">
              <span className="stat-value">{pyramid?.chunks?.length || 0}</span>
              <span className="stat-label">Chunks</span>
            </span>
            <span className="stat">
              <span className="stat-value">{pyramid?.summaries?.length || 0}</span>
              <span className="stat-label">Summaries</span>
            </span>
            <span className="stat">
              <span className="stat-value">{pyramid?.meta?.compressionRatio?.toFixed(1) || '-'}x</span>
              <span className="stat-label">Compression</span>
            </span>
          </div>

          {/* Search within pyramid */}
          <div className="pyramid-search">
            <input
              type="text"
              placeholder="Search within pyramid..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <button onClick={handleSearch}>Search</button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="pyramid-search-results">
              <h5>Search Results ({searchResults.length})</h5>
              {searchResults.map(result => (
                <div
                  key={result.chunk.id}
                  className={`search-result ${viewState.pyramidView.selectedNodeId === result.chunk.id ? 'selected' : ''}`}
                  onClick={() => selectNode(result.chunk.id)}
                >
                  <span className="result-score">
                    {(result.score * 100).toFixed(0)}%
                  </span>
                  <p className="result-content">
                    {result.chunk.content.slice(0, 150)}...
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Level Navigator */}
          <div className="pyramid-levels">
            <h5>Navigate by Level</h5>
            <div className="level-buttons">
              {Array.from({ length: (pyramid?.meta?.depth || 1) }, (_, i) => (
                <button
                  key={i}
                  className={`level-btn ${viewState.pyramidView.selectedLevel === i ? 'active' : ''}`}
                  onClick={() => setViewState(prev => ({
                    ...prev,
                    pyramidView: { ...prev.pyramidView, selectedLevel: i },
                  }))}
                >
                  L{i}
                  <span className="level-count">
                    {i === 0
                      ? pyramid?.chunks?.length || 0
                      : pyramid?.summaries?.filter(s => s.level === i).length || 0}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Selected Node Preview */}
          {viewState.pyramidView.selectedNodeId && (
            <div className="pyramid-node-preview">
              <h5>Selected Node</h5>
              <NodePreview
                pyramid={pyramid as PyramidStructure}
                nodeId={viewState.pyramidView.selectedNodeId}
              />
            </div>
          )}
        </section>
      )}

      {/* Profile Stats */}
      {(hasPyramid || hasProfile) && (
        <section className="profile-section profile-section--stats">
          <h4>
            <span className="section-icon">📈</span>
            Profile Stats
          </h4>
          <div className="profile-stats">
            <div className="stat-row">
              <span className="label">Pyramid Depth:</span>
              <span className="value">{profile?.stats?.pyramidDepth || pyramid?.meta?.depth || '-'}</span>
            </div>
            <div className="stat-row">
              <span className="label">Total Chunks:</span>
              <span className="value">{profile?.stats?.totalChunks || pyramid?.chunks?.length || '-'}</span>
            </div>
            <div className="stat-row">
              <span className="label">Compression:</span>
              <span className="value">
                {profile?.stats?.compressionRatio?.toFixed(1) || pyramid?.meta?.compressionRatio?.toFixed(1) || '-'}x
              </span>
            </div>
            <div className="stat-row">
              <span className="label">Last Updated:</span>
              <span className="value">
                {profile?.stats?.lastUpdated
                  ? new Date(profile.stats.lastUpdated).toLocaleDateString()
                  : pyramid?.meta?.builtAt
                    ? new Date(pyramid.meta.builtAt).toLocaleDateString()
                    : '-'}
              </span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ============================================
// Node Preview Component
// ============================================

function NodePreview({
  pyramid,
  nodeId,
}: {
  pyramid: PyramidStructure;
  nodeId: string;
}) {
  // Find the node
  const chunk = pyramid.chunks.find(c => c.id === nodeId);
  const summary = pyramid.summaries.find(s => s.id === nodeId);
  const node = chunk || summary;

  if (!node) {
    return <p className="node-not-found">Node not found</p>;
  }

  const isChunk = 'sentenceCount' in node;

  return (
    <div className={`node-preview node-preview--${isChunk ? 'chunk' : 'summary'}`}>
      <div className="node-meta">
        <span className="node-type">{isChunk ? 'Chunk' : 'Summary'}</span>
        <span className="node-level">Level {node.level}</span>
        <span className="node-index">#{node.index}</span>
        <span className="node-words">{node.wordCount} words</span>
      </div>
      <p className="node-content">{node.content}</p>
      {!isChunk && summary?.keyPoints && summary.keyPoints.length > 0 && (
        <div className="node-keypoints">
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

export default BookProfileView;

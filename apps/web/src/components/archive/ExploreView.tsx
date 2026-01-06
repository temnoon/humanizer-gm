/**
 * Explore View - Semantic search across the archive
 *
 * Receives search results from:
 * 1. Direct user input (debounced search)
 * 2. AUI tools via GUI Bridge (Show Don't Tell pattern)
 *
 * Shows health status and offers to build embeddings when needed.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { getArchiveServerUrl } from '../../lib/platform';
import { useSearchResultsAction } from '../../lib/aui';
import { useArchiveHealth, needsEmbeddings, isOllamaAvailable } from '../../lib/archive/useArchiveHealth';
import { useBookshelf, type SourcePassage } from '../../lib/bookshelf';
import type { EntityURI } from '@humanizer/core';

export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  conversationId?: string;
  conversationFolder?: string;
  conversationTitle?: string;
  metadata?: {
    conversationId?: string;
    messageId?: string;
    role?: string;
  };
}

interface ExploreViewProps {
  /** Callback when a search result is selected */
  onSelectResult?: (result: SearchResult) => void;
}

export function ExploreView({ onSelectResult }: ExploreViewProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [fromAUI, setFromAUI] = useState(false);
  const [savedToHarvest, setSavedToHarvest] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Archive health check - detect missing embeddings
  const { health, buildEmbeddings, isBuilding, buildProgress } = useArchiveHealth();
  const showSetup = needsEmbeddings(health);
  const ollamaReady = isOllamaAvailable(health);

  // Bookshelf for harvest bucket creation
  const { activeBookUri, createHarvestBucket } = useBookshelf();

  // Save current search results to a harvest bucket
  const handleSaveToHarvest = useCallback(async () => {
    if (!activeBookUri || results.length === 0) return;

    // Import harvestBucketService directly for adding candidates
    const { harvestBucketService } = await import('../../lib/bookshelf/HarvestBucketService');

    // Create bucket with search query
    const bucket = createHarvestBucket(activeBookUri, [query]);

    // Convert search results to passages and add as candidates
    for (const result of results) {
      const passage: SourcePassage = {
        id: result.id,
        text: result.content,
        wordCount: result.content.split(/\s+/).length,
        similarity: result.similarity,
        timestamp: Date.now(),
        sourceRef: {
          uri: `source://chatgpt/${result.conversationId}` as EntityURI,
          sourceType: 'chatgpt',
          conversationId: result.conversationId,
          conversationTitle: result.conversationTitle,
        },
        curation: {
          status: 'candidate',
          curatedAt: Date.now(),
        },
        tags: [],
      };
      harvestBucketService.addCandidate(bucket.id, passage);
    }

    setSavedToHarvest(true);
    setTimeout(() => setSavedToHarvest(false), 2000);
  }, [activeBookUri, results, query, createHarvestBucket]);

  // Reset saved state when results change
  useEffect(() => {
    setSavedToHarvest(false);
  }, [results]);

  // GUI Bridge: Receive search results from AUI tools
  const { results: auiResults, clear: clearAUIResults } = useSearchResultsAction();

  // When AUI dispatches results, display them
  useEffect(() => {
    if (auiResults && auiResults.results.length > 0) {
      // Map AUI results to our SearchResult format
      const mapped: SearchResult[] = auiResults.results.map((r, i) => ({
        id: r.messageId || r.id || `aui-${i}`,
        content: r.content || r.title || '',
        similarity: r.similarity || 0.5,
        conversationId: r.conversationId,
        conversationTitle: r.title,
        metadata: {
          conversationId: r.conversationId,
          messageId: r.messageId,
          role: r.role,
        },
      }));
      setResults(mapped);
      setQuery(auiResults.query);
      setHasSearched(true);
      setFromAUI(true);
      setError(null);
    }
  }, [auiResults]);

  // Clear AUI indicator when user starts typing
  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (fromAUI) {
      setFromAUI(false);
      clearAUIResults();
    }
  };

  const search = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/embeddings/search/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery,
          limit: 20,
        }),
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setResults(data.results || []);
    } catch (err) {
      setError('Semantic search requires embeddings. Build embeddings from the Import tab.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Listen for explore-search events from Find Similar button
  useEffect(() => {
    const handleExploreSearch = (e: CustomEvent<{ query: string }>) => {
      const searchQuery = e.detail?.query;
      if (searchQuery) {
        setQuery(searchQuery);
        setFromAUI(false);
        search(searchQuery);
      }
    };

    window.addEventListener('explore-search', handleExploreSearch as EventListener);
    return () => window.removeEventListener('explore-search', handleExploreSearch as EventListener);
  }, [search]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.trim()) {
      debounceRef.current = setTimeout(() => {
        search(query);
      }, 300);
    } else {
      setResults([]);
      setHasSearched(false);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, search]);

  const getScoreClass = (score: number): string => {
    if (score >= 0.7) return 'explore-result__score--high';
    if (score >= 0.4) return 'explore-result__score--medium';
    return 'explore-result__score--low';
  };

  const handleResultClick = (result: SearchResult) => {
    // Navigate to the result via callback
    if (onSelectResult) {
      onSelectResult(result);
    }
  };

  return (
    <div className="explore-tab">
      {/* Search input */}
      <div className="explore-search">
        <span className="explore-search__icon">🔍</span>
        <input
          type="text"
          className="explore-search__input"
          placeholder="Search by meaning, not just keywords..."
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
        />
        {fromAUI && (
          <span className="explore-search__aui-badge" title="Results from AUI assistant">
            ✦ AUI
          </span>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="archive-browser__loading">
          Searching...
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="tool-panel__empty">
          <p>{error}</p>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="explore-results">
          {/* Results header with actions */}
          <div className="explore-results__header">
            <span className="explore-results__count">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
            {activeBookUri && (
              <button
                className={`explore-results__harvest-btn ${savedToHarvest ? 'explore-results__harvest-btn--saved' : ''}`}
                onClick={handleSaveToHarvest}
                disabled={savedToHarvest}
                title="Save these results to a harvest bucket for curation"
              >
                {savedToHarvest ? '✓ Saved' : '🌾 Save to Harvest'}
              </button>
            )}
          </div>

          {results.map(result => (
            <div
              key={result.id}
              className={`explore-result ${onSelectResult ? 'explore-result--clickable' : ''}`}
              onClick={() => handleResultClick(result)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleResultClick(result)}
            >
              <span className={`explore-result__score ${getScoreClass(result.similarity)}`}>
                {(result.similarity * 100).toFixed(0)}% match
              </span>
              {result.conversationTitle && (
                <div className="explore-result__source">
                  {result.conversationTitle}
                </div>
              )}
              <div className="explore-result__text">
                {result.content.substring(0, 200)}
                {result.content.length > 200 ? '...' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state after search */}
      {hasSearched && !loading && !error && results.length === 0 && (
        <div className="tool-panel__empty">
          <p>No results found</p>
          <span className="tool-panel__muted">Try different keywords or phrases</span>
        </div>
      )}

      {/* Setup needed banner */}
      {showSetup && !isBuilding && (
        <div className="explore-setup">
          <div className="explore-setup__icon">⚡</div>
          <div className="explore-setup__content">
            <h4>Build Embeddings</h4>
            <p>
              {health?.stats.conversations || 0} conversations imported.
              Build embeddings to enable semantic search.
            </p>
            {!ollamaReady ? (
              <div className="explore-setup__warning">
                ⚠️ Ollama not running. Start it with: <code>ollama serve</code>
              </div>
            ) : (
              <button
                className="explore-setup__button"
                onClick={() => buildEmbeddings()}
              >
                Build Embeddings Now
              </button>
            )}
          </div>
        </div>
      )}

      {/* Building progress */}
      {isBuilding && buildProgress && (
        <div className="explore-building">
          <div className="explore-building__header">
            <span className="explore-building__icon">⏳</span>
            <span>Building embeddings...</span>
          </div>
          <div className="explore-building__progress">
            <div className="explore-building__bar">
              <div
                className="explore-building__fill"
                style={{ width: `${buildProgress.progress}%` }}
              />
            </div>
            <span className="explore-building__percent">{buildProgress.progress}%</span>
          </div>
          <div className="explore-building__phase">
            {buildProgress.phase}: {buildProgress.current}/{buildProgress.total}
            {buildProgress.currentItem && ` - ${buildProgress.currentItem}`}
          </div>
        </div>
      )}

      {/* Initial state */}
      {!hasSearched && !loading && !showSetup && !isBuilding && (
        <div className="tool-panel__empty">
          <p>Semantic Search</p>
          <span className="tool-panel__muted">
            Find content by meaning across all your archives
          </span>
          {health && (
            <span className="tool-panel__stats">
              {health.stats.messages.toLocaleString()} embeddings indexed
            </span>
          )}
        </div>
      )}
    </div>
  );
}

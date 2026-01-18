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
import { useFilters, type FilterSpec } from '../../lib/archive/FilterContext';
import { useBookshelf, type SourcePassage } from '../../lib/bookshelf';
import { AdaptiveFilters } from './AdaptiveFilters';
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

// Content types for filtering (Phase 5)
const CONTENT_TYPES = [
  { id: 'prose', label: 'Prose', icon: '📝' },
  { id: 'code', label: 'Code', icon: '💻' },
  { id: 'math', label: 'Math', icon: '📐' },
  { id: 'table', label: 'Tables', icon: '📊' },
] as const;

export function ExploreView({ onSelectResult }: ExploreViewProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [fromAUI, setFromAUI] = useState(false);
  const [savedToHarvest, setSavedToHarvest] = useState(false);
  const [useChunkSearch, setUseChunkSearch] = useState(false);
  const [contentFilters, setContentFilters] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Archive health check - detect missing embeddings
  const { health, buildEmbeddings, isBuilding, buildProgress } = useArchiveHealth();
  const showSetup = needsEmbeddings(health);
  const ollamaReady = isOllamaAvailable(health);

  // Bookshelf for harvest bucket creation
  const { activeBookUri, createHarvestBucket } = useBookshelf();

  // Adaptive filters from FilterContext
  const { hasActiveFilters, activeFilterCount, buildFilterSpecs } = useFilters();

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

  const search = useCallback(async (searchQuery: string, contentTypeFilters: string[] = [], adaptiveFilterSpecs: FilterSpec[] = []) => {
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

      // Determine which endpoint to use:
      // - Filtered endpoint when adaptive filters are active
      // - Chunk search when content type filters are active
      // - Default message search otherwise
      let endpoint: string;
      let body: Record<string, unknown>;

      if (adaptiveFilterSpecs.length > 0) {
        // Use the new filtered search endpoint
        endpoint = '/api/embeddings/search/filtered';
        body = {
          query: searchQuery,
          filters: adaptiveFilterSpecs,
          limit: 20,
        };
      } else if (useChunkSearch || contentTypeFilters.length > 0) {
        // Use chunk search for content type filters
        endpoint = '/api/embeddings/search/chunks';
        body = {
          query: searchQuery,
          limit: 20,
          contentTypes: contentTypeFilters.length > 0 ? contentTypeFilters : undefined,
        };
      } else {
        // Default message search
        endpoint = '/api/embeddings/search/messages';
        body = {
          query: searchQuery,
          limit: 20,
        };
      }

      const response = await fetch(`${archiveServer}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      // Validate API response (per FALLBACK POLICY: no silent fallbacks)
      if (!data.results) {
        console.warn('[ExploreView.search] API response missing results field');
      }
      setResults(data.results || []);
    } catch (err) {
      setError('Semantic search requires embeddings. Build embeddings from the Import tab.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [useChunkSearch]);

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

  // Debounced search - triggers on query, content filters, or adaptive filters change
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.trim()) {
      debounceRef.current = setTimeout(() => {
        // Build filter specs from adaptive filters
        const filterSpecs = buildFilterSpecs();
        search(query, contentFilters, filterSpecs);
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
  }, [query, search, contentFilters, activeFilterCount, buildFilterSpecs]);

  // Toggle content type filter
  const toggleFilter = (typeId: string) => {
    setContentFilters(prev =>
      prev.includes(typeId)
        ? prev.filter(t => t !== typeId)
        : [...prev, typeId]
    );
  };

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

      {/* Content type filters (Phase 5) */}
      <div className="explore-filters">
        <span className="explore-filters__label">Filter by type:</span>
        {CONTENT_TYPES.map(type => (
          <button
            key={type.id}
            className={`explore-filters__chip ${contentFilters.includes(type.id) ? 'explore-filters__chip--active' : ''}`}
            onClick={() => toggleFilter(type.id)}
            title={`Filter to ${type.label} content`}
          >
            <span className="explore-filters__chip-icon">{type.icon}</span>
            <span className="explore-filters__chip-label">{type.label}</span>
          </button>
        ))}
        {contentFilters.length > 0 && (
          <button
            className="explore-filters__clear"
            onClick={() => setContentFilters([])}
            title="Clear all filters"
          >
            ✕
          </button>
        )}
      </div>

      {/* Adaptive filters (discovered from database) */}
      <AdaptiveFilters
        compact
        minCoverage={5}
        onFiltersChange={(count) => {
          console.log(`[ExploreView] Active filters: ${count}`);
        }}
      />

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

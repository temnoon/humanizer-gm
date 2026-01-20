/**
 * HarvestView - Search and harvest content into the book
 *
 * Provides:
 * - Archive search (semantic, text)
 * - Smart harvest with auto-filtering
 * - Progress tracking
 * - Result preview and commit to staging
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useBookStudio } from '../../../lib/book-studio/BookStudioProvider'
import {
  unifiedSearch,
  checkHealth,
  type SearchResult,
  type ContentType,
} from '../../../lib/archive-reader'
import { createCardFromSearchResult } from '../../../lib/book-studio/types'

type SearchMode = 'smart' | 'text' | 'semantic'

const CONTENT_TYPES: { value: ContentType; label: string; icon: string }[] = [
  { value: 'message', label: 'Messages', icon: '💬' },
  { value: 'post', label: 'Posts', icon: '📝' },
  { value: 'comment', label: 'Comments', icon: '💭' },
  { value: 'note', label: 'Notes', icon: '📄' },
  { value: 'document', label: 'Documents', icon: '📑' },
]

export function HarvestView() {
  const bookStudio = useBookStudio()
  const activeBook = bookStudio.activeBook

  // Default query to book title
  const [query, setQuery] = useState(() => activeBook?.title || '')
  const [searchMode, setSearchMode] = useState<SearchMode>('smart')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [archiveStatus, setArchiveStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [typeFilter, setTypeFilter] = useState<ContentType | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Track if user has manually edited the query
  const [userEditedQuery, setUserEditedQuery] = useState(false)

  // Update query to book title when book changes (if user hasn't edited)
  useEffect(() => {
    if (activeBook?.title && !userEditedQuery) {
      setQuery(activeBook.title)
    }
  }, [activeBook?.title, userEditedQuery])

  // Check archive health on mount
  useEffect(() => {
    checkHealth().then((health) => {
      setArchiveStatus(health.ready ? 'ready' : 'unavailable')
    })
  }, [])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search
  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([])
      return
    }

    setIsSearching(true)
    try {
      const response = await unifiedSearch(searchQuery, {
        limit: 30,
        types: typeFilter ? [typeFilter] : undefined,
        includeMessages: true,
        includeContentItems: true,
      })
      setResults(response.results)
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [typeFilter])

  // Track if user has started interacting (don't auto-search on mount)
  const [hasInteracted, setHasInteracted] = useState(false)

  // Debounce search input AND filter changes - only after user interacts
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Don't auto-search on mount - wait for user interaction
    if (!hasInteracted) {
      return
    }

    if (query.length >= 2) {
      // Longer debounce (500ms) to prevent rate limiting on rapid filter clicks
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(query)
      }, 500)
    } else {
      setResults([])
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [query, typeFilter, hasInteracted]) // Include typeFilter to debounce filter changes

  // Harvest target - could be made configurable per-book in the future
  const harvestTarget = 20

  // Run smart harvest
  const runSmartHarvest = useCallback(async () => {
    if (!query || query.length < 2) return

    try {
      await bookStudio.harvest.run(query, {
        target: harvestTarget,
        minWordCount: 20,
        expandBreadcrumbs: true,
      })
    } catch (error) {
      console.error('Harvest error:', error)
    }
  }, [query, bookStudio.harvest, harvestTarget])

  // Commit harvest results to staging
  const commitResults = useCallback(async () => {
    if (bookStudio.harvest.state.results.length > 0) {
      await bookStudio.harvest.commitResults()
    }
  }, [bookStudio.harvest])

  // Toggle result selection
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Add selected results to staging
  const addSelectedToStaging = useCallback(async () => {
    const selected = results.filter((r) => selectedIds.has(r.id))
    if (selected.length > 0) {
      // Convert to harvest cards using the utility function and add
      for (const result of selected) {
        const card = createCardFromSearchResult(result)
        await bookStudio.actions.harvestCard(card)
      }
      setSelectedIds(new Set())
    }
  }, [results, selectedIds, bookStudio.actions])

  const formatDate = (dateValue?: string | number) => {
    if (!dateValue) return ''
    try {
      const date = typeof dateValue === 'number'
        ? new Date(dateValue < 946684800000 ? dateValue * 1000 : dateValue)
        : new Date(dateValue)
      if (isNaN(date.getTime())) return ''
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return ''
    }
  }

  const truncateContent = (content: string, maxLength: number = 150) => {
    if (content.length <= maxLength) return content
    return content.slice(0, maxLength).trim() + '...'
  }

  const getTypeIcon = (type: ContentType) => {
    const found = CONTENT_TYPES.find((ct) => ct.value === type)
    return found?.icon || '📄'
  }

  const { state: harvestState } = bookStudio.harvest

  return (
    <div className="harvest-view">
      <div className="harvest-view__search-section">
        <div className="harvest-view__search-bar">
          <span className="harvest-view__search-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="harvest-view__input"
            placeholder={
              archiveStatus !== 'ready'
                ? archiveStatus === 'checking'
                  ? 'Connecting to archive...'
                  : 'Archive unavailable'
                : 'Search your archive...'
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setUserEditedQuery(true)
              setHasInteracted(true)
            }}
            disabled={archiveStatus !== 'ready'}
          />
          {isSearching && <span className="harvest-view__spinner">⏳</span>}
          {harvestState.isRunning && <span className="harvest-view__spinner">🌾</span>}
          {userEditedQuery && activeBook?.title && (
            <button
              className="harvest-view__reset-btn"
              onClick={() => {
                setQuery(activeBook.title)
                setUserEditedQuery(false)
              }}
              title="Reset to book title"
            >
              ↺
            </button>
          )}
        </div>

        <div className="harvest-view__controls">
          <div className="harvest-view__mode-buttons">
            {(['semantic', 'text', 'smart'] as SearchMode[]).map((mode) => (
              <button
                key={mode}
                className={`harvest-view__mode-btn ${searchMode === mode ? 'harvest-view__mode-btn--active' : ''}`}
                onClick={() => setSearchMode(mode)}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          <select
            className="harvest-view__type-filter"
            value={typeFilter || ''}
            onChange={(e) => {
              setTypeFilter(e.target.value as ContentType || null)
              setHasInteracted(true)
            }}
          >
            <option value="">All types</option>
            {CONTENT_TYPES.map((ct) => (
              <option key={ct.value} value={ct.value}>
                {ct.icon} {ct.label}
              </option>
            ))}
          </select>

          {query.length >= 2 && !harvestState.isRunning && (
            <button
              className="harvest-view__harvest-btn"
              onClick={runSmartHarvest}
            >
              🌾 Harvest
            </button>
          )}
        </div>
      </div>

      {/* Smart Harvest Progress */}
      {harvestState.isRunning && harvestState.progress && (
        <div className="harvest-view__progress">
          <div className="harvest-view__progress-header">
            <span className="harvest-view__progress-message">
              {harvestState.progress.message}
            </span>
            <button
              className="harvest-view__cancel-btn"
              onClick={() => bookStudio.harvest.clear()}
            >
              Cancel
            </button>
          </div>
          <div className="harvest-view__progress-bar">
            <div
              className="harvest-view__progress-fill"
              style={{
                width: `${(harvestState.progress.accepted / harvestState.progress.target) * 100}%`,
              }}
            />
          </div>
          <div className="harvest-view__progress-stats">
            <span>Found: {harvestState.progress.accepted}/{harvestState.progress.target}</span>
            <span>Searched: {harvestState.progress.searched}</span>
            <span>Filtered: {harvestState.progress.rejected}</span>
          </div>
        </div>
      )}

      {/* Show staged cards count */}
      {activeBook && activeBook.stagingCards && activeBook.stagingCards.length > 0 && (
        <div className="harvest-view__staged-notice">
          ✓ {activeBook.stagingCards.length} cards in staging
          <span className="harvest-view__staged-hint">
            (View in Staging tab - Cmd+4)
          </span>
        </div>
      )}

      {/* Harvest Results - auto-saved, shown for reference */}
      {harvestState.results.length > 0 && !harvestState.isRunning && (
        <div className="harvest-view__harvest-results">
          <div className="harvest-view__results-header">
            <span className="harvest-view__results-title">
              ✓ Harvested {harvestState.results.length} cards (auto-saved to staging)
            </span>
            <button
              className="harvest-view__clear-btn"
              onClick={() => bookStudio.harvest.clear()}
            >
              Clear Preview
            </button>
          </div>
          <div className="harvest-view__results-grid">
            {harvestState.results.slice(0, 12).map((result) => (
              <div key={result.card.id} className="harvest-view__result-card">
                <div className="harvest-view__result-header">
                  <span className="harvest-view__result-icon">
                    {getTypeIcon(result.original.type)}
                  </span>
                  <span className="harvest-view__result-source">
                    {result.original.source}
                  </span>
                </div>
                <div className="harvest-view__result-content">
                  {truncateContent(result.card.content, 100)}
                </div>
              </div>
            ))}
          </div>
          {harvestState.results.length > 12 && (
            <div className="harvest-view__more-results">
              +{harvestState.results.length - 12} more results
            </div>
          )}
        </div>
      )}

      {/* Search Results */}
      {results.length > 0 && harvestState.results.length === 0 && (
        <div className="harvest-view__search-results">
          <div className="harvest-view__results-header">
            <span className="harvest-view__results-title">
              Search Results ({results.length})
            </span>
            {selectedIds.size > 0 && (
              <button
                className="harvest-view__add-selected-btn"
                onClick={addSelectedToStaging}
              >
                Add {selectedIds.size} to Staging
              </button>
            )}
          </div>
          <div className="harvest-view__results-list">
            {results.map((result) => (
              <button
                key={result.id}
                className={`harvest-view__result ${selectedIds.has(result.id) ? 'harvest-view__result--selected' : ''}`}
                onClick={() => toggleSelection(result.id)}
              >
                <span className="harvest-view__result-checkbox">
                  {selectedIds.has(result.id) ? '☑' : '☐'}
                </span>
                <span className="harvest-view__result-icon">
                  {getTypeIcon(result.type)}
                </span>
                <div className="harvest-view__result-body">
                  <div className="harvest-view__result-preview">
                    {truncateContent(result.content)}
                  </div>
                  <div className="harvest-view__result-meta">
                    {result.source}
                    {result.createdAt && ` · ${formatDate(result.createdAt)}`}
                    {result.similarity < 1 && (
                      <span className="harvest-view__similarity">
                        {Math.round(result.similarity * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {query.length === 0 && harvestState.results.length === 0 && (
        <div className="harvest-view__empty">
          <div className="harvest-view__empty-icon">🌾</div>
          <h3>Harvest Content</h3>
          <p>Search your archive to find content for your book.</p>
          {activeBook?.title && (
            <p className="harvest-view__hint">
              Start typing or press <strong>Enter</strong> to search for "{activeBook.title}".
            </p>
          )}
          <p className="harvest-view__hint">
            Use "Smart Harvest" to automatically find and filter quality content.
          </p>
        </div>
      )}

      {query.length >= 2 && results.length === 0 && !isSearching && harvestState.results.length === 0 && (
        <div className="harvest-view__no-results">
          No results for "{query}"
        </div>
      )}

      {harvestState.error && (
        <div className="harvest-view__error">
          Error: {harvestState.error}
        </div>
      )}
    </div>
  )
}

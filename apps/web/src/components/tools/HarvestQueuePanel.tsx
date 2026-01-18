/**
 * HarvestQueuePanel - Tools panel for managing harvest buckets
 *
 * Shows active harvest buckets for the current book project.
 * Allows passage curation (approve/reject/gem) and bucket lifecycle management.
 */

import { useState, useCallback, useMemo } from 'react';
import { useBookshelf, type HarvestBucket, type SourcePassage } from '../../lib/bookshelf';
import { harvestBucketService } from '../../lib/bookshelf/HarvestBucketService';
import { getArchiveServerUrl } from '../../lib/platform';
import type { EntityURI } from '@humanizer/core';

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Default harvest settings - TODO: Make these user-configurable via settings UI
 */
const HARVEST_DEFAULTS = {
  /** Results per query (default: 40, range: 10-100) */
  resultsPerQuery: 40,
  /** Minimum similarity threshold (default: 0.3, range: 0.0-0.9) */
  minSimilarity: 0.3,
} as const;

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface HarvestQueuePanelProps {
  /** Currently selected book URI */
  bookUri: string | null;
  /** Callback when a passage is selected for viewing */
  onSelectPassage?: (passage: SourcePassage) => void;
  /** Callback to open source conversation in archive */
  onOpenSource?: (conversationId: string) => void;
  /** Callback to review full conversation in workspace */
  onReviewInWorkspace?: (conversationId: string, conversationTitle: string, passage: SourcePassage) => void;
}

type CurationAction = 'approve' | 'reject' | 'gem' | 'undo';

// ═══════════════════════════════════════════════════════════════════
// PASSAGE CARD
// ═══════════════════════════════════════════════════════════════════

interface PassageCardProps {
  passage: SourcePassage;
  onAction: (action: CurationAction) => void;
  onSelect?: () => void;
  onOpenSource?: (conversationId: string) => void;
  onReviewInWorkspace?: (conversationId: string, conversationTitle: string) => void;
  showActions?: boolean;
}

function PassageCard({ passage, onAction, onSelect, onOpenSource, onReviewInWorkspace, showActions = true }: PassageCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);  // DEBT-003 FIX: Track errors
  const [thumbnailError, setThumbnailError] = useState(false);  // Track thumbnail load errors
  const status = passage.curation?.status || 'candidate';
  const text = passage.text || '';
  const conversationId = passage.sourceRef?.conversationId;
  const conversationFolder = passage.sourceRef?.conversationFolder;  // Use folder for API calls
  const conversationTitle = passage.sourceRef?.conversationTitle || 'Unknown Source';

  // Media/thumbnail support
  const media = (passage as { media?: { thumbnail?: string; images?: string[]; imageCount?: number } }).media;
  const hasThumbnail = media?.thumbnail && !thumbnailError;

  // Show full content if loaded, otherwise show indexed text
  const displayText = fullContent || text;
  const isLong = displayText.length > 200 || text.length < 100; // Always allow expand for short indexed text
  const preview = isLong && !isExpanded ? displayText.slice(0, 200) + '...' : displayText;

  // Load full conversation content on expand
  const handleToggleExpand = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoadError(null);  // Clear any previous error

    // Use conversationFolder for API calls (folder name), fall back to conversationId
    const folderOrId = conversationFolder || conversationId;
    if (!isExpanded && !fullContent && folderOrId) {
      // Load full content from archive
      setLoadingContent(true);
      try {
        const { getArchiveServerUrl } = await import('../../lib/platform');
        const archiveServer = await getArchiveServerUrl();
        const response = await fetch(`${archiveServer}/api/conversations/${encodeURIComponent(folderOrId)}`);

        if (response.ok) {
          const data = await response.json();
          // Find the matching message or combine all assistant messages
          if (data.messages && data.messages.length > 0) {
            // Combine all messages for full context
            const fullText = data.messages
              .map((m: { role: string; content: string }) =>
                `**${m.role === 'user' ? 'You' : 'Assistant'}:**\n${typeof m.content === 'string' ? m.content : ''}`
              )
              .join('\n\n---\n\n');
            setFullContent(fullText);
          } else {
            // DEBT-003 FIX: Show error when no messages found
            setLoadError('Conversation has no messages. The indexed text shown above may be all that is available.');
          }
        } else if (response.status === 404) {
          // Conversation folder not found - common when using UUID lookup
          const hint = conversationFolder ? '' : ' The search result may reference a conversation that was not indexed properly. Try rebuilding the embedding index.';
          setLoadError(`Conversation not found.${hint} The indexed text shown above may be all that is available.`);
        } else {
          // DEBT-003 FIX: Show HTTP error to user
          setLoadError(`Failed to load conversation (HTTP ${response.status}). The indexed text shown above may be all that is available.`);
        }
      } catch (err) {
        // DEBT-003 FIX: Show error to user instead of just logging
        console.warn('[PassageCard] Failed to load full content:', err);
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        // "Load failed" usually means network/CORS issues
        const hint = errorMsg === 'Load failed' ? ' Check that the archive server is running.' : '';
        setLoadError(`Error loading conversation: ${errorMsg}.${hint} The indexed text shown above may be all that is available.`);
      } finally {
        setLoadingContent(false);
      }
    }

    setIsExpanded(!isExpanded);
  };

  const handleOpenSource = (e: React.MouseEvent) => {
    e.stopPropagation();
    const folderOrId = conversationFolder || conversationId;
    if (folderOrId && onOpenSource) {
      onOpenSource(folderOrId);
    }
  };

  return (
    <div
      className={`harvest-card harvest-card--${status} ${isExpanded ? 'harvest-card--expanded' : ''} ${hasThumbnail ? 'harvest-card--has-media' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect?.()}
    >
      {/* Thumbnail for visual passages */}
      {hasThumbnail && (
        <div className="harvest-card__thumbnail">
          <img
            src={`file://${media!.thumbnail}`}
            alt={conversationTitle}
            className="harvest-card__thumbnail-img"
            onError={() => setThumbnailError(true)}
          />
          {media!.imageCount && media!.imageCount > 1 && (
            <span className="harvest-card__image-count">
              +{media!.imageCount - 1}
            </span>
          )}
        </div>
      )}
      <div className="harvest-card__content">
        <div className="harvest-card__header">
          <div className="harvest-card__source">
            {conversationTitle}
          </div>
          {(conversationFolder || conversationId) && onOpenSource && (
            <button
              className="harvest-card__source-link"
              onClick={handleOpenSource}
              title="Open original conversation"
              aria-label="Open source conversation"
            >
              🔗 View Source
            </button>
          )}
          {(conversationFolder || conversationId) && onReviewInWorkspace && (
            <button
              className="harvest-card__review-btn"
              onClick={(e) => {
                e.stopPropagation();
                onReviewInWorkspace(conversationFolder || conversationId || '', conversationTitle);
              }}
              title="Review full conversation in workspace"
              aria-label="Review in workspace"
            >
              📖 Review
            </button>
          )}
        </div>
        <div className={`harvest-card__text ${isExpanded ? 'harvest-card__text--full' : ''}`}>
          {preview}
        </div>
        {isLong && (
          <button
            className="harvest-card__expand"
            onClick={handleToggleExpand}
            aria-expanded={isExpanded}
            disabled={loadingContent}
          >
            {loadingContent ? '⏳ Loading full conversation...' : isExpanded ? '▲ Show less' : '▼ Load full conversation'}
          </button>
        )}
        {/* DEBT-003 FIX: Show load errors to user */}
        {loadError && (
          <div className="harvest-card__error" role="alert">
            ⚠️ {loadError}
          </div>
        )}
        <div className="harvest-card__meta">
          {passage.wordCount} words
          {passage.similarity !== undefined && (
            <> · {Math.round(passage.similarity * 100)}% match</>
          )}
        </div>
      </div>

      {showActions && (
        <div className="harvest-card__actions" onClick={(e) => e.stopPropagation()}>
          {status === 'candidate' && (
            <>
              <button
                className="harvest-btn harvest-btn--gem"
                onClick={() => onAction('gem')}
                title="Mark as Gem"
                aria-label="Mark as gem"
              >
                💎
              </button>
              <button
                className="harvest-btn harvest-btn--approve"
                onClick={() => onAction('approve')}
                title="Approve"
                aria-label="Approve passage"
              >
                ✓
              </button>
              <button
                className="harvest-btn harvest-btn--reject"
                onClick={() => onAction('reject')}
                title="Reject"
                aria-label="Reject passage"
              >
                ✗
              </button>
            </>
          )}
          {(status === 'approved' || status === 'gem' || status === 'rejected') && (
            <button
              className="harvest-btn harvest-btn--undo"
              onClick={() => onAction('undo')}
              title="Move back to candidates"
              aria-label="Undo curation"
            >
              ↩
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BUCKET HEADER
// ═══════════════════════════════════════════════════════════════════

interface BucketHeaderProps {
  bucket: HarvestBucket;
  isExpanded: boolean;
  onToggle: () => void;
  onRunHarvest?: () => void;
  onStage?: () => void;
  onCommit?: () => void;
  onDiscard?: () => void;
  isHarvesting?: boolean;
}

function BucketHeader({
  bucket,
  isExpanded,
  onToggle,
  onRunHarvest,
  onStage,
  onCommit,
  onDiscard,
  isHarvesting = false,
}: BucketHeaderProps) {
  const progress = bucket.stats.totalCandidates > 0
    ? Math.round((bucket.stats.reviewed / bucket.stats.totalCandidates) * 100)
    : 0;

  const canStage = bucket.status === 'reviewing' &&
    (bucket.approved.length > 0 || bucket.gems.length > 0);
  const canCommit = bucket.status === 'staged';
  const canHarvest = bucket.status === 'collecting' && bucket.candidates.length === 0;

  return (
    <div className="bucket-header">
      <button
        className="bucket-header__toggle"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <span className="bucket-header__icon">
          {isExpanded ? '▼' : '▶'}
        </span>
        <span className="bucket-header__title">{bucket.name}</span>
        <span className={`bucket-header__status bucket-header__status--${bucket.status}`}>
          {bucket.status}
        </span>
      </button>

      {/* Show queries used for this bucket */}
      {bucket.queries && bucket.queries.length > 0 && (
        <div className="bucket-header__queries">
          <span className="bucket-header__queries-label">🔍</span>
          <span className="bucket-header__queries-text">
            {bucket.queries.join(', ')}
          </span>
        </div>
      )}

      <div className="bucket-header__stats">
        <span className="bucket-stat" title="Candidates">
          📥 {bucket.candidates.length}
        </span>
        <span className="bucket-stat bucket-stat--approved" title="Approved">
          ✓ {bucket.stats.approved}
        </span>
        <span className="bucket-stat bucket-stat--gems" title="Gems">
          💎 {bucket.stats.gems}
        </span>
      </div>

      {bucket.status === 'reviewing' && (
        <div className="bucket-header__progress">
          <div
            className="bucket-header__progress-bar"
            style={{ width: `${progress}%` }}
          />
          <span className="bucket-header__progress-text">{progress}%</span>
        </div>
      )}

      <div className="bucket-header__actions">
        {canHarvest && (
          <button
            className="bucket-action bucket-action--harvest"
            onClick={onRunHarvest}
            disabled={isHarvesting}
            title="Run semantic search to find candidates"
            aria-label="Run harvest to find passages"
          >
            {isHarvesting ? '⏳ Searching...' : '🌾 Run Harvest'}
          </button>
        )}
        {canStage && (
          <button
            className="bucket-action bucket-action--stage"
            onClick={onStage}
            title="Stage for commit"
            aria-label="Stage approved passages for commit"
          >
            Stage
          </button>
        )}
        {canCommit && (
          <button
            className="bucket-action bucket-action--commit"
            onClick={onCommit}
            title="Commit to book"
            aria-label="Commit staged passages to book"
          >
            Commit
          </button>
        )}
        {bucket.status !== 'committed' && bucket.status !== 'discarded' && (
          <button
            className="bucket-action bucket-action--discard"
            onClick={onDiscard}
            title="Discard bucket"
            aria-label="Discard this harvest bucket"
          >
            ✗
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function HarvestQueuePanel({ bookUri, onSelectPassage, onOpenSource, onReviewInWorkspace }: HarvestQueuePanelProps) {
  const bookshelf = useBookshelf();
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());
  const [activeSection, setActiveSection] = useState<'candidates' | 'approved' | 'rejected'>('candidates');
  const [harvestingBuckets, setHarvestingBuckets] = useState<Set<string>>(new Set());
  const [harvestError, setHarvestError] = useState<string | null>(null);

  // Get active buckets for current book
  // Include bucketVersion in dependencies to refresh when buckets change
  const activeBuckets = useMemo(() => {
    if (!bookUri) return [];
    return bookshelf.getActiveBuckets(bookUri);
  }, [bookUri, bookshelf, bookshelf.bucketVersion]);

  // Toggle bucket expansion
  const toggleBucket = useCallback((bucketId: string) => {
    setExpandedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucketId)) {
        next.delete(bucketId);
      } else {
        next.add(bucketId);
      }
      return next;
    });
  }, []);

  // Run semantic search to populate a bucket with candidates
  const handleRunHarvest = useCallback(async (bucketId: string) => {
    const bucket = bookshelf.getBucket(bucketId);
    if (!bucket || bucket.queries.length === 0) {
      setHarvestError('No queries defined for this harvest');
      return;
    }

    setHarvestingBuckets((prev) => new Set(prev).add(bucketId));
    setHarvestError(null);

    try {
      const archiveServer = await getArchiveServerUrl();

      // Execute search for each query and combine results
      const allResults: Array<{
        id: string;
        content: string;
        similarity: number;
        conversationId?: string;
        conversationFolder?: string;  // Folder name for API calls
        conversationTitle?: string;
      }> = [];

      for (const query of bucket.queries) {
        try {
          const response = await fetch(`${archiveServer}/api/embeddings/search/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              limit: HARVEST_DEFAULTS.resultsPerQuery,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.results) {
              allResults.push(...data.results);
            }
          }
        } catch (err) {
          console.warn(`[HarvestQueue] Search failed for query "${query}":`, err);
        }
      }

      // Dedupe results by ID
      const seenIds = new Set<string>();
      const uniqueResults = allResults.filter((r) => {
        if (seenIds.has(r.id)) return false;
        seenIds.add(r.id);
        return true;
      });

      // Convert to passages and add to bucket
      for (const result of uniqueResults) {
        const passage: SourcePassage = {
          id: result.id || `harvest-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          text: result.content,
          wordCount: result.content.split(/\s+/).length,
          similarity: result.similarity,
          timestamp: Date.now(),
          sourceRef: {
            uri: `source://chatgpt/${result.conversationFolder || result.conversationId}` as EntityURI,
            sourceType: 'chatgpt',
            conversationId: result.conversationId,
            conversationFolder: result.conversationFolder,  // Folder name for API calls
            conversationTitle: result.conversationTitle,
          },
          curation: {
            status: 'candidate',
            curatedAt: Date.now(),
          },
          tags: [],
        };
        harvestBucketService.addCandidate(bucketId, passage);
      }

      // If we got results, transition to reviewing status
      if (uniqueResults.length > 0) {
        // Use IPC to transition bucket status
        if (window.isElectron && window.electronAPI?.xanadu?.harvestBuckets) {
          // CRITICAL: Save bucket with candidates to DB BEFORE calling finishCollecting
          // This fixes the race condition where async fire-and-forget saves haven't completed
          const currentBucket = harvestBucketService.getBucket(bucketId);
          if (currentBucket) {
            console.log(`[HarvestQueue] Saving bucket with ${currentBucket.candidates.length} candidates to Xanadu`);
            await window.electronAPI.xanadu.harvestBuckets.upsert({
              id: currentBucket.id,
              bookId: currentBucket.bookUri.replace('book://', '').replace(/^user\//, ''),
              bookUri: currentBucket.bookUri,
              status: currentBucket.status,
              queries: currentBucket.queries,
              candidates: currentBucket.candidates,
              approved: currentBucket.approved,
              gems: currentBucket.gems,
              rejected: currentBucket.rejected,
              duplicateIds: currentBucket.duplicateIds,
              config: currentBucket.config,
              stats: currentBucket.stats,
              initiatedBy: currentBucket.initiatedBy,
            });
          }

          // Now safe to call finishCollecting - bucket has candidates in DB
          const result = await window.electronAPI.xanadu.harvest.finishCollecting(bucketId);
          if (!result.success) {
            console.warn('[HarvestQueue] finishCollecting failed:', result.error);
          }
          await harvestBucketService.refreshBucketFromXanadu(bucketId);
          bookshelf.refreshBuckets();
        } else {
          // Fallback for dev mode
          harvestBucketService.finishCollecting(bucketId);
        }
        console.log(`[HarvestQueue] Added ${uniqueResults.length} candidates from ${bucket.queries.length} queries`);
      } else {
        setHarvestError('No results found. Try different search queries.');
      }
    } catch (err) {
      console.error('[HarvestQueue] Harvest failed:', err);
      setHarvestError('Semantic search failed. Make sure embeddings are built.');
    } finally {
      setHarvestingBuckets((prev) => {
        const next = new Set(prev);
        next.delete(bucketId);
        return next;
      });
    }
  }, [bookshelf]);

  // Wait for IPC to become available (handles race condition on startup)
  const waitForHarvestIpc = useCallback(async (maxWaitMs = 3000): Promise<boolean> => {
    if (window.isElectron && window.electronAPI?.xanadu?.harvest) {
      return true;
    }

    // Poll every 200ms for up to maxWaitMs
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (window.isElectron && window.electronAPI?.xanadu?.harvest) {
        return true;
      }
    }
    return false;
  }, []);

  // Handle passage curation - calls IPC directly, then refreshes from DB
  const handlePassageAction = useCallback(
    async (bucketId: string, passageId: string, action: CurationAction) => {
      // Wait for Xanadu IPC to become available (handles startup race condition)
      const ipcAvailable = await waitForHarvestIpc();
      if (!ipcAvailable) {
        console.error('[HarvestQueuePanel] Xanadu harvest IPC not available after waiting');
        setHarvestError('Harvest operations not available. Try again in a moment or restart the app.');
        return;
      }

      try {
        let result: { success: boolean; error?: string };

        // Call appropriate IPC handler
        switch (action) {
          case 'approve':
            result = await window.electronAPI.xanadu.harvest.approvePassage(bucketId, passageId);
            break;
          case 'reject':
            result = await window.electronAPI.xanadu.harvest.rejectPassage(bucketId, passageId);
            break;
          case 'gem':
            result = await window.electronAPI.xanadu.harvest.gemPassage(bucketId, passageId);
            break;
          case 'undo':
            result = await window.electronAPI.xanadu.harvest.undoPassage(bucketId, passageId);
            break;
          default:
            console.warn('[HarvestQueuePanel] Unknown action:', action);
            return;
        }

        if (!result.success) {
          console.error(`[HarvestQueuePanel] ${action} failed:`, result.error);
          setHarvestError(`Failed to ${action} passage: ${result.error}`);
          return;
        }

        // Refresh bucket from database to sync in-memory state
        await harvestBucketService.refreshBucketFromXanadu(bucketId);

        // Trigger UI re-render
        bookshelf.refreshBuckets();

        console.log(`[HarvestQueuePanel] ${action} succeeded for passage ${passageId}`);
      } catch (err) {
        console.error(`[HarvestQueuePanel] ${action} error:`, err);
        setHarvestError(`Error during ${action}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [bookshelf, waitForHarvestIpc]
  );

  // Handle bucket lifecycle - calls IPC directly, then refreshes from DB
  const handleStageBucket = useCallback(async (bucketId: string) => {
    const ipcAvailable = await waitForHarvestIpc();
    if (!ipcAvailable) {
      setHarvestError('Harvest operations not available. Try again in a moment or restart the app.');
      return;
    }

    try {
      const result = await window.electronAPI.xanadu.harvest.stageBucket(bucketId);
      if (!result.success) {
        setHarvestError(`Failed to stage bucket: ${result.error}`);
        return;
      }

      await harvestBucketService.refreshBucketFromXanadu(bucketId);
      bookshelf.refreshBuckets();
      console.log(`[HarvestQueuePanel] Staged bucket with ${result.approvedCount} approved, ${result.gemCount} gems`);
    } catch (err) {
      console.error('[HarvestQueuePanel] Stage error:', err);
      setHarvestError(`Error staging bucket: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [bookshelf, waitForHarvestIpc]);

  const handleCommitBucket = useCallback(async (bucketId: string) => {
    const ipcAvailable = await waitForHarvestIpc();
    if (!ipcAvailable) {
      setHarvestError('Harvest operations not available. Try again in a moment or restart the app.');
      return;
    }

    try {
      const result = await window.electronAPI.xanadu.harvest.commitBucket(bucketId);
      if (!result.success) {
        setHarvestError(`Failed to commit bucket: ${result.error}`);
        return;
      }

      await harvestBucketService.refreshBucketFromXanadu(bucketId);
      bookshelf.refreshBuckets();
      console.log(`[HarvestQueuePanel] Committed ${result.passageCount} passages to book`);
    } catch (err) {
      console.error('[HarvestQueuePanel] Commit error:', err);
      setHarvestError(`Error committing bucket: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [bookshelf, waitForHarvestIpc]);

  const handleDiscardBucket = useCallback(async (bucketId: string) => {
    if (!window.confirm('Discard this harvest? All candidates will be lost.')) {
      return;
    }

    const ipcAvailable = await waitForHarvestIpc();
    if (!ipcAvailable) {
      setHarvestError('Harvest operations not available. Try again in a moment or restart the app.');
      return;
    }

    try {
      const result = await window.electronAPI.xanadu.harvest.discardBucket(bucketId);
      if (!result.success) {
        setHarvestError(`Failed to discard bucket: ${result.error}`);
        return;
      }

      await harvestBucketService.refreshBucketFromXanadu(bucketId);
      bookshelf.refreshBuckets();
      console.log('[HarvestQueuePanel] Bucket discarded');
    } catch (err) {
      console.error('[HarvestQueuePanel] Discard error:', err);
      setHarvestError(`Error discarding bucket: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [bookshelf, waitForHarvestIpc]);

  // Empty state
  if (!bookUri) {
    return (
      <div className="harvest-panel harvest-panel--empty">
        <p>Select a book project to view harvests</p>
      </div>
    );
  }

  if (activeBuckets.length === 0) {
    return (
      <div className="harvest-panel harvest-panel--empty">
        <p>No active harvests</p>
        <span className="harvest-panel__hint">
          Use AUI to start harvesting content for your book
        </span>
      </div>
    );
  }

  return (
    <div className="harvest-panel">
      <header className="harvest-panel__header">
        <h3 className="harvest-panel__title">Harvest Queue</h3>
        <span className="harvest-panel__count">
          {activeBuckets.length} active
        </span>
      </header>

      {/* Error message */}
      {harvestError && (
        <div className="harvest-panel__error">
          <span className="harvest-panel__error-icon">⚠️</span>
          <span className="harvest-panel__error-text">{harvestError}</span>
          <button
            className="harvest-panel__error-dismiss"
            onClick={() => setHarvestError(null)}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      <div className="harvest-panel__buckets">
        {activeBuckets.map((bucket) => (
          <div key={bucket.id} className="harvest-bucket">
            <BucketHeader
              bucket={bucket}
              isExpanded={expandedBuckets.has(bucket.id)}
              onToggle={() => toggleBucket(bucket.id)}
              onRunHarvest={() => handleRunHarvest(bucket.id)}
              onStage={() => handleStageBucket(bucket.id)}
              onCommit={() => handleCommitBucket(bucket.id)}
              onDiscard={() => handleDiscardBucket(bucket.id)}
              isHarvesting={harvestingBuckets.has(bucket.id)}
            />

            {expandedBuckets.has(bucket.id) && (
              <div className="harvest-bucket__content">
                {/* Section tabs */}
                <nav className="harvest-bucket__tabs">
                  <button
                    className={`harvest-tab ${activeSection === 'candidates' ? 'harvest-tab--active' : ''}`}
                    onClick={() => setActiveSection('candidates')}
                  >
                    Candidates ({bucket.candidates.length})
                  </button>
                  <button
                    className={`harvest-tab ${activeSection === 'approved' ? 'harvest-tab--active' : ''}`}
                    onClick={() => setActiveSection('approved')}
                  >
                    Approved ({bucket.approved.length + bucket.gems.length})
                  </button>
                  <button
                    className={`harvest-tab ${activeSection === 'rejected' ? 'harvest-tab--active' : ''}`}
                    onClick={() => setActiveSection('rejected')}
                  >
                    Rejected ({bucket.rejected.length})
                  </button>
                </nav>

                {/* Section content */}
                <div className="harvest-bucket__passages">
                  {activeSection === 'candidates' && (
                    bucket.candidates.length > 0 ? (
                      bucket.candidates.map((passage) => (
                        <PassageCard
                          key={passage.id}
                          passage={passage}
                          onAction={(action) => handlePassageAction(bucket.id, passage.id, action)}
                          onSelect={() => onSelectPassage?.(passage)}
                          onOpenSource={onOpenSource}
                          onReviewInWorkspace={onReviewInWorkspace ? (cId, cTitle) => onReviewInWorkspace(cId, cTitle, passage) : undefined}
                        />
                      ))
                    ) : (
                      <div className="harvest-empty">
                        All candidates reviewed
                      </div>
                    )
                  )}

                  {activeSection === 'approved' && (
                    [...bucket.gems, ...bucket.approved].length > 0 ? (
                      <>
                        {bucket.gems.map((passage) => (
                          <PassageCard
                            key={passage.id}
                            passage={{ ...passage, curation: { ...passage.curation, status: 'gem' } }}
                            onAction={(action) => handlePassageAction(bucket.id, passage.id, action)}
                            onSelect={() => onSelectPassage?.(passage)}
                            onOpenSource={onOpenSource}
                            onReviewInWorkspace={onReviewInWorkspace ? (cId, cTitle) => onReviewInWorkspace(cId, cTitle, passage) : undefined}
                          />
                        ))}
                        {bucket.approved.map((passage) => (
                          <PassageCard
                            key={passage.id}
                            passage={passage}
                            onAction={(action) => handlePassageAction(bucket.id, passage.id, action)}
                            onSelect={() => onSelectPassage?.(passage)}
                            onOpenSource={onOpenSource}
                            onReviewInWorkspace={onReviewInWorkspace ? (cId, cTitle) => onReviewInWorkspace(cId, cTitle, passage) : undefined}
                          />
                        ))}
                      </>
                    ) : (
                      <div className="harvest-empty">
                        No approved passages yet
                      </div>
                    )
                  )}

                  {activeSection === 'rejected' && (
                    bucket.rejected.length > 0 ? (
                      bucket.rejected.map((passage) => (
                        <PassageCard
                          key={passage.id}
                          passage={passage}
                          onAction={(action) => handlePassageAction(bucket.id, passage.id, action)}
                          onSelect={() => onSelectPassage?.(passage)}
                          onOpenSource={onOpenSource}
                          onReviewInWorkspace={onReviewInWorkspace ? (cId, cTitle) => onReviewInWorkspace(cId, cTitle, passage) : undefined}
                        />
                      ))
                    ) : (
                      <div className="harvest-empty">
                        No rejected passages
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default HarvestQueuePanel;

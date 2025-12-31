/**
 * HarvestQueuePanel - Tools panel for managing harvest buckets
 *
 * Shows active harvest buckets for the current book project.
 * Allows passage curation (approve/reject/gem) and bucket lifecycle management.
 */

import { useState, useCallback, useMemo } from 'react';
import { useBookshelf, type HarvestBucket, type SourcePassage } from '../../lib/bookshelf';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface HarvestQueuePanelProps {
  /** Currently selected book URI */
  bookUri: string | null;
  /** Callback when a passage is selected for viewing */
  onSelectPassage?: (passage: SourcePassage) => void;
}

type CurationAction = 'approve' | 'reject' | 'gem' | 'undo';

// ═══════════════════════════════════════════════════════════════════
// PASSAGE CARD
// ═══════════════════════════════════════════════════════════════════

interface PassageCardProps {
  passage: SourcePassage;
  onAction: (action: CurationAction) => void;
  onSelect?: () => void;
  showActions?: boolean;
}

function PassageCard({ passage, onAction, onSelect, showActions = true }: PassageCardProps) {
  const status = passage.curation?.status || 'candidate';
  const text = passage.text || '';
  const preview = text.length > 150 ? text.slice(0, 150) + '...' : text;

  return (
    <div
      className={`harvest-card harvest-card--${status}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect?.()}
    >
      <div className="harvest-card__content">
        <div className="harvest-card__source">
          {passage.sourceRef?.conversationTitle || 'Unknown Source'}
        </div>
        <div className="harvest-card__text">{preview}</div>
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
  onStage?: () => void;
  onCommit?: () => void;
  onDiscard?: () => void;
}

function BucketHeader({
  bucket,
  isExpanded,
  onToggle,
  onStage,
  onCommit,
  onDiscard,
}: BucketHeaderProps) {
  const progress = bucket.stats.totalCandidates > 0
    ? Math.round((bucket.stats.reviewed / bucket.stats.totalCandidates) * 100)
    : 0;

  const canStage = bucket.status === 'reviewing' &&
    (bucket.approved.length > 0 || bucket.gems.length > 0);
  const canCommit = bucket.status === 'staged';

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
        {canStage && (
          <button
            className="bucket-action bucket-action--stage"
            onClick={onStage}
            title="Stage for commit"
          >
            Stage
          </button>
        )}
        {canCommit && (
          <button
            className="bucket-action bucket-action--commit"
            onClick={onCommit}
            title="Commit to book"
          >
            Commit
          </button>
        )}
        {bucket.status !== 'committed' && bucket.status !== 'discarded' && (
          <button
            className="bucket-action bucket-action--discard"
            onClick={onDiscard}
            title="Discard bucket"
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

export function HarvestQueuePanel({ bookUri, onSelectPassage }: HarvestQueuePanelProps) {
  const bookshelf = useBookshelf();
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());
  const [activeSection, setActiveSection] = useState<'candidates' | 'approved' | 'rejected'>('candidates');

  // Get active buckets for current book
  const activeBuckets = useMemo(() => {
    if (!bookUri) return [];
    return bookshelf.getActiveBuckets(bookUri);
  }, [bookUri, bookshelf]);

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

  // Handle passage curation
  const handlePassageAction = useCallback(
    (bucketId: string, passageId: string, action: CurationAction) => {
      switch (action) {
        case 'approve':
          bookshelf.approvePassage(bucketId, passageId);
          break;
        case 'reject':
          bookshelf.rejectPassage(bucketId, passageId);
          break;
        case 'gem':
          bookshelf.markAsGem(bucketId, passageId);
          break;
        case 'undo':
          bookshelf.moveToCandidates(bucketId, passageId);
          break;
      }
    },
    [bookshelf]
  );

  // Handle bucket lifecycle
  const handleStageBucket = useCallback((bucketId: string) => {
    bookshelf.stageBucket(bucketId);
  }, [bookshelf]);

  const handleCommitBucket = useCallback((bucketId: string) => {
    bookshelf.commitBucket(bucketId);
  }, [bookshelf]);

  const handleDiscardBucket = useCallback((bucketId: string) => {
    if (window.confirm('Discard this harvest? All candidates will be lost.')) {
      bookshelf.discardBucket(bucketId);
    }
  }, [bookshelf]);

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

      <div className="harvest-panel__buckets">
        {activeBuckets.map((bucket) => (
          <div key={bucket.id} className="harvest-bucket">
            <BucketHeader
              bucket={bucket}
              isExpanded={expandedBuckets.has(bucket.id)}
              onToggle={() => toggleBucket(bucket.id)}
              onStage={() => handleStageBucket(bucket.id)}
              onCommit={() => handleCommitBucket(bucket.id)}
              onDiscard={() => handleDiscardBucket(bucket.id)}
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
                          />
                        ))}
                        {bucket.approved.map((passage) => (
                          <PassageCard
                            key={passage.id}
                            passage={passage}
                            onAction={(action) => handlePassageAction(bucket.id, passage.id, action)}
                            onSelect={() => onSelectPassage?.(passage)}
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

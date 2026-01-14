/**
 * Facebook View - Social archive orchestrator
 *
 * Features:
 * - Feed view: posts and comments with filters
 * - Media gallery: thumbnail grid with size control
 * - Notes: expandable note list
 * - Groups: group activity with content
 * - Messenger: conversation threads
 * - Advertisers: tracking insights
 *
 * Modularized: Each view mode is a separate component.
 */

import { useState, useEffect } from 'react';
import type { SelectedFacebookMedia, SelectedFacebookContent } from './types';
import type { FacebookPeriod, ViewMode } from './facebook/shared';
import { getArchiveServerUrl } from '../../lib/platform';

// Sub-views
import { FacebookFeedView } from './facebook/FacebookFeedView';
import { FacebookGalleryView } from './facebook/FacebookGalleryView';
import { FacebookNotesView } from './facebook/FacebookNotesView';
import { FacebookGroupsView } from './facebook/FacebookGroupsView';
import { FacebookMessengerView } from './facebook/FacebookMessengerView';
import { FacebookAdvertisersView } from './facebook/FacebookAdvertisersView';

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export interface FacebookViewProps {
  /** Callback when a media item is selected for display in main workspace */
  onSelectMedia?: (media: SelectedFacebookMedia) => void;
  /** Callback when a content item (post/comment) is selected for display in main workspace */
  onSelectContent?: (content: SelectedFacebookContent) => void;
  /** Callback to open the social graph in main workspace */
  onOpenGraph?: () => void;
}

export function FacebookView({ onSelectMedia, onSelectContent, onOpenGraph }: FacebookViewProps) {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      return (localStorage.getItem('fb_view_mode') as ViewMode) || 'feed';
    } catch { return 'feed'; }
  });

  // Periods (shared across views)
  const [periods, setPeriods] = useState<FacebookPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);

  // Save view mode to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('fb_view_mode', viewMode);
    } catch {}
  }, [viewMode]);

  // Load periods on mount
  useEffect(() => {
    loadPeriods();
  }, []);

  const loadPeriods = async () => {
    try {
      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/periods`);
      if (res.ok) {
        const data = await res.json();
        if (!data.periods) {
          console.warn('[FacebookView.loadPeriods] API response missing periods field');
        }
        setPeriods(data.periods || []);
      }
    } catch (err) {
      console.error('Failed to load periods:', err);
    }
  };

  const totalPeriodCount = periods.reduce((sum, p) => sum + p.count, 0);

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="facebook-view">
      {/* Header with view tabs */}
      <div className="facebook-view__header">
        <div className="facebook-view__tabs">
          <button
            className={`facebook-view__tab ${viewMode === 'feed' ? 'facebook-view__tab--active' : ''}`}
            onClick={() => setViewMode('feed')}
          >
            Feed
          </button>
          <button
            className={`facebook-view__tab ${viewMode === 'gallery' ? 'facebook-view__tab--active' : ''}`}
            onClick={() => setViewMode('gallery')}
          >
            Gallery
          </button>
          <button
            className={`facebook-view__tab ${viewMode === 'notes' ? 'facebook-view__tab--active' : ''}`}
            onClick={() => setViewMode('notes')}
          >
            Notes
          </button>
          <button
            className={`facebook-view__tab ${viewMode === 'groups' ? 'facebook-view__tab--active' : ''}`}
            onClick={() => setViewMode('groups')}
          >
            Groups
          </button>
          <button
            className={`facebook-view__tab ${viewMode === 'messenger' ? 'facebook-view__tab--active' : ''}`}
            onClick={() => setViewMode('messenger')}
          >
            Messenger
          </button>
          <button
            className={`facebook-view__tab ${viewMode === 'advertisers' ? 'facebook-view__tab--active' : ''}`}
            onClick={() => setViewMode('advertisers')}
          >
            Advertisers
          </button>
          {onOpenGraph && (
            <button
              className="facebook-view__tab facebook-view__tab--graph"
              onClick={onOpenGraph}
              title="Open Social Graph in workspace"
            >
              Graph
            </button>
          )}
        </div>

        {/* Period selector - only show for feed and gallery */}
        {(viewMode === 'feed' || viewMode === 'gallery') && (
          <button
            className="facebook-view__period-btn"
            onClick={() => setShowPeriodPicker(!showPeriodPicker)}
          >
            {selectedPeriod ? selectedPeriod.replace('_', ' ') : 'All Time'}
            <span className="facebook-view__period-count">
              ({selectedPeriod
                ? periods.find(p => p.period === selectedPeriod)?.count || 0
                : totalPeriodCount})
            </span>
          </button>
        )}
      </div>

      {/* Period picker dropdown */}
      {showPeriodPicker && (viewMode === 'feed' || viewMode === 'gallery') && (
        <div className="facebook-view__period-picker">
          <button
            className={`facebook-view__period-option ${!selectedPeriod ? 'facebook-view__period-option--active' : ''}`}
            onClick={() => { setSelectedPeriod(''); setShowPeriodPicker(false); }}
          >
            All Time ({totalPeriodCount})
          </button>
          {periods.map(p => (
            <button
              key={p.period}
              className={`facebook-view__period-option ${selectedPeriod === p.period ? 'facebook-view__period-option--active' : ''}`}
              onClick={() => { setSelectedPeriod(p.period); setShowPeriodPicker(false); }}
            >
              {p.period.replace('_', ' ')} ({p.count})
            </button>
          ))}
        </div>
      )}

      {/* View content - render the appropriate sub-view */}
      {viewMode === 'feed' && (
        <FacebookFeedView
          selectedPeriod={selectedPeriod}
          onSelectContent={onSelectContent}
        />
      )}

      {viewMode === 'gallery' && (
        <FacebookGalleryView
          selectedPeriod={selectedPeriod}
          onSelectMedia={onSelectMedia}
        />
      )}

      {viewMode === 'notes' && (
        <FacebookNotesView
          onSelectContent={onSelectContent}
        />
      )}

      {viewMode === 'groups' && (
        <FacebookGroupsView
          onSelectContent={onSelectContent}
        />
      )}

      {viewMode === 'messenger' && (
        <FacebookMessengerView />
      )}

      {viewMode === 'advertisers' && (
        <FacebookAdvertisersView />
      )}
    </div>
  );
}

/**
 * TopBar - Main navigation bar with panels and breadcrumbs
 *
 * Features:
 * - Archive panel (left) and Tools panel (right)
 * - Breadcrumb navigation
 * - User menu
 * - Undo/Redo controls
 *
 * Extracted from Studio.tsx during modularization
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../lib/auth';
import { useLayout } from './LayoutContext';
import { useBuffers, type ArchiveSource } from '../../lib/buffer';
import { subscribeToGUIActions } from '../../lib/aui';
import { HoverPanel } from './HoverPanel';
import { UserDropdown } from './UserDropdown';
import { ArchivePanel, type SelectedFacebookMedia, type SelectedFacebookContent, type ArchiveTabId, type SearchResult } from '../archive';
import { ToolsPanel } from '../tools';
import { LoginPage } from '../auth/LoginPage';
import type { BookContent } from '../workspace';
import type { BookProject } from '../archive/book-project/types';
import type { SourcePassage } from '@humanizer/core';

export interface TopBarProps {
  onSelectMedia: (media: SelectedFacebookMedia) => void;
  onSelectContent: (content: SelectedFacebookContent) => void;
  onOpenGraph: () => void;
  onSelectBookContent?: (content: BookContent, project: BookProject) => void;
  onTransformComplete?: (original: string, transformed: string, transformType: string) => void;
  onBreadcrumbClick?: (index: number, path: string[], archiveSource: ArchiveSource) => void;
  onSelectSearchResult?: (result: SearchResult) => void;
  archiveTab?: ArchiveTabId;
  onArchiveTabChange?: (tab: ArchiveTabId | undefined) => void;
  onReviewInWorkspace?: (conversationId: string, conversationTitle: string, passage: import('@humanizer/core').SourcePassage) => void;
}

export function TopBar({ onSelectMedia, onSelectContent, onOpenGraph, onSelectBookContent, onTransformComplete, onBreadcrumbClick, onSelectSearchResult, archiveTab, onArchiveTabChange, onReviewInWorkspace }: TopBarProps) {
  const { user, isAuthenticated, logout } = useAuth();
  const { isPanelVisible, togglePanel } = useLayout();
  const { activeBuffer, activeNode, canUndo, canRedo, undo, redo } = useBuffers();
  const [visible, setVisible] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const setArchiveTab = onArchiveTabChange || (() => {});

  // Map archive source type to tab ID
  const mapSourceTypeToTab = (type: string): ArchiveTabId => {
    switch (type) {
      case 'chatgpt':
        return 'conversations';
      case 'facebook':
        return 'facebook';
      case 'book':
      case 'book-chapter':
      case 'book-passage':
      case 'book-thinking':
        return 'books';
      case 'filesystem':
        return 'files';
      default:
        return 'conversations';
    }
  };

  // Panel state from layout context - must be defined before callbacks that use them
  const leftOpen = isPanelVisible('archives');
  const rightOpen = isPanelVisible('tools');
  const setLeftOpen = (open: boolean) => {
    if (open !== leftOpen) togglePanel('archives');
  };
  const setRightOpen = (open: boolean) => {
    if (open !== rightOpen) togglePanel('tools');
  };

  // Handle breadcrumb navigation
  const handleBreadcrumbClick = useCallback((index: number, path: string[], archiveSource: ArchiveSource) => {
    // Navigate to the appropriate tab based on archive source type
    const targetTab = mapSourceTypeToTab(archiveSource.type);
    setArchiveTab(targetTab);

    // Open the archive panel if not already open
    if (!leftOpen) {
      togglePanel('archives');
    }

    // Call the external handler if provided
    onBreadcrumbClick?.(index, path, archiveSource);
  }, [onBreadcrumbClick, leftOpen, togglePanel]);

  // Subscribe to GUI actions from AUI tools (e.g., open_panel)
  useEffect(() => {
    const unsubscribe = subscribeToGUIActions((action) => {
      if (action.type === 'open_panel') {
        const data = action.data as { panel?: string } | undefined;
        const panel = data?.panel as 'archives' | 'tools' | undefined;
        if (panel === 'archives' && !leftOpen) {
          togglePanel('archives');
        } else if (panel === 'tools' && !rightOpen) {
          togglePanel('tools');
        }
        // TODO: Handle tab switching if action.data.tab is provided
      }
    });
    return unsubscribe;
  }, [leftOpen, rightOpen, togglePanel]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handleMove = () => {
      setVisible(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setVisible(false), 3000);
    };
    window.addEventListener('mousemove', handleMove);
    handleMove();
    return () => {
      window.removeEventListener('mousemove', handleMove);
      clearTimeout(timeout);
    };
  }, []);

  // Build breadcrumb from archive source
  const breadcrumbs = useMemo(() => {
    if (!activeNode?.metadata?.source?.path) return [];
    return activeNode.metadata.source.path;
  }, [activeNode]);

  // Document title for display
  const documentTitle = activeBuffer?.name || 'humanizer';

  return (
    <>
      <header className={`studio-topbar ${visible ? '' : 'studio-topbar--hidden'}`}>
        <div className="studio-topbar__left">
          <button
            className="studio-topbar__btn"
            onClick={() => setLeftOpen(!leftOpen)}
            aria-expanded={leftOpen}
          >
            ☰ Archive
          </button>
        </div>

        <div className="studio-topbar__center studio-topbar__center--nav">
          {/* Left arrow */}
          <button
            className="studio-topbar__nav"
            onClick={undo}
            disabled={!canUndo}
            title="Go back"
            aria-label="Go back"
          >
            ←
          </button>

          {/* Centered title/breadcrumbs */}
          <div className="studio-topbar__title-wrapper">
            {breadcrumbs.length > 0 && activeNode?.metadata?.source ? (
              <div className="studio-topbar__breadcrumb">
                {breadcrumbs.map((crumb: string, i: number) => (
                  <span key={i} className="studio-topbar__breadcrumb-item">
                    {i > 0 && <span className="studio-topbar__breadcrumb-sep">›</span>}
                    <button
                      className="studio-topbar__breadcrumb-link"
                      onClick={() => {
                        // Open archive panel and navigate to this level
                        if (!leftOpen) togglePanel('archives');
                        if (activeNode?.metadata?.source) {
                          handleBreadcrumbClick(i, breadcrumbs, activeNode.metadata.source);
                        }
                      }}
                      title={`Navigate to ${crumb}`}
                    >
                      {crumb}
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="studio-topbar__title">{documentTitle}</span>
            )}
          </div>

          {/* Right arrow */}
          <button
            className="studio-topbar__nav"
            onClick={redo}
            disabled={!canRedo}
            title="Go forward"
            aria-label="Go forward"
          >
            →
          </button>
        </div>

        <div className="studio-topbar__right">
          {/* User dropdown */}
          {isAuthenticated ? (
            <UserDropdown
              user={user}
              onSignOut={logout}
            />
          ) : (
            <button
              className="studio-topbar__btn studio-topbar__btn--signin"
              onClick={() => setShowLogin(true)}
            >
              Sign In
            </button>
          )}

          {/* Tools - far right */}
          <button
            className="studio-topbar__btn"
            onClick={() => setRightOpen(!rightOpen)}
            aria-expanded={rightOpen}
          >
            Tools
          </button>
        </div>
      </header>

      {/* Login modal */}
      {showLogin && (
        <LoginPage
          onSuccess={() => setShowLogin(false)}
          onClose={() => setShowLogin(false)}
        />
      )}

      <HoverPanel
        side="left"
        isOpen={leftOpen}
        onToggle={() => setLeftOpen(!leftOpen)}
        title="Archive"
      >
        <ArchivePanel
          onClose={() => setLeftOpen(false)}
          onSelectMedia={onSelectMedia}
          onSelectContent={onSelectContent}
          onOpenGraph={onOpenGraph}
          onSelectBookContent={onSelectBookContent}
          onSelectSearchResult={onSelectSearchResult}
          navigateToTab={archiveTab}
          onTabChange={setArchiveTab}
        />
      </HoverPanel>

      <HoverPanel
        side="right"
        isOpen={rightOpen}
        onToggle={() => setRightOpen(!rightOpen)}
        title="Tools"
      >
        <ToolsPanel
          onClose={() => setRightOpen(false)}
          onTransformComplete={onTransformComplete}
          onReviewInWorkspace={onReviewInWorkspace}
        />
      </HoverPanel>
    </>
  );
}

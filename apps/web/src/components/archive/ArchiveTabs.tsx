/**
 * Archive Tabs - Container for tabbed archive navigation
 */

import { useState, useEffect, type ReactNode } from 'react';
import { ArchiveIconTabBar } from './ArchiveIconTabBar';
import { GalleryView } from './GalleryView';
import { ImportView } from './ImportView';
import { BooksView } from './BooksView';
import { FacebookView } from './FacebookView';
import { ExploreView, type SearchResult } from './ExploreView';
import { FilesView } from './FilesView';
import { AUIChatTab } from '../aui/AUIChatTab';
import { QueueTab } from '../queue';
import type { ArchiveTabId, SelectedFacebookMedia, SelectedFacebookContent } from './types';
import type { BookProject } from './book-project/types';
import type { BookContent } from '../workspace/BookContentView';

const STORAGE_KEY = 'humanizer-archive-tab';

interface ArchiveTabsProps {
  /** Render the conversations tab content */
  renderConversations: () => ReactNode;
  /** Callback when Facebook media is selected for main workspace */
  onSelectMedia?: (media: SelectedFacebookMedia) => void;
  /** Callback when Facebook content (post/comment) is selected for main workspace */
  onSelectContent?: (content: SelectedFacebookContent) => void;
  /** Callback to open the social graph in main workspace */
  onOpenGraph?: () => void;
  /** Callback when book content is selected for main workspace */
  onSelectBookContent?: (content: BookContent, project: BookProject) => void;
  /** Callback when a semantic search result is selected */
  onSelectSearchResult?: (result: SearchResult) => void;
  /** Controlled tab value (optional) */
  controlledTab?: ArchiveTabId;
  /** Callback when tab changes (for controlled mode) */
  onTabChange?: (tab: ArchiveTabId) => void;
}

export function ArchiveTabs({ renderConversations, onSelectMedia, onSelectContent, onOpenGraph, onSelectBookContent, onSelectSearchResult, controlledTab, onTabChange }: ArchiveTabsProps) {
  const [internalTab, setInternalTab] = useState<ArchiveTabId>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (saved as ArchiveTabId) || 'conversations';
  });

  // Use controlled tab if provided, otherwise use internal state
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = onTabChange ?? setInternalTab;

  // Persist active tab
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, activeTab);
  }, [activeTab]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'aui':
        return <AUIChatTab />;
      case 'conversations':
        return renderConversations();
      case 'gallery':
        return <GalleryView onSelectMedia={onSelectMedia} />;
      case 'import':
        return <ImportView />;
      case 'books':
        return <BooksView onSelectBookContent={onSelectBookContent} />;
      case 'facebook':
        return <FacebookView onSelectMedia={onSelectMedia} onSelectContent={onSelectContent} onOpenGraph={onOpenGraph} />;
      case 'explore':
        return <ExploreView onSelectResult={onSelectSearchResult} />;
      case 'files':
        return <FilesView />;
      case 'queue':
        return <QueueTab />;
      default:
        return renderConversations();
    }
  };

  return (
    <div className="archive-tabs">
      <ArchiveIconTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <div className="archive-tabs__content">
        {renderTabContent()}
      </div>
    </div>
  );
}

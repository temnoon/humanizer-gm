import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import {
  BufferProvider,
  useBuffers,
  type ArchiveSourceType,
} from './lib/buffer';
import {
  fetchConversation,
  getMessages,
  facebookMediaToContainer,
  facebookContentToContainer,
} from './lib/archive';
import { BookshelfProvider } from './lib/bookshelf';
import { AUIProvider, useAUI, type WorkspaceState } from './lib/aui';
import { ThemeProvider } from './lib/theme/ThemeContext';
import { type SelectedFacebookMedia, type SelectedFacebookContent, type ArchiveTabId, type SearchResult } from './components/archive';
import { MainWorkspace, ContainerWorkspace, StructureInspector, HarvestWorkspaceView, type BookContent, type HarvestConversation, type StagedMessage } from './components/workspace';
import type { BookProject } from './components/archive/book-project/types';
import { SocialGraphView } from './components/graph';
import { CornerAssistant, useSplitScreen, SplitScreenWorkspace, useSplitMode, TopBar, type SplitPaneContent } from './components/layout';
import type { ArchiveContainer } from '@humanizer/core';
import { getArchiveServerUrlSync } from './lib/platform';


// ═══════════════════════════════════════════════════════════════════
// STUDIO
// ═══════════════════════════════════════════════════════════════════

interface BookContentMode {
  content: BookContent;
  project: BookProject;
}

// Inner component that has access to BufferContext
function StudioContent() {
  const { importText, activeContent, activeBuffer } = useBuffers();

  // Unified container selection (new)
  const [selectedContainer, setSelectedContainer] = useState<ArchiveContainer | null>(null);
  const [_bookProject, setBookProject] = useState<BookProject | null>(null);

  // Legacy states (kept for backward compatibility during transition)
  const [selectedMedia, setSelectedMedia] = useState<SelectedFacebookMedia | null>(null);
  const [selectedFacebookContent, setSelectedFacebookContent] = useState<SelectedFacebookContent | null>(null);
  const [showSocialGraph, setShowSocialGraph] = useState(false);
  const [bookContentMode, setBookContentMode] = useState<BookContentMode | null>(null);

  // Harvest workspace review state
  const [harvestReview, setHarvestReview] = useState<{
    conversation: HarvestConversation;
    stagedMessages: StagedMessage[];
  } | null>(null);

  // Split-screen state
  const splitScreen = useSplitScreen();
  const { setMode: setSplitMode } = useSplitMode();
  const [splitPaneContent, setSplitPaneContent] = useState<{
    id: string;
    title: string;
    subtitle?: string;
    text: string;
    type: 'archive' | 'conversation' | 'transform';
    transformedText?: string;
  } | null>(null);
  const [mobileSplitPane, setMobileSplitPane] = useState<'left' | 'right'>('left');

  // Archive tab state (lifted up so both TopBar and Workspace can access)
  const [archiveTab, setArchiveTab] = useState<ArchiveTabId | undefined>(undefined);

  // Structure inspector state (peek behind the curtain)
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // Handle transformation completion - load into regular workspace
  // User can use "Read | Edit" toggle to compare/modify
  const handleTransformComplete = useCallback((original: string, transformed: string, transformType: string) => {
    // Load transformed content into the buffer
    // The user can then use the workspace's "Read | Edit" toggle
    importText(transformed, `${transformType} transformation`, {
      type: 'transform',
      original: original,
      transformType: transformType,
    });

    // Clear any split pane content - use regular workspace edit mode
    setSplitPaneContent(null);

    // Disable split screen if active
    if (splitScreen.isActive) {
      splitScreen.toggle();
    }
  }, [importText, splitScreen]);

  // Compute workspace state for AUI context
  const workspaceState = useMemo((): WorkspaceState => {
    // Determine view mode
    let viewMode: WorkspaceState['viewMode'] = 'text';
    if (bookContentMode) viewMode = 'book';
    else if (showSocialGraph) viewMode = 'graph';
    else if (selectedMedia) viewMode = 'media';
    else if (selectedFacebookContent) viewMode = 'content';

    // Extract buffer content
    let bufferContent: string | null = null;
    if (activeContent) {
      if (Array.isArray(activeContent)) {
        bufferContent = activeContent.map(item => item.text).join('\n\n');
      } else {
        bufferContent = activeContent.text;
      }
    }

    return {
      bufferContent,
      bufferName: activeBuffer?.name || null,
      selectedMedia,
      selectedContent: selectedFacebookContent,
      viewMode,
      selectedContainer,
    };
  }, [activeContent, activeBuffer, selectedMedia, selectedFacebookContent, bookContentMode, showSocialGraph, selectedContainer]);

  // Sync workspace state with AUI context
  const { setWorkspace } = useAUI();
  useEffect(() => {
    setWorkspace(workspaceState);
  }, [workspaceState, setWorkspace]);

  // Handle Facebook content selection from archive panel
  const handleSelectFacebookContent = useCallback((content: SelectedFacebookContent) => {
    setSelectedFacebookContent(content);
    // Clear other modes when viewing Facebook content
    setSelectedMedia(null);
    setShowSocialGraph(false);
    setBookContentMode(null);

    // Also set unified container
    const container = facebookContentToContainer(content);
    setSelectedContainer(container);
    setBookProject(null);

    // Also load into buffer so tools panel can work with it
    importText(content.text, content.title || `Facebook ${content.type}`, {
      type: 'facebook',
      path: ['facebook', content.type, content.id],
    });
  }, [importText]);

  // Handle book content selection from archive panel
  // Loads content into the regular Workspace for clean "Read | Edit" mode
  const handleSelectBookContent = useCallback((content: BookContent, project: BookProject) => {
    // Clear other modes when selecting book content
    setSelectedMedia(null);
    setSelectedFacebookContent(null);
    setShowSocialGraph(false);
    setBookContentMode(null); // Don't use bookContentMode - use regular workspace

    // Set book project for reference
    setBookProject(project);

    // Load content into buffer - this will display in the regular Workspace
    // with the clean "Read | Edit" toggle the user prefers
    importText(content.content, content.title, {
      type: `book-${content.type}` as ArchiveSourceType,
      bookProjectId: content.source.bookProjectId,
      itemId: content.source.itemId,
      path: [project.name || 'Book', content.type, content.title],
    });

    // Clear split pane content if any
    setSplitPaneContent(null);
  }, [importText]);

  // Handle book content edit - sync with buffer
  const handleBookEdit = useCallback((newContent: string) => {
    if (!bookContentMode) return;
    // Update local state
    setBookContentMode({
      ...bookContentMode,
      content: {
        ...bookContentMode.content,
        content: newContent,
      },
    });
    // Also update buffer
    importText(newContent, bookContentMode.content.title, {
      type: `book-${bookContentMode.content.type}`,
      bookProjectId: bookContentMode.content.source.bookProjectId,
      itemId: bookContentMode.content.source.itemId,
    });
  }, [bookContentMode, importText]);

  // Sync book content when buffer content changes from tools
  useEffect(() => {
    if (!bookContentMode || !activeContent) return;

    // Extract text from ContentItem (activeContent can be ContentItem | ContentItem[] | null)
    const newText = Array.isArray(activeContent)
      ? activeContent.map(item => item.text).join('\n\n')
      : activeContent.text;

    if (newText && newText !== bookContentMode.content.content) {
      setBookContentMode(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          content: {
            ...prev.content,
            content: newText,
          },
        };
      });
    }
  }, [activeContent, bookContentMode]);

  // Handle close book content mode
  const handleCloseBookContent = useCallback(() => {
    setBookContentMode(null);
    setSelectedContainer(null);
    setBookProject(null);
  }, []);

  // Handle semantic search result selection
  const handleSelectSearchResult = useCallback(async (result: SearchResult) => {
    if (!result.conversationFolder) {
      console.warn('Search result missing conversationFolder');
      return;
    }

    try {
      // Fetch the full conversation
      const conv = await fetchConversation(result.conversationFolder);
      const archiveServer = getArchiveServerUrlSync() || '';
      const messages = getMessages(conv, conv.messages.length, archiveServer);

      // Find the specific message if we have a messageId
      const messageId = result.metadata?.messageId;
      const targetMsg = messageId
        ? messages.find(m => m.id === messageId)
        : messages[0];

      if (targetMsg) {
        const messageIndex = messages.findIndex(m => m.id === targetMsg.id);

        // Import the message into the buffer
        importText(targetMsg.content, `${conv.title} [${targetMsg.role}]`, {
          type: 'chatgpt',
          conversationId: conv.id,
          conversationFolder: result.conversationFolder,
          messageId: targetMsg.id,
          messageIndex,
          totalMessages: messages.length,
          path: [conv.title, `Message ${messageIndex + 1}`],
        });

        // Clear other view modes
        setSelectedMedia(null);
        setSelectedFacebookContent(null);
        setShowSocialGraph(false);
        setBookContentMode(null);
        setSelectedContainer(null);
        setBookProject(null);
      }
    } catch (err) {
      console.error('Failed to load conversation from search result:', err);
    }
  }, [importText]);

  // Handle clearing container (unified close)
  const handleClearContainer = useCallback(() => {
    setSelectedContainer(null);
    setBookProject(null);
    setSelectedMedia(null);
    setSelectedFacebookContent(null);
    setBookContentMode(null);
  }, []);

  // Handle media selection with container
  const handleSelectMedia = useCallback((media: SelectedFacebookMedia) => {
    setSelectedMedia(media);
    setSelectedFacebookContent(null);
    setShowSocialGraph(false);
    setBookContentMode(null);

    // Also set unified container
    const container = facebookMediaToContainer(media);
    setSelectedContainer(container);
    setBookProject(null);
  }, []);

  // Handle harvest review - load full conversation into workspace
  const handleReviewInWorkspace = useCallback(async (conversationId: string, conversationTitle: string, passage: import('@humanizer/core').SourcePassage) => {
    try {
      const { getArchiveServerUrl } = await import('./lib/platform');
      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/conversations/${encodeURIComponent(conversationId)}`);

      if (response.ok) {
        const data = await response.json();

        // DEBUG: Trace message extraction
        console.log('[Review] Raw API data keys:', Object.keys(data));
        console.log('[Review] Messages count:', data.messages?.length);
        console.log('[Review] First message:', JSON.stringify(data.messages?.[0], null, 2)?.slice(0, 500));
        console.log('[Review] First message content type:', typeof data.messages?.[0]?.content);
        console.log('[Review] First message content sample:',
          Array.isArray(data.messages?.[0]?.content)
            ? JSON.stringify(data.messages[0].content[0], null, 2)
            : data.messages?.[0]?.content?.slice?.(0, 200)
        );

        // Validate API response (per FALLBACK POLICY: no silent fallbacks)
        if (!data.messages) {
          console.warn('[Studio.openConversationForReview] API response missing messages field');
        }

        // Extract text from content array - API returns [{type: 'text', content: '...'}, ...]
        const extractContent = (content: unknown): string => {
          if (typeof content === 'string') return content;
          if (Array.isArray(content)) {
            return content
              .filter((part: { type?: string }) => part?.type === 'text')
              .map((part: { content?: string }) => part?.content || '')
              .join('\n');
          }
          return '';
        };

        const messages = (data.messages || []).map((m: { id?: string; role: string; content: unknown }, idx: number) => ({
          id: m.id || `msg-${idx}`,
          role: m.role as 'user' | 'assistant' | 'system',
          content: extractContent(m.content),
        }));

        // DEBUG: Log extracted messages
        console.log('[Review] Extracted messages count:', messages.length);
        console.log('[Review] First extracted message:', messages[0]);
        console.log('[Review] Messages with content:', messages.filter((m: { content: string }) => m.content.length > 0).length);

        setHarvestReview({
          conversation: {
            conversationId,
            title: conversationTitle,
            messages,
            passage,
          },
          stagedMessages: [],
        });

        // Clear other views
        setShowSocialGraph(false);
        setSelectedContainer(null);
        setSelectedMedia(null);
        setSelectedFacebookContent(null);
      }
    } catch (err) {
      console.error('[StudioContent] Failed to load conversation for review:', err);
    }
  }, []);

  // Get the current workspace content as a ReactNode
  const renderWorkspaceContent = () => {
    // Harvest review takes priority - full conversation review in workspace
    if (harvestReview) {
      return (
        <HarvestWorkspaceView
          conversation={harvestReview.conversation}
          stagedMessages={harvestReview.stagedMessages}
          onStageMessage={(msg) => {
            setHarvestReview(prev => {
              if (!prev) return null;
              // Replace if already staged, otherwise add
              const existing = prev.stagedMessages.findIndex(s => s.messageId === msg.messageId);
              const newStaged = existing >= 0
                ? [...prev.stagedMessages.slice(0, existing), msg, ...prev.stagedMessages.slice(existing + 1)]
                : [...prev.stagedMessages, msg];
              return { ...prev, stagedMessages: newStaged };
            });
          }}
          onUnstageMessage={(messageId) => {
            setHarvestReview(prev => {
              if (!prev) return null;
              return {
                ...prev,
                stagedMessages: prev.stagedMessages.filter(s => s.messageId !== messageId),
              };
            });
          }}
          onCommitStaged={() => {
            // TODO: Commit staged messages to book chapter
            if (harvestReview?.stagedMessages.length) {
              const combined = harvestReview.stagedMessages
                .map(s => s.content)
                .join('\n\n---\n\n');
              importText(combined, `From: ${harvestReview.conversation.title}`, {
                type: 'chatgpt',
                conversationId: harvestReview.conversation.conversationId,
              });
              setHarvestReview(null);
            }
          }}
          onClose={() => setHarvestReview(null)}
        />
      );
    }

    // Book content now loads directly into the regular Workspace via importText
    // so it gets the clean "Read | Edit" toggle that the user prefers
    if (showSocialGraph) {
      return (
        <div className="workspace workspace--graph">
          <SocialGraphView onClose={() => setShowSocialGraph(false)} />
        </div>
      );
    }
    if (selectedContainer && selectedContainer.type === 'media') {
      return (
        <ContainerWorkspace
          container={selectedContainer}
          onClose={handleClearContainer}
        />
      );
    }
    if (selectedContainer && (selectedContainer.type === 'post' || selectedContainer.type === 'comment')) {
      return (
        <ContainerWorkspace
          container={selectedContainer}
          onClose={handleClearContainer}
        />
      );
    }
    return (
      <MainWorkspace
        selectedMedia={selectedMedia}
        selectedContent={selectedFacebookContent}
        onClearMedia={() => { setSelectedMedia(null); setSelectedContainer(null); }}
        onClearContent={() => { setSelectedFacebookContent(null); setSelectedContainer(null); }}
        onUpdateMedia={handleSelectMedia}
        onGoToBook={() => setArchiveTab('books')}
      />
    );
  };

  // Create split pane content objects (for conversation transforms, etc.)
  const leftPaneContent: SplitPaneContent | null = splitPaneContent ? {
    id: splitPaneContent.id,
    title: splitPaneContent.title,
    subtitle: splitPaneContent.subtitle,
    readOnly: true,
    children: (
      <article className="split-pane__content">
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[[rehypeKatex, { strict: false }]]}
        >
          {splitPaneContent.text}
        </ReactMarkdown>
      </article>
    ),
  } : null;

  const rightPaneContent: SplitPaneContent = {
    id: 'workspace',
    title: activeBuffer?.name || 'Workspace',
    subtitle: selectedContainer?.type,
    readOnly: false,
    children: renderWorkspaceContent(),
  };

  return (
    <div className="studio">
      <TopBar
        onSelectMedia={handleSelectMedia}
        onSelectContent={handleSelectFacebookContent}
        onOpenGraph={() => setShowSocialGraph(true)}
        onSelectBookContent={handleSelectBookContent}
        onTransformComplete={handleTransformComplete}
        onSelectSearchResult={handleSelectSearchResult}
        archiveTab={archiveTab}
        onArchiveTabChange={setArchiveTab}
        onReviewInWorkspace={handleReviewInWorkspace}
      />
      <main className="studio__main">
        {/* Split-screen mode */}
        {splitScreen.isActive && leftPaneContent ? (
          <SplitScreenWorkspace
            leftPane={leftPaneContent}
            rightPane={rightPaneContent}
            activeMobilePane={mobileSplitPane}
            onMobilePaneChange={setMobileSplitPane}
          />
        ) : (
          /* Normal single-pane mode */
          renderWorkspaceContent()
        )}
      </main>
      {/* AUI Chat disabled - will be integrated into Tools panel with proper styling */}
      {/* <AUIChat workspace={workspaceState} /> */}

      {/* Structure Inspector - peek behind the curtain at data structure */}
      <StructureInspector
        container={selectedContainer}
        isOpen={inspectorOpen}
        onToggle={() => setInspectorOpen(!inspectorOpen)}
      />

      {/* Subtle corner assistant - replaces intrusive bottom menubar */}
      <CornerAssistant />
    </div>
  );
}

export function Studio() {
  return (
    <ThemeProvider>
      <BufferProvider>
        <BookshelfProvider>
          {/* BookProvider removed - consolidated into BookshelfProvider (Phase 4.2) */}
          <AUIProvider>
            <StudioContent />
          </AUIProvider>
        </BookshelfProvider>
      </BufferProvider>
    </ThemeProvider>
  );
}

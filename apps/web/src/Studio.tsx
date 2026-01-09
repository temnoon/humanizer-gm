import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  fetchConversations,
  fetchConversation,
  getMessages,
  groupConversationsByMonth,
  checkArchiveHealth,
  getCurrentArchive,
  type ArchiveConversation,
  type FlatMessage,
} from './lib/archive';
import {
  humanize,
  transformPersona,
  transformStyle,
  analyzeSentences,
  getPersonas,
  getStyles,
  type HumanizationIntensity,
  type TransformResult,
  type PersonaDefinition,
  type StyleDefinition,
  type SentenceAnalysisResult,
} from './lib/transform';
import { useAuth } from './lib/auth';
import { LoginPage } from './components/auth/LoginPage';
// BookProvider removed - consolidated into BookshelfProvider (Phase 4.2)
import { BookshelfProvider, useBookshelf, type DraftChapter, type SourcePassage } from './lib/bookshelf';
import { executeAllTools, executeTool, buildAUIContext, AUI_BOOK_SYSTEM_PROMPT, AUIProvider, useAUI, subscribeToGUIActions, type AUIContext, type WorkspaceState } from './lib/aui';
import { ThemeProvider, useTheme } from './lib/theme/ThemeContext';
import { ThemeSettingsModal } from './components/theme/ThemeSettingsModal';
import { ArchiveTabs, ArchivePanel, type SelectedFacebookMedia, type SelectedFacebookContent, type ArchiveTabId, type SearchResult } from './components/archive';
import { MainWorkspace, BookContentView, ContainerWorkspace, WelcomeScreen, StructureInspector, HarvestWorkspaceView, type BookContent, type HarvestConversation, type StagedMessage } from './components/workspace';
import type { BookProject } from './components/archive/book-project/types';
import { ToolsPanel, ProfileCardsContainer, HarvestQueuePanel } from './components/tools';
import { SocialGraphView } from './components/graph';
import { useLayout, CornerAssistant, PanelResizer, usePanelState, useLayoutMode, useSplitScreen, SplitScreenWorkspace, useHighlights, useSplitMode, HoverPanel, UserDropdown, TopBar, type SplitPaneContent } from './components/layout';
import { AddToBookDialog, type AddAction } from './components/dialogs/AddToBookDialog';
import type { SentenceAnalysis } from './lib/analysis';
import type { ArchiveContainer } from '@humanizer/core';
import {
  facebookMediaToContainer,
  facebookContentToContainer,
} from './lib/archive';
import { getArchiveServerUrlSync, initPlatformConfig, isElectron } from './lib/platform';
import { TOOL_REGISTRY, loadToolVisibility, saveToolVisibility, type ToolDefinition } from './lib/tools';

// ═══════════════════════════════════════════════════════════════════
// AUI CHAT - AI Assistant Interface
// ═══════════════════════════════════════════════════════════════════

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const AUI_SYSTEM_PROMPT = `You are AUI, the AI assistant for humanizer.com Studio.

Your role is to help users understand and use the Studio interface effectively.

Key features of the Studio:
- **Archive Panel** (left): Browse 1,800+ ChatGPT conversations, search by title, filter by media
- **Workspace** (center): View and edit imported content, with LaTeX rendering
- **Tools Panel** (right): Transform content with Humanize, Persona, Style, and analysis tools
- **Navigation**: When viewing a conversation message, use ⇤←→⇥ to navigate between messages
- **Books Tab**: Create and manage book projects with chapters and version control

Quick tips:
- Hover left edge or click "Archive" to browse conversations
- Hover right edge or click "Tools" to access transformation tools
- Use the search bar to find conversations by title
- "Hide empty" filter removes conversations with no messages
- Settings tab lets you show/hide tools you don't use

Be concise and helpful. Use markdown formatting.

${AUI_BOOK_SYSTEM_PROMPT}`;

interface AUIChatProps {
  workspace?: WorkspaceState;
}

function AUIChat({ workspace }: AUIChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hi! I\'m AUI, your Studio assistant. I can help you navigate the interface and manage your book projects. How can I help?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Bookshelf context for tool execution (BookContext deprecated)
  const bookshelf = useBookshelf();

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!chatRef.current) return;
    e.preventDefault();

    const rect = chatRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setIsDragging(true);
  }, []);

  // Handle drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      // Keep within viewport bounds
      const maxX = window.innerWidth - 360; // 360 = chat width
      const maxY = window.innerHeight - (isMinimized ? 48 : 500); // height depends on state

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, dragOffset, isMinimized]);

  // Reset position when closed
  useEffect(() => {
    if (!isOpen) {
      setPosition({ x: 0, y: 0 });
      setIsMinimized(false);
    }
  }, [isOpen]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      // Try local Ollama first, then fall back to cloud API
      const apiUrl = import.meta.env.VITE_CHAT_API_URL || 'http://localhost:11434/api/chat';
      const isOllama = apiUrl.includes('11434');

      // Create AUI context for tool execution (using bookshelf simple methods)
      const auiContext: AUIContext = {
        activeProject: bookshelf.activeBook,
        updateChapter: (chapterId, content, changes) => {
          void bookshelf.updateChapterSimple(chapterId, content, changes);
        },
        createChapter: (title, content) => {
          void bookshelf.createChapterSimple(title, content);
          // Return placeholder for sync interface - actual chapter created async
          return {
            id: `ch-${Date.now()}`,
            number: 1,
            title,
            content: content || `# ${title}\n\n`,
            wordCount: 0,
            version: 1,
            versions: [],
            status: 'outline' as const,
            sections: [],
            marginalia: [],
            metadata: { lastEditedBy: 'aui' as const, lastEditedAt: Date.now(), notes: [], auiSuggestions: [] },
            passageRefs: [],
          };
        },
        deleteChapter: (chapterId) => {
          void bookshelf.deleteChapterSimple(chapterId);
        },
        renderBook: () => bookshelf.renderActiveBook(),
        getChapter: (chapterId) => bookshelf.getChapterSimple(chapterId) || null,
        // Passage operations
        addPassage: (passage) => {
          void bookshelf.addPassageSimple(passage);
          return { id: `p-${Date.now()}`, text: passage.content, wordCount: passage.content.split(/\s+/).length } as SourcePassage;
        },
        updatePassage: (passageId, updates) => {
          void bookshelf.updatePassageSimple(passageId, updates);
        },
        getPassages: () => bookshelf.getPassagesSimple(),
        // Workspace state for context-aware tools
        workspace,
      };

      let assistantContent: string;

      if (isOllama) {
        // Ollama API format
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama3.2',
            messages: [
              { role: 'system', content: AUI_SYSTEM_PROMPT },
              ...messages.map(m => ({ role: m.role, content: m.content })),
              { role: 'user', content: userMessage }
            ],
            stream: false,
          }),
        });

        if (!response.ok) throw new Error('Ollama not available');
        const data = await response.json();
        assistantContent = data.message?.content || 'Sorry, I couldn\'t process that.';
      } else {
        // Cloud API format
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: AUI_SYSTEM_PROMPT },
              ...messages.map(m => ({ role: m.role, content: m.content })),
              { role: 'user', content: userMessage }
            ],
          }),
        });

        if (!response.ok) throw new Error('Chat API not available');
        const data = await response.json();
        assistantContent = data.response || 'Sorry, I couldn\'t process that.';
      }

      // Display the response
      setMessages(prev => [...prev, { role: 'assistant', content: assistantContent }]);

      // Execute any tools found in the response
      const { results, hasTools } = await executeAllTools(assistantContent, auiContext);

      if (hasTools && results.length > 0) {
        // Add tool execution results with teaching info to the chat
        const toolResults = results.map(r => {
          if (r.success) {
            let result = `✓ ${r.message || 'Action completed'}`;

            // Add teaching information if available (Teach By Doing pattern)
            if (r.teaching) {
              result += `\n\n📖 **What happened:** ${r.teaching.whatHappened}`;

              if (r.teaching.guiPath && r.teaching.guiPath.length > 0) {
                result += `\n\n**To do this yourself:**\n${r.teaching.guiPath.map((step, i) => `${i + 1}. ${step}`).join('\n')}`;
              }

              if (r.teaching.shortcut) {
                result += `\n\n⌨️ **Shortcut:** ${r.teaching.shortcut}`;
              }

              if (r.teaching.why) {
                result += `\n\n💡 **Why:** ${r.teaching.why}`;
              }
            }

            return result;
          } else {
            return `✗ ${r.error || 'Action failed'}`;
          }
        }).join('\n\n---\n\n');

        setMessages(prev => [...prev, { role: 'assistant', content: `**Tool Results:**\n\n${toolResults}` }]);
      }
    } catch (err) {
      // Fallback to static responses
      const fallbackResponses: Record<string, string> = {
        'archive': 'The **Archive panel** is on the left side. Hover over the left edge or click "Archive" in the top bar to open it. You can search conversations by title and filter by media type.',
        'tools': 'The **Tools panel** is on the right side. Hover over the right edge or click "Tools ⚙" to open it. You\'ll find transformation tools like Humanize, Persona, and Style.',
        'navigate': 'When viewing a message from a conversation, use the navigation bar: **⇤** (first), **←** (previous), **→** (next), **⇥** (last) to move through messages.',
        'search': 'Use the **search bar** at the top of the Archive panel to filter conversations by title. The search works across all 1,800+ conversations.',
        'filter': 'Use the **filter dropdowns** to sort by message count, length, or date. The "Hide empty" checkbox filters out conversations with no messages.',
      };

      const lowerInput = userMessage.toLowerCase();
      let response = 'I\'m having trouble connecting to my backend. Here\'s what I can tell you:\n\n';

      if (lowerInput.includes('archive') || lowerInput.includes('conversation')) {
        response += fallbackResponses['archive'];
      } else if (lowerInput.includes('tool')) {
        response += fallbackResponses['tools'];
      } else if (lowerInput.includes('navigate') || lowerInput.includes('arrow') || lowerInput.includes('message')) {
        response += fallbackResponses['navigate'];
      } else if (lowerInput.includes('search') || lowerInput.includes('find')) {
        response += fallbackResponses['search'];
      } else if (lowerInput.includes('filter') || lowerInput.includes('sort')) {
        response += fallbackResponses['filter'];
      } else {
        response = 'I can help you with:\n- **Archive**: Browse and search conversations\n- **Tools**: Transform content\n- **Navigation**: Move between messages\n- **Filters**: Sort and filter the archive\n\nWhat would you like to know more about?';
      }

      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Compute style for positioning
  const chatStyle: React.CSSProperties = position.x !== 0 || position.y !== 0
    ? {
        position: 'fixed',
        left: position.x,
        top: position.y,
        right: 'auto',
        bottom: 'auto',
      }
    : {};

  return (
    <>
      {/* Chat Panel */}
      {isOpen && (
        <div
          ref={chatRef}
          className={`aui-chat ${isMinimized ? 'aui-chat--minimized' : ''} ${isDragging ? 'aui-chat--dragging' : ''}`}
          style={chatStyle}
        >
          <div
            className="aui-chat__header"
            onMouseDown={handleDragStart}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          >
            <span className="aui-chat__title">AUI Assistant</span>
            <div className="aui-chat__header-actions">
              <button
                className="aui-chat__minimize"
                onClick={() => setIsMinimized(!isMinimized)}
                title={isMinimized ? 'Expand' : 'Minimize'}
              >
                {isMinimized ? '□' : '−'}
              </button>
              <button className="aui-chat__close" onClick={() => setIsOpen(false)}>×</button>
            </div>
          </div>
          {!isMinimized && (
            <>
              <div className="aui-chat__messages">
                {messages.map((msg, i) => (
                  <div key={i} className={`aui-chat__message aui-chat__message--${msg.role}`}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ))}
                {loading && (
                  <div className="aui-chat__message aui-chat__message--assistant aui-chat__message--loading">
                    <span>···</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="aui-chat__input-area">
                <input
                  type="text"
                  className="aui-chat__input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about the Studio..."
                  disabled={loading}
                />
                <button
                  className="aui-chat__send"
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                >
                  →
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Floating Chat Button */}
      <button
        className={`aui-fab ${isOpen ? 'aui-fab--open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="AUI Assistant"
      >
        {isOpen ? '×' : '?'}
      </button>
    </>
  );
}

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

/**
 * AUI Context - Central hub for the Agentic UI system
 *
 * Combines:
 * - Chat interface (messages, LLM communication)
 * - Tool execution with teaching
 * - Animation orchestration ("show don't tell")
 * - Settings persistence
 * - Chat archiving (conversations become searchable content)
 *
 * Philosophy:
 * Every AUI interaction is archived and becomes part of the user's corpus.
 * The AUI teaches by doing - animations show how to replicate actions manually.
 */

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';

import { auiAnimator, teachingToAnimation, type AnimatorState } from './animator';
import { loadAUISettings, saveAUISettings, type AUISettings } from './settings';
import { executeAllTools, cleanToolsFromResponse, type AUIContext as AUIToolContext, type AUIToolResult } from './tools';
import { useLayout } from '../../components/layout/LayoutContext';
import { useBookOptional } from '../book';
import { useBookshelf } from '../bookshelf';
import { getArchiveServerUrl } from '../platform';
import {
  getAgentBridge,
  type AgentProposal,
  type AgentInfo,
  type BridgeEvent,
} from './agent-bridge';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  /** Tool results if this is a tool message */
  toolResults?: AUIToolResult[];
  /** Whether this message has been archived */
  archived?: boolean;
}

export interface AUIConversation {
  id: string;
  messages: ChatMessage[];
  startedAt: Date;
  title?: string;
  tags: string[];
}

export interface AUIState {
  /** Current conversation */
  conversation: AUIConversation;
  /** Whether LLM is processing */
  isLoading: boolean;
  /** Current error if any */
  error: string | null;
  /** Animation state */
  animation: AnimatorState;
  /** Settings */
  settings: AUISettings;
  /** Whether chat panel is open */
  isChatOpen: boolean;
  /** Pending agent proposals */
  pendingProposals: AgentProposal[];
  /** Available agents */
  agents: AgentInfo[];
  /** Whether agent orchestrator is connected */
  agentBridgeConnected: boolean;
}

export interface AUIContextValue {
  state: AUIState;
  /** Send a message to AUI */
  sendMessage: (content: string) => Promise<void>;
  /** Clear current conversation */
  clearConversation: () => void;
  /** Archive current conversation */
  archiveConversation: () => Promise<void>;
  /** Toggle chat visibility */
  toggleChat: () => void;
  /** Open chat */
  openChat: () => void;
  /** Close chat */
  closeChat: () => void;
  /** Update settings */
  updateSettings: <K extends keyof AUISettings>(
    category: K,
    updates: Partial<AUISettings[K]>
  ) => void;
  /** Stop current animation */
  stopAnimation: () => void;
  /** Approve an agent proposal */
  approveProposal: (proposalId: string) => Promise<AUIToolResult | null>;
  /** Reject an agent proposal */
  rejectProposal: (proposalId: string, reason?: string) => void;
  /** Request work from an agent */
  requestAgentWork: (
    agentId: string,
    taskType: string,
    payload: unknown,
    projectId?: string
  ) => Promise<{ taskId: string } | { error: string }>;
  /** Update workspace state (called by StudioContent) */
  setWorkspace: (workspace: AUIToolContext['workspace']) => void;
}

// ═══════════════════════════════════════════════════════════════════
// ELECTRON CHAT API TYPE
// ═══════════════════════════════════════════════════════════════════

interface ElectronChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
}

interface ElectronChatAPI {
  chat: {
    sendMessage: (content: string, options?: { context?: string }) => Promise<ElectronChatMessage[]>;
    getMessages: (conversationId?: string) => Promise<ElectronChatMessage[]>;
    startConversation: () => Promise<{ id: string }>;
  };
}

// ═══════════════════════════════════════════════════════════════════
// WORKSPACE CONTEXT BUILDER
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a context string from current workspace state
 * This is passed to the LLM so it knows what the user is looking at
 */
function buildWorkspaceContext(
  workspace: AUIToolContext['workspace'] | undefined,
  book: { activeProject: { id: string } | null } | null
): string {
  const parts: string[] = [];

  // Currently selected container (unified content model)
  if (workspace?.selectedContainer) {
    const container = workspace.selectedContainer;
    const title = container.meta?.title || container.id;
    const contentPreview = container.content?.raw?.slice(0, 300) || '';

    parts.push(`Selected ${container.type}: "${title}"`);

    // Add source info
    if (container.source?.type) {
      parts.push(`  Source: ${container.source.type}${container.source.originalId ? ` (${container.source.originalId})` : ''}`);
    }

    // Add content preview
    if (contentPreview) {
      parts.push(`  Preview: "${contentPreview}${container.content?.raw && container.content.raw.length > 300 ? '...' : ''}"`);
    }

    // Add metadata
    if (container.meta?.tags?.length) {
      parts.push(`  Tags: ${container.meta.tags.join(', ')}`);
    }
  }

  // Active buffer content (if different from container)
  if (workspace?.bufferContent && !workspace?.selectedContainer) {
    const preview = workspace.bufferContent.slice(0, 500);
    parts.push(`Buffer "${workspace.bufferName || 'untitled'}" (${workspace.bufferContent.length} chars): "${preview}${workspace.bufferContent.length > 500 ? '...' : ''}"`);
  }

  // Current view mode
  if (workspace?.viewMode) {
    parts.push(`View mode: ${workspace.viewMode}`);
  }

  // Legacy: Selected Facebook content (fallback if no container)
  if (workspace?.selectedContent && !workspace?.selectedContainer) {
    parts.push(`Viewing: ${workspace.selectedContent.type} from ${workspace.selectedContent.source || 'unknown'}`);
  }

  // Active book info
  if (book?.activeProject) {
    const project = book.activeProject;
    parts.push(`Active book: ${project.id}`);
  }

  return parts.length > 0 ? parts.join('\n') : '';
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const AUI_SYSTEM_PROMPT = `You are AUI (Agentic User Interface), an assistant integrated into the Humanizer Studio.

IMPORTANT: When the user requests an action, you MUST use USE_TOOL to execute it. Do NOT describe what you would do - actually do it.

AVAILABLE TOOLS:

ARCHIVE & SEARCH:
- search_archive({"query": "text", "limit": 10}) - Search all conversations
- search_facebook({"query": "text", "type": "posts|comments|messages"}) - Search Facebook content
- list_conversations({"limit": 20}) - List recent conversations
- harvest_archive({"queries": ["query1", "query2"], "threadName": "name"}) - Collect passages by query

BOOK & CHAPTERS:
- create_chapter({"title": "Chapter Title"}) - Create a new chapter
- update_chapter({"chapterId": "id", "content": "markdown"}) - Update chapter content
- list_chapters({}) - List all chapters in active book
- get_chapter({"chapterId": "id"}) - Get chapter content
- add_passage({"content": "text", "conversationTitle": "source"}) - Add passage to book
- generate_first_draft({"chapterId": "id", "arc": "description"}) - Generate chapter draft

TEXT TOOLS:
- detect_ai({"text": "content"}) - Check if text is AI-generated
- humanize({"text": "content"}) - Transform to sound more human
- analyze_text({"text": "content"}) - Sentence-level analysis
- apply_persona({"text": "content", "personaId": "id"}) - Apply writing persona
- apply_style({"text": "content", "styleId": "id"}) - Apply writing style

PERSONAS & STYLES:
- list_personas({}) - List available personas
- list_styles({}) - List available styles
- extract_persona({"text": "sample"}) - Extract persona from text
- extract_style({"text": "sample"}) - Extract style from text

WORKSPACE:
- get_workspace({}) - Get current buffer content and state

EXAMPLES:
User: "Search for conversations about phenomenology"
You: USE_TOOL(search_archive, {"query": "phenomenology", "limit": 10})

User: "Analyze this text for AI"
You: USE_TOOL(detect_ai, {"text": "[current buffer content]"})

User: "Create a chapter called Introduction"
You: USE_TOOL(create_chapter, {"title": "Introduction"})

Be concise. Execute tools directly. Don't explain what you're going to do - just do it.`;

// ═══════════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════════

const AUIContext = createContext<AUIContextValue | null>(null);

export function useAUI(): AUIContextValue {
  const context = useContext(AUIContext);
  if (!context) {
    throw new Error('useAUI must be used within an AUIProvider');
  }
  return context;
}

// ═══════════════════════════════════════════════════════════════════
// PROVIDER
// ═══════════════════════════════════════════════════════════════════

interface AUIProviderProps {
  children: ReactNode;
  /** Workspace state for tool context */
  workspace?: AUIToolContext['workspace'];
}

export function AUIProvider({ children, workspace: initialWorkspace }: AUIProviderProps) {
  // Dependencies
  const layout = useLayout();
  const bookContext = useBookOptional();
  const bookshelf = useBookshelf();

  // Build book interface from bookshelf's simple methods (preferred) or fallback to bookContext
  // IMPORTANT: Memoize to prevent infinite re-renders in useEffect dependencies
  const book = useMemo(() => ({
    activeProject: bookshelf.activeBook || bookContext?.activeProject || null,
    createProject: bookContext?.createProject ?? (async (name: string, subtitle?: string) => {
      // Use bookshelf.createBook when BookContext not available
      console.log('[AUI] Creating book via bookshelf.createBook:', name, subtitle);
      const book = await bookshelf.createBook({
        id: `book-${Date.now()}`,
        name,
        subtitle,
        status: 'harvesting',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        personaRefs: [],
        styleRefs: [],
        threads: [],
        sourceRefs: [],
        passages: [],
        chapters: [],
        stats: { totalSources: 0, totalPassages: 0, approvedPassages: 0, gems: 0, chapters: 0, wordCount: 0 },
      });
      // Set as active book
      if (book?.uri) {
        bookshelf.setActiveBookUri(book.uri);
      }
      return book;
    }) as unknown as (name: string, subtitle?: string) => import('../bookshelf/types').BookProject,
    updateChapter: (chapterId: string, content: string, changes?: string) => {
      if (bookshelf.updateChapterSimple) {
        void bookshelf.updateChapterSimple(chapterId, content, changes);
      } else if (bookContext?.updateChapter) {
        bookContext.updateChapter(chapterId, content, changes);
      }
    },
    createChapter: (title: string, content?: string) => {
      if (bookshelf.createChapterSimple) {
        void bookshelf.createChapterSimple(title, content);
        // Return placeholder for sync interface
        return { id: `ch-${Date.now()}`, number: 1, title, content: content || '', wordCount: 0, version: 1, versions: [], status: 'outline' as const };
      }
      return bookContext?.createChapter?.(title, content) ?? null;
    },
    deleteChapter: (chapterId: string) => {
      if (bookshelf.deleteChapterSimple) {
        void bookshelf.deleteChapterSimple(chapterId);
      } else if (bookContext?.deleteChapter) {
        bookContext.deleteChapter(chapterId);
      }
    },
    renderBook: () => bookshelf.renderActiveBook?.() ?? bookContext?.renderBook?.() ?? '',
    getChapter: (chapterId: string) => bookshelf.getChapterSimple?.(chapterId) ?? bookContext?.getChapter?.(chapterId) ?? null,
    addPassage: (passage: {
      content: string;
      conversationId?: string;
      conversationTitle: string;
      role?: 'user' | 'assistant';
      tags?: string[];
    }) => {
      if (bookshelf.addPassageSimple) {
        void bookshelf.addPassageSimple(passage);
        // Return placeholder
        return { id: `p-${Date.now()}`, text: passage.content, wordCount: passage.content.split(/\s+/).length } as ReturnType<typeof bookContext.addPassage>;
      }
      return bookContext?.addPassage?.(passage) ?? null;
    },
    updatePassage: (passageId: string, updates: Partial<import('../bookshelf/types').SourcePassage>) => {
      if (bookshelf.updatePassageSimple) {
        void bookshelf.updatePassageSimple(passageId, updates);
      } else if (bookContext?.updatePassage) {
        bookContext.updatePassage(passageId, updates);
      }
    },
    getPassages: () => bookshelf.getPassagesSimple?.() ?? bookContext?.getPassages?.() ?? [],
  }), [
    bookshelf.activeBook,
    bookshelf.createBook,
    bookshelf.setActiveBookUri,
    bookshelf.updateChapterSimple,
    bookshelf.createChapterSimple,
    bookshelf.deleteChapterSimple,
    bookshelf.renderActiveBook,
    bookshelf.getChapterSimple,
    bookshelf.addPassageSimple,
    bookshelf.updatePassageSimple,
    bookshelf.getPassagesSimple,
    bookContext,
  ]);

  // State - settings must be loaded first since createNewConversation uses it
  const [settings, setSettings] = useState<AUISettings>(loadAUISettings);
  const [conversation, setConversation] = useState<AUIConversation>(() =>
    createNewConversation(settings)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animationState, setAnimationState] = useState<AnimatorState>(
    auiAnimator.getState()
  );
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [pendingProposals, setPendingProposals] = useState<AgentProposal[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentBridgeConnected, setAgentBridgeConnected] = useState(false);

  // Workspace state - can be set from StudioContent
  const [workspaceState, setWorkspaceState] = useState<AUIToolContext['workspace']>(initialWorkspace);

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const bridgeRef = useRef(getAgentBridge());

  // Initialize animator with layout context
  useEffect(() => {
    auiAnimator.setLayoutContext(layout);
    auiAnimator.setStateChangeCallback(setAnimationState);
  }, [layout]);

  // Initialize agent bridge and subscribe to events
  useEffect(() => {
    const bridge = bridgeRef.current;

    // Build tool context for the bridge
    const toolContext: AUIToolContext = {
      activeProject: book.activeProject,
      createProject: book.createProject,
      updateChapter: book.updateChapter,
      createChapter: book.createChapter,
      deleteChapter: book.deleteChapter,
      renderBook: book.renderBook,
      getChapter: book.getChapter,
      addPassage: book.addPassage,
      updatePassage: book.updatePassage,
      getPassages: book.getPassages,
      workspace: workspaceState,
    };

    // Initialize bridge with context
    bridge.initialize(toolContext);
    bridge.updateConfig(settings);

    // Update state from bridge
    setPendingProposals(bridge.getPendingProposals());
    setAgents(bridge.getAgents());
    setAgentBridgeConnected(bridge.isConnected());

    // Subscribe to bridge events
    const unsubscribe = bridge.onEvent((event: BridgeEvent) => {
      switch (event.type) {
        case 'proposal:received': {
          setPendingProposals(bridge.getPendingProposals());
          // Add proposal to chat if showProposals is enabled
          if (settings.automation.showProposals) {
            const formatted = bridge.formatProposalForChat(event.proposal);
            const proposalMessage: ChatMessage = {
              id: `proposal-${event.proposal.id}`,
              role: 'system',
              content: formatted,
              timestamp: new Date(),
            };
            setConversation((prev) => ({
              ...prev,
              messages: [...prev.messages, proposalMessage],
            }));
          }
          break;
        }
        case 'proposal:expired':
          setPendingProposals(bridge.getPendingProposals());
          break;
        case 'tool:completed': {
          // Add tool result to chat
          const resultMessage: ChatMessage = {
            id: `agent-tool-${event.requestId}`,
            role: 'tool',
            content: event.result.success
              ? `✓ ${event.result.message || 'Completed'}`
              : `✗ ${event.result.error || 'Failed'}`,
            timestamp: new Date(),
            toolResults: [event.result],
          };
          setConversation((prev) => ({
            ...prev,
            messages: [...prev.messages, resultMessage],
          }));
          break;
        }
        case 'agent:status':
          setAgents(bridge.getAgents());
          break;
      }
    });

    return () => {
      unsubscribe();
    };
  }, [book, workspaceState, settings]);

  // Create a new conversation
  function createNewConversation(currentSettings: AUISettings): AUIConversation {
    return {
      id: `aui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      messages: [
        {
          id: 'welcome',
          role: 'assistant',
          content:
            "Hi! I'm AUI, your Studio assistant. I can help you navigate, search your archives, and build your book. What would you like to do?",
          timestamp: new Date(),
        },
      ],
      startedAt: new Date(),
      tags: [currentSettings.archive.chatTag],
    };
  }

  // Send a message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      // Add user message
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: content.trim(),
        timestamp: new Date(),
      };

      setConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      setIsLoading(true);
      setError(null);

      abortControllerRef.current = new AbortController();

      try {
        let assistantContent: string;

        // Build workspace context for the LLM
        const workspaceContext = buildWorkspaceContext(workspaceState, book);

        // Use Electron chat service if available (routes through AgentMaster)
        // This provides tiered prompts based on device RAM and automatic output vetting
        const electronAPI = (window as unknown as { electronAPI?: ElectronChatAPI }).electronAPI;
        const isElectron = (window as unknown as { isElectron?: boolean }).isElectron;

        if (isElectron && electronAPI?.chat) {
          // Route through AgentMaster for tiered prompts + vetting
          // sendMessage returns the new messages (including assistant response)
          const newMessages = await electronAPI.chat.sendMessage(content.trim(), {
            context: workspaceContext,
          });

          // Find the assistant's response from the returned messages
          const lastAssistant = newMessages
            .filter((m) => m.role === 'assistant')
            .pop();
          assistantContent = lastAssistant?.content || "I couldn't process that.";
        } else {
          // Fallback: Direct Ollama call (web-only mode)
          const apiUrl =
            import.meta.env.VITE_CHAT_API_URL || 'http://localhost:11434/api/chat';

          const messagesForLLM = conversation.messages
            .filter((m) => m.role !== 'tool')
            .map((m) => ({ role: m.role, content: m.content }));

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'llama3.2',
              messages: [
                { role: 'system', content: AUI_SYSTEM_PROMPT },
                // Include workspace context as a system message
                ...(workspaceContext ? [{ role: 'system', content: `Current workspace:\n${workspaceContext}` }] : []),
                ...messagesForLLM,
                { role: 'user', content: content.trim() },
              ],
              stream: false,
            }),
            signal: abortControllerRef.current.signal,
          });

          if (!response.ok) throw new Error('Ollama not available');
          const data = await response.json();
          assistantContent = data.message?.content || "I couldn't process that.";
        }

        // Execute tools FIRST (before displaying message)
        const toolContext: AUIToolContext = {
          activeProject: book.activeProject,
          createProject: book.createProject,
          updateChapter: book.updateChapter,
          createChapter: book.createChapter,
          deleteChapter: book.deleteChapter,
          renderBook: book.renderBook,
          getChapter: book.getChapter,
          addPassage: book.addPassage,
          updatePassage: book.updatePassage,
          getPassages: book.getPassages,
          workspace: workspaceState,
        };

        const { results, hasTools } = await executeAllTools(
          assistantContent,
          toolContext
        );

        // Clean tool syntax from response BEFORE displaying
        const cleanedContent = cleanToolsFromResponse(assistantContent);

        // Only add assistant message if there's content after cleaning
        // (If the entire message was just a tool call, show tool results instead)
        if (cleanedContent.trim()) {
          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: cleanedContent,
            timestamp: new Date(),
          };

          setConversation((prev) => ({
            ...prev,
            messages: [...prev.messages, assistantMessage],
          }));
        }

        if (hasTools && results.length > 0) {
          // Add tool results message
          const toolMessage: ChatMessage = {
            id: `tools-${Date.now()}`,
            role: 'tool',
            content: results
              .map((r) =>
                r.success ? `✓ ${r.message}` : `✗ ${r.error}`
              )
              .join('\n'),
            timestamp: new Date(),
            toolResults: results,
          };

          setConversation((prev) => ({
            ...prev,
            messages: [...prev.messages, toolMessage],
          }));

          // Run "show don't tell" animations if enabled
          if (settings.animation.enabled) {
            for (const result of results) {
              if (result.teaching) {
                const sequence = teachingToAnimation(
                  'tool',
                  result.teaching
                );
                // Don't await - run in background
                auiAnimator.animate(sequence).catch(() => {});
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message);

          // Add error message to chat
          const errorMessage: ChatMessage = {
            id: `error-${Date.now()}`,
            role: 'system',
            content: `Connection error: ${err.message}. Try asking about the interface - I have built-in knowledge even without the LLM.`,
            timestamp: new Date(),
          };

          setConversation((prev) => ({
            ...prev,
            messages: [...prev.messages, errorMessage],
          }));
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [conversation.messages, isLoading, book, workspaceState, settings.animation.enabled]
  );

  // Clear conversation
  const clearConversation = useCallback(() => {
    // Archive current if enabled
    if (settings.archive.archiveChats && conversation.messages.length > 1) {
      archiveConversationInternal(conversation).catch(() => {});
    }
    setConversation(createNewConversation(settings));
  }, [conversation, settings]);

  // Archive conversation
  const archiveConversation = useCallback(async () => {
    await archiveConversationInternal(conversation);
    setConversation((prev) => ({
      ...prev,
      messages: prev.messages.map((m) => ({ ...m, archived: true })),
    }));
  }, [conversation]);

  // Internal archive function
  async function archiveConversationInternal(conv: AUIConversation) {
    if (conv.messages.length <= 1) return; // Don't archive empty conversations

    try {
      // Format as a conversation for archiving
      const content = conv.messages
        .map((m) => {
          const role = m.role === 'user' ? 'You' : 'AUI';
          return `**${role}**: ${m.content}`;
        })
        .join('\n\n');

      const title =
        conv.title ||
        `AUI Chat: ${conv.messages.find((m) => m.role === 'user')?.content.slice(0, 50) || 'Conversation'}`;

      // Send to archive server
      const archiveServer = await getArchiveServerUrl();
      await fetch(`${archiveServer}/api/aui/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: conv.id,
          title,
          content,
          messages: conv.messages,
          tags: conv.tags,
          startedAt: conv.startedAt.toISOString(),
        }),
      });
    } catch (err) {
      console.warn('[AUI] Failed to archive conversation:', err);
    }
  }

  // Toggle chat
  const toggleChat = useCallback(() => {
    setIsChatOpen((prev) => !prev);
  }, []);

  const openChat = useCallback(() => {
    setIsChatOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    setIsChatOpen(false);
  }, []);

  // Update settings
  const updateSettings = useCallback(
    <K extends keyof AUISettings>(
      category: K,
      updates: Partial<AUISettings[K]>
    ) => {
      setSettings((prev) => {
        const updated = {
          ...prev,
          [category]: { ...(prev[category] as object), ...updates },
          updatedAt: new Date().toISOString(),
        };
        saveAUISettings(updated);
        return updated;
      });
    },
    []
  );

  // Stop animation
  const stopAnimation = useCallback(() => {
    auiAnimator.stop();
  }, []);

  // Approve an agent proposal
  const approveProposal = useCallback(async (proposalId: string) => {
    const bridge = bridgeRef.current;
    const result = await bridge.approveProposal(proposalId);
    setPendingProposals(bridge.getPendingProposals());

    // Add result to chat
    if (result) {
      const resultMessage: ChatMessage = {
        id: `approved-${proposalId}`,
        role: 'tool',
        content: result.success
          ? `✓ Proposal approved: ${result.message || 'Action completed'}`
          : `✗ Proposal execution failed: ${result.error}`,
        timestamp: new Date(),
        toolResults: [result],
      };
      setConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, resultMessage],
      }));
    }

    return result;
  }, []);

  // Reject an agent proposal
  const rejectProposal = useCallback((proposalId: string, reason?: string) => {
    const bridge = bridgeRef.current;
    bridge.rejectProposal(proposalId, reason);
    setPendingProposals(bridge.getPendingProposals());

    // Add rejection to chat
    const rejectMessage: ChatMessage = {
      id: `rejected-${proposalId}`,
      role: 'system',
      content: `Proposal rejected${reason ? `: ${reason}` : ''}`,
      timestamp: new Date(),
    };
    setConversation((prev) => ({
      ...prev,
      messages: [...prev.messages, rejectMessage],
    }));
  }, []);

  // Request work from an agent
  const requestAgentWork = useCallback(
    async (
      agentId: string,
      taskType: string,
      payload: unknown,
      projectId?: string
    ) => {
      const bridge = bridgeRef.current;
      return bridge.requestAgentWork(agentId, taskType, payload, projectId);
    },
    []
  );

  // Context value
  const value: AUIContextValue = {
    state: {
      conversation,
      isLoading,
      error,
      animation: animationState,
      settings,
      isChatOpen,
      pendingProposals,
      agents,
      agentBridgeConnected,
    },
    sendMessage,
    clearConversation,
    archiveConversation,
    toggleChat,
    openChat,
    closeChat,
    updateSettings,
    stopAnimation,
    approveProposal,
    rejectProposal,
    requestAgentWork,
    setWorkspace: setWorkspaceState,
  };

  return <AUIContext.Provider value={value}>{children}</AUIContext.Provider>;
}

// ═══════════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════════

/**
 * Hook for just the chat state
 */
export function useAUIChat() {
  const { state, sendMessage, clearConversation, toggleChat, openChat, closeChat } = useAUI();
  return {
    messages: state.conversation.messages,
    isLoading: state.isLoading,
    error: state.error,
    isOpen: state.isChatOpen,
    sendMessage,
    clearConversation,
    toggleChat,
    openChat,
    closeChat,
  };
}

/**
 * Hook for animation state
 */
export function useAUIAnimation() {
  const { state, stopAnimation } = useAUI();
  return {
    ...state.animation,
    stop: stopAnimation,
  };
}

/**
 * Hook for settings
 */
export function useAUISettingsContext() {
  const { state, updateSettings } = useAUI();
  return {
    settings: state.settings,
    update: updateSettings,
  };
}

/**
 * Hook for agent bridge functionality
 */
export function useAUIAgents() {
  const { state, approveProposal, rejectProposal, requestAgentWork } = useAUI();
  return {
    pendingProposals: state.pendingProposals,
    agents: state.agents,
    isConnected: state.agentBridgeConnected,
    approveProposal,
    rejectProposal,
    requestAgentWork,
  };
}

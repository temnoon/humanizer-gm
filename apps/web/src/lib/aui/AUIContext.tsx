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
  type ReactNode,
} from 'react';

import { auiAnimator, teachingToAnimation, type AnimatorState } from './animator';
import { loadAUISettings, saveAUISettings, type AUISettings } from './settings';
import { executeAllTools, type AUIContext as AUIToolContext, type AUIToolResult } from './tools';
import { useLayout } from '../../components/layout/LayoutContext';
import { useBookOptional } from '../book';
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
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const ARCHIVE_SERVER = 'http://localhost:3002';

const AUI_SYSTEM_PROMPT = `You are AUI (Agentic User Interface), a helpful assistant integrated into the Humanizer Studio.

You help users:
- Navigate the Studio interface (Archive panel, Tools panel)
- Search their archives (ChatGPT conversations, Facebook content)
- Transform content (humanize, apply personas/styles)
- Build their book (chapters, passages, gems)
- Understand their data

When you perform actions, use USE_TOOL(name, {params}) syntax.
Your conversations are archived and become searchable content.

Be concise but helpful. Show users HOW to do things themselves.`;

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

export function AUIProvider({ children, workspace }: AUIProviderProps) {
  // Dependencies
  const layout = useLayout();
  const bookContext = useBookOptional();

  // Provide fallbacks if book context is not available
  const book = bookContext ?? {
    activeProject: null,
    updateChapter: () => {},
    createChapter: () => null,
    deleteChapter: () => {},
    renderBook: () => '',
    getChapter: () => null,
    addPassage: () => null,
    updatePassage: () => {},
    getPassages: () => [],
  };

  // State
  const [conversation, setConversation] = useState<AUIConversation>(() =>
    createNewConversation()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animationState, setAnimationState] = useState<AnimatorState>(
    auiAnimator.getState()
  );
  const [settings, setSettings] = useState<AUISettings>(loadAUISettings);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [pendingProposals, setPendingProposals] = useState<AgentProposal[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentBridgeConnected, setAgentBridgeConnected] = useState(false);

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
      updateChapter: book.updateChapter,
      createChapter: book.createChapter,
      deleteChapter: book.deleteChapter,
      renderBook: book.renderBook,
      getChapter: book.getChapter,
      addPassage: book.addPassage,
      updatePassage: book.updatePassage,
      getPassages: book.getPassages,
      workspace,
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
  }, [book, workspace, settings]);

  // Create a new conversation
  function createNewConversation(): AUIConversation {
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
      tags: [settings.archive.chatTag],
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
        // Call LLM
        const apiUrl =
          import.meta.env.VITE_CHAT_API_URL || 'http://localhost:11434/api/chat';
        const isOllama = apiUrl.includes('11434');

        const messagesForLLM = conversation.messages
          .filter((m) => m.role !== 'tool')
          .map((m) => ({ role: m.role, content: m.content }));

        let assistantContent: string;

        if (isOllama) {
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'llama3.2',
              messages: [
                { role: 'system', content: AUI_SYSTEM_PROMPT },
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
        } else {
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [
                { role: 'system', content: AUI_SYSTEM_PROMPT },
                ...messagesForLLM,
                { role: 'user', content: content.trim() },
              ],
            }),
            signal: abortControllerRef.current.signal,
          });

          if (!response.ok) throw new Error('Chat API not available');
          const data = await response.json();
          assistantContent = data.response || "I couldn't process that.";
        }

        // Add assistant message
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: assistantContent,
          timestamp: new Date(),
        };

        setConversation((prev) => ({
          ...prev,
          messages: [...prev.messages, assistantMessage],
        }));

        // Execute tools
        const toolContext: AUIToolContext = {
          activeProject: book.activeProject,
          updateChapter: book.updateChapter,
          createChapter: book.createChapter,
          deleteChapter: book.deleteChapter,
          renderBook: book.renderBook,
          getChapter: book.getChapter,
          addPassage: book.addPassage,
          updatePassage: book.updatePassage,
          getPassages: book.getPassages,
          workspace,
        };

        const { results, hasTools } = await executeAllTools(
          assistantContent,
          toolContext
        );

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
    [conversation.messages, isLoading, book, workspace, settings.animation.enabled]
  );

  // Clear conversation
  const clearConversation = useCallback(() => {
    // Archive current if enabled
    if (settings.archive.archiveChats && conversation.messages.length > 1) {
      archiveConversationInternal(conversation).catch(() => {});
    }
    setConversation(createNewConversation());
  }, [conversation, settings.archive.archiveChats]);

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
      await fetch(`${ARCHIVE_SERVER}/api/aui/archive`, {
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

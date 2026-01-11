/**
 * Chat Service Types
 *
 * Types for conversation management and chat service
 */

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolResults?: ChatToolResult[];
  metadata?: Record<string, unknown>;
}

export interface ChatToolResult {
  toolName: string;
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
  agentId?: string;
  teaching?: {
    whatHappened: string;
    guiPath?: string[];
    shortcut?: string;
    why?: string;
  };
}

export interface ChatConversation {
  id: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  messageCount: number;
  tags: string[];
  archived: boolean;
  projectId?: string;
  preview?: string;
}

export interface ChatEvent {
  type: string;
  message?: ChatMessage;
  result?: ChatToolResult;
  error?: string;
  timestamp: number;
}

export interface ChatAPI {
  startConversation: (options?: { projectId?: string; tags?: string[] }) => Promise<ChatConversation>;
  getConversation: () => Promise<ChatConversation | null>;
  loadConversation: (id: string) => Promise<ChatConversation | null>;
  listConversations: (options?: { limit?: number; projectId?: string }) => Promise<ChatConversation[]>;
  getMessages: (conversationId?: string) => Promise<ChatMessage[]>;
  sendMessage: (content: string, options?: { projectId?: string; context?: string; executeTools?: boolean }) => Promise<ChatMessage[]>;
  endConversation: () => Promise<{ success: boolean }>;
  archiveConversation: (conversationId: string) => Promise<{ success: boolean }>;
  searchMessages: (query: string) => Promise<ChatMessage[]>;
  getStats: () => Promise<{ totalConversations: number; totalMessages: number; archivedConversations: number; toolExecutions: number }>;
  updateConfig: (updates: { llm?: { provider?: string; model?: string; apiKey?: string }; archiveUrl?: string; autoArchive?: boolean }) => Promise<{ success: boolean }>;
  onMessage: (callback: (event: ChatEvent) => void) => () => void;
  onToolExecuted: (callback: (event: ChatEvent) => void) => () => void;
  onError: (callback: (event: ChatEvent) => void) => () => void;
}

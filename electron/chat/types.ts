/**
 * Chat Service Types
 *
 * Types for the AUI chat service that bridges the UI with:
 * - LLM providers (Ollama, Anthropic, OpenAI)
 * - Agent Council (tool routing, proposals, signoffs)
 * - SQLite persistence (conversations, messages)
 */

// ═══════════════════════════════════════════════════════════════════
// MESSAGE TYPES
// ═══════════════════════════════════════════════════════════════════

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ToolResult {
  toolName: string;
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
  /** If tool was routed to an agent */
  agentId?: string;
  /** Teaching output for animations */
  teaching?: {
    whatHappened: string;
    guiPath?: string[];
    shortcut?: string;
    why?: string;
  };
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  /** Tool results if this is a tool message */
  toolResults?: ToolResult[];
  /** Metadata for indexing/search */
  metadata?: Record<string, unknown>;
}

export interface ChatConversation {
  id: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  messageCount: number;
  tags: string[];
  /** Whether archived to semantic index */
  archived: boolean;
  /** Project context if any */
  projectId?: string;
  /** Last message preview */
  preview?: string;
}

// ═══════════════════════════════════════════════════════════════════
// LLM TYPES
// ═══════════════════════════════════════════════════════════════════

export type LLMProvider = 'ollama' | 'anthropic' | 'openai';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  /** Provider that handled the request */
  provider?: string;
  /** Whether the request was sent to a cloud API (true) or local model (false) */
  isCloud?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Teaching output from AgentMaster */
  teaching?: {
    whatHappened: string;
    promptTierUsed: 'tiny' | 'standard' | 'full';
    modelSelected: string;
    vettingApplied: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// TOOL TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ParsedToolUse {
  name: string;
  params: Record<string, unknown>;
}

export type ToolCategory =
  | 'search'      // Archive search, semantic search
  | 'transform'   // Humanize, persona, style
  | 'book'        // Chapter, passage, gem operations
  | 'agent'       // Council agent tasks
  | 'system';     // Settings, navigation

export interface ToolDefinition {
  name: string;
  category: ToolCategory;
  description: string;
  /** Which agent handles this tool (if any) */
  agentId?: string;
  /** Whether tool requires user approval */
  requiresApproval?: boolean;
  /** Parameter schema */
  params: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required?: boolean;
    description?: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE INTERFACE
// ═══════════════════════════════════════════════════════════════════

export interface ChatServiceConfig {
  /** Path to SQLite database */
  dbPath: string;
  /** LLM configuration */
  llm: LLMConfig;
  /** Archive server URL for tool execution */
  archiveUrl?: string;
  /** Whether to auto-archive conversations */
  autoArchive?: boolean;
  /** User ID for AgentMaster tracking */
  userId?: string;
}

export interface SendMessageOptions {
  /** Project context */
  projectId?: string;
  /** Additional context to include */
  context?: string;
  /** Whether to execute tools */
  executeTools?: boolean;
  /** Signal for cancellation */
  signal?: AbortSignal;
}

export interface ChatServiceEvents {
  'message:created': { message: ChatMessage };
  'message:updated': { message: ChatMessage };
  'conversation:created': { conversation: ChatConversation };
  'conversation:archived': { conversationId: string };
  'tool:executed': { result: ToolResult };
  'tool:pending-approval': { toolName: string; params: Record<string, unknown>; proposalId: string };
  'error': { error: string; context?: string };
}

export type ChatEventHandler<T extends keyof ChatServiceEvents> = (
  event: ChatServiceEvents[T]
) => void;

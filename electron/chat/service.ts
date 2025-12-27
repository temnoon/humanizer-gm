/**
 * Chat Service - Core chat functionality
 *
 * Handles:
 * - LLM communication (Ollama, Anthropic, OpenAI)
 * - Tool parsing and execution
 * - Agent Council integration
 * - Conversation management
 */

import { getChatStore, type ChatStore } from './store';
import type {
  ChatConversation,
  ChatMessage,
  ChatServiceConfig,
  LLMConfig,
  LLMMessage,
  LLMResponse,
  ParsedToolUse,
  SendMessageOptions,
  ToolResult,
  ChatServiceEvents,
  ChatEventHandler,
} from './types';

// ═══════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════

const AUI_SYSTEM_PROMPT = `You are AUI (Agentic User Interface), the AI assistant for Humanizer Studio.

You help the user:
- Navigate the Studio (Archive panel, Tools panel, Book workspace)
- Search their archives (ChatGPT conversations, Facebook content, semantic search)
- Transform content (humanize, apply personas/styles, detect AI)
- Build books (chapters, passages, gems, curated content)
- Coordinate with the Council of House Agents (Curator, Harvester, Builder, Reviewer)

When you need to perform actions, use this syntax:
USE_TOOL(tool_name, {"param": "value"})

Available tools:
- search_archive: Search conversations by text
- semantic_search: Search by meaning/similarity
- humanize_text: Make text sound more human
- apply_persona: Apply a writing persona
- apply_style: Apply a writing style
- create_chapter: Create a new book chapter
- add_passage: Add a passage to a thread
- mark_gem: Mark content as a gem
- harvest_passages: Ask Harvester agent to find relevant content
- curate_passage: Ask Curator agent to assess quality
- build_chapter: Ask Builder agent to compose content
- review_content: Ask Reviewer agent to check quality

Your conversations are archived and become part of the user's searchable corpus.
Be concise but helpful. When possible, show users how to do things themselves.

The user is the Chairman of the Council - the ultimate authority over agents.`;

// ═══════════════════════════════════════════════════════════════════
// CHAT SERVICE
// ═══════════════════════════════════════════════════════════════════

export class ChatService {
  private store: ChatStore;
  private config: ChatServiceConfig;
  private currentConversation: ChatConversation | null = null;
  private eventHandlers: Map<keyof ChatServiceEvents, Set<ChatEventHandler<keyof ChatServiceEvents>>> = new Map();

  constructor(config: ChatServiceConfig) {
    this.config = config;
    this.store = getChatStore(config.dbPath);
  }

  // ─────────────────────────────────────────────────────────────────
  // CONVERSATION MANAGEMENT
  // ─────────────────────────────────────────────────────────────────

  startConversation(options?: { projectId?: string; tags?: string[] }): ChatConversation {
    const conversation: ChatConversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: 'New Conversation',
      startedAt: Date.now(),
      messageCount: 0,
      tags: options?.tags || ['aui'],
      archived: false,
      projectId: options?.projectId,
    };

    this.store.createConversation(conversation);
    this.currentConversation = conversation;

    // Add welcome message
    this.addMessage({
      id: `msg-welcome-${Date.now()}`,
      conversationId: conversation.id,
      role: 'assistant',
      content: "Hi! I'm AUI, your Studio assistant. I can help you navigate, search your archives, transform content, and build your book. What would you like to do?",
      timestamp: Date.now(),
    });

    this.emit('conversation:created', { conversation });
    return conversation;
  }

  getCurrentConversation(): ChatConversation | null {
    return this.currentConversation;
  }

  loadConversation(id: string): ChatConversation | null {
    const conversation = this.store.getConversation(id);
    if (conversation) {
      this.currentConversation = conversation;
    }
    return conversation;
  }

  listConversations(options?: { limit?: number; projectId?: string }): ChatConversation[] {
    return this.store.listConversations(options);
  }

  getMessages(conversationId?: string): ChatMessage[] {
    const id = conversationId || this.currentConversation?.id;
    if (!id) return [];
    return this.store.getMessages(id);
  }

  endConversation(): void {
    if (this.currentConversation) {
      this.store.updateConversation(this.currentConversation.id, {
        endedAt: Date.now(),
      });

      // Auto-archive if enabled
      if (this.config.autoArchive) {
        this.archiveConversation(this.currentConversation.id);
      }
    }
    this.currentConversation = null;
  }

  async archiveConversation(conversationId: string): Promise<void> {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) return;

    const messages = this.store.getMessages(conversationId);

    // Format for archiving
    const content = messages
      .map((m) => {
        const role = m.role === 'user' ? 'You' : 'AUI';
        return `**${role}**: ${m.content}`;
      })
      .join('\n\n');

    // Send to archive server if configured
    if (this.config.archiveUrl) {
      try {
        await fetch(`${this.config.archiveUrl}/api/aui/archive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: conversation.id,
            title: conversation.title,
            content,
            messages,
            tags: conversation.tags,
            startedAt: conversation.startedAt,
          }),
        });
      } catch (err) {
        console.warn('Failed to archive to server:', err);
      }
    }

    this.store.updateConversation(conversationId, { archived: true });
    this.emit('conversation:archived', { conversationId });
  }

  // ─────────────────────────────────────────────────────────────────
  // MESSAGE HANDLING
  // ─────────────────────────────────────────────────────────────────

  private addMessage(message: ChatMessage): ChatMessage {
    const saved = this.store.addMessage(message);
    this.emit('message:created', { message: saved });
    return saved;
  }

  async sendMessage(content: string, options?: SendMessageOptions): Promise<ChatMessage[]> {
    // Ensure we have a conversation
    if (!this.currentConversation) {
      this.startConversation({ projectId: options?.projectId });
    }

    const conversationId = this.currentConversation!.id;
    const newMessages: ChatMessage[] = [];

    // Add user message
    const userMessage = this.addMessage({
      id: `msg-user-${Date.now()}`,
      conversationId,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    });
    newMessages.push(userMessage);

    // Update conversation title from first user message
    if (this.currentConversation!.messageCount <= 2) {
      const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
      this.store.updateConversation(conversationId, { title });
      this.currentConversation!.title = title;
    }

    try {
      // Call LLM
      const startTime = Date.now();
      const llmResponse = await this.callLLM(conversationId, content, options);
      const latencyMs = Date.now() - startTime;

      // Log LLM call
      this.store.logLLMCall(
        conversationId,
        this.config.llm.provider,
        this.config.llm.model,
        llmResponse.usage,
        latencyMs,
        true
      );

      // Add assistant message
      const assistantMessage = this.addMessage({
        id: `msg-assistant-${Date.now()}`,
        conversationId,
        role: 'assistant',
        content: llmResponse.content,
        timestamp: Date.now(),
      });
      newMessages.push(assistantMessage);

      // Parse and execute tools
      if (options?.executeTools !== false) {
        const toolResults = await this.executeTools(
          assistantMessage.id,
          llmResponse.content
        );

        if (toolResults.length > 0) {
          const toolMessage = this.addMessage({
            id: `msg-tools-${Date.now()}`,
            conversationId,
            role: 'tool',
            content: toolResults
              .map((r) => (r.success ? `✓ ${r.message}` : `✗ ${r.error}`))
              .join('\n'),
            timestamp: Date.now(),
            toolResults,
          });
          newMessages.push(toolMessage);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';

      // Log failed LLM call
      this.store.logLLMCall(
        conversationId,
        this.config.llm.provider,
        this.config.llm.model,
        undefined,
        0,
        false,
        error
      );

      // Add error message
      const errorMessage = this.addMessage({
        id: `msg-error-${Date.now()}`,
        conversationId,
        role: 'system',
        content: `Error: ${error}`,
        timestamp: Date.now(),
      });
      newMessages.push(errorMessage);

      this.emit('error', { error, context: 'sendMessage' });
    }

    return newMessages;
  }

  // ─────────────────────────────────────────────────────────────────
  // LLM COMMUNICATION
  // ─────────────────────────────────────────────────────────────────

  private async callLLM(
    conversationId: string,
    userContent: string,
    options?: SendMessageOptions
  ): Promise<LLMResponse> {
    // Build message history
    const messages = this.store.getMessages(conversationId);
    const llmMessages: LLMMessage[] = [
      { role: 'system', content: AUI_SYSTEM_PROMPT },
    ];

    // Add context if provided
    if (options?.context) {
      llmMessages.push({
        role: 'system',
        content: `Current context:\n${options.context}`,
      });
    }

    // Add conversation history (excluding tool messages)
    for (const msg of messages) {
      if (msg.role === 'tool') continue;
      llmMessages.push({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      });
    }

    // Add current message
    llmMessages.push({ role: 'user', content: userContent });

    // Call appropriate provider
    switch (this.config.llm.provider) {
      case 'ollama':
        return this.callOllama(llmMessages);
      case 'anthropic':
        return this.callAnthropic(llmMessages);
      case 'openai':
        return this.callOpenAI(llmMessages);
      default:
        throw new Error(`Unknown LLM provider: ${this.config.llm.provider}`);
    }
  }

  private async callOllama(messages: LLMMessage[]): Promise<LLMResponse> {
    const baseUrl = this.config.llm.baseUrl || 'http://localhost:11434';

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.llm.model,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.message?.content || '',
      model: this.config.llm.model,
      usage: data.eval_count
        ? {
            promptTokens: data.prompt_eval_count || 0,
            completionTokens: data.eval_count || 0,
            totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
          }
        : undefined,
    };
  }

  private async callAnthropic(messages: LLMMessage[]): Promise<LLMResponse> {
    const baseUrl = this.config.llm.baseUrl || 'https://api.anthropic.com';
    const apiKey = this.config.llm.apiKey;

    if (!apiKey) {
      throw new Error('Anthropic API key required');
    }

    // Extract system message
    const systemMessage = messages.find((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.llm.model,
        max_tokens: this.config.llm.maxTokens || 4096,
        system: systemMessage?.content,
        messages: chatMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic error: ${error}`);
    }

    const data = await response.json();
    return {
      content: data.content[0]?.text || '',
      model: data.model,
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };
  }

  private async callOpenAI(messages: LLMMessage[]): Promise<LLMResponse> {
    const baseUrl = this.config.llm.baseUrl || 'https://api.openai.com';
    const apiKey = this.config.llm.apiKey;

    if (!apiKey) {
      throw new Error('OpenAI API key required');
    }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.llm.model,
        messages,
        max_tokens: this.config.llm.maxTokens || 4096,
        temperature: this.config.llm.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI error: ${error}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content || '',
      model: data.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // TOOL EXECUTION
  // ─────────────────────────────────────────────────────────────────

  private async executeTools(messageId: string, content: string): Promise<ToolResult[]> {
    const toolUses = this.parseToolUses(content);
    if (toolUses.length === 0) return [];

    const results: ToolResult[] = [];

    for (const tool of toolUses) {
      const startTime = Date.now();

      try {
        const result = await this.executeTool(tool.name, tool.params);
        results.push(result);

        // Log execution
        this.store.logToolExecution(
          messageId,
          tool.name,
          tool.params,
          result,
          Date.now() - startTime
        );

        this.emit('tool:executed', { result });
      } catch (err) {
        const errorResult: ToolResult = {
          toolName: tool.name,
          success: false,
          message: '',
          error: err instanceof Error ? err.message : 'Unknown error',
        };
        results.push(errorResult);

        this.store.logToolExecution(
          messageId,
          tool.name,
          tool.params,
          errorResult,
          Date.now() - startTime
        );
      }
    }

    return results;
  }

  private parseToolUses(content: string): ParsedToolUse[] {
    const regex = /USE_TOOL\s*\(\s*(\w+)\s*,\s*(\{[^}]+\})\s*\)/g;
    const tools: ParsedToolUse[] = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      try {
        const name = match[1];
        const params = JSON.parse(match[2]);
        tools.push({ name, params });
      } catch {
        // Invalid JSON, skip
      }
    }

    return tools;
  }

  private async executeTool(
    name: string,
    params: Record<string, unknown>
  ): Promise<ToolResult> {
    // Agent tools - route to Agent Council
    if (name.startsWith('harvest_') || name.startsWith('curate_') ||
        name.startsWith('build_') || name.startsWith('review_')) {
      return this.routeToAgent(name, params);
    }

    // Archive tools - call archive server
    if (name === 'search_archive' || name === 'semantic_search') {
      return this.callArchiveTool(name, params);
    }

    // Book tools - stub for now (would call BookContext)
    if (name === 'create_chapter' || name === 'add_passage' || name === 'mark_gem') {
      return {
        toolName: name,
        success: true,
        message: `${name} executed (stub)`,
        data: { name, params },
        teaching: {
          whatHappened: `Would execute ${name}`,
          guiPath: ['Books tab', 'Select project', `Click ${name}`],
        },
      };
    }

    // Transform tools - stub for now
    if (name === 'humanize_text' || name === 'apply_persona' || name === 'apply_style') {
      return {
        toolName: name,
        success: true,
        message: `${name} executed (stub)`,
        data: { name, params },
        teaching: {
          whatHappened: `Would execute ${name}`,
          guiPath: ['Tools panel', `Select ${name}`],
        },
      };
    }

    return {
      toolName: name,
      success: false,
      message: '',
      error: `Unknown tool: ${name}`,
    };
  }

  private async routeToAgent(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<ToolResult> {
    // Determine agent ID from tool name
    const agentId = toolName.split('_')[0]; // e.g., 'harvest' from 'harvest_passages'

    // In a full implementation, this would:
    // 1. Import the council orchestrator
    // 2. Create a task or proposal
    // 3. Wait for result or emit pending-approval event

    return {
      toolName,
      success: true,
      message: `Routed to ${agentId} agent`,
      agentId: `${agentId}er`, // e.g., 'harvester'
      data: { routed: true, params },
      teaching: {
        whatHappened: `Task sent to ${agentId} agent for processing`,
        why: 'Complex tasks are handled by specialized agents',
      },
    };
  }

  private async callArchiveTool(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<ToolResult> {
    if (!this.config.archiveUrl) {
      return {
        toolName,
        success: false,
        message: '',
        error: 'Archive server not configured',
      };
    }

    try {
      const endpoint =
        toolName === 'search_archive'
          ? '/api/search'
          : '/api/embeddings/search/messages';

      const response = await fetch(`${this.config.archiveUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(`Archive API error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        toolName,
        success: true,
        message: `Found ${Array.isArray(data) ? data.length : '?'} results`,
        data,
        teaching: {
          whatHappened: 'Searched the archive',
          guiPath: ['Archive panel', 'Explore tab', 'Enter search query'],
          shortcut: 'Cmd+K',
        },
      };
    } catch (err) {
      return {
        toolName,
        success: false,
        message: '',
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // EVENT SYSTEM
  // ─────────────────────────────────────────────────────────────────

  on<T extends keyof ChatServiceEvents>(
    event: T,
    handler: ChatEventHandler<T>
  ): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as ChatEventHandler<keyof ChatServiceEvents>);

    return () => {
      this.eventHandlers.get(event)?.delete(handler as ChatEventHandler<keyof ChatServiceEvents>);
    };
  }

  private emit<T extends keyof ChatServiceEvents>(
    event: T,
    data: ChatServiceEvents[T]
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      Array.from(handlers).forEach((handler) => {
        try {
          handler(data);
        } catch (err) {
          console.error(`Error in event handler for ${event}:`, err);
        }
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // UTILITY
  // ─────────────────────────────────────────────────────────────────

  updateConfig(updates: Partial<ChatServiceConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getStats() {
    return this.store.getStats();
  }

  searchMessages(query: string) {
    return this.store.searchMessages(query);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════

let _service: ChatService | null = null;

export function getChatService(config?: ChatServiceConfig): ChatService {
  if (!_service) {
    if (!config) {
      throw new Error('Config required for first initialization');
    }
    _service = new ChatService(config);
  }
  return _service;
}

export function closeChatService(): void {
  _service = null;
}

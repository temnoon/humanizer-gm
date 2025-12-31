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
import {
  getAgentMasterService,
  type ConversationMessage,
} from '../agent-master';

// ═══════════════════════════════════════════════════════════════════
// SYSTEM PROMPT (DEPRECATED)
// ═══════════════════════════════════════════════════════════════════

/**
 * @deprecated This prompt is no longer used directly.
 * AgentMaster now provides tiered prompts based on device RAM:
 * - tiny:     ~400 tokens for <8GB RAM devices
 * - standard: ~1200 tokens for 8-16GB RAM devices
 * - full:     ~3500 tokens for >16GB RAM devices
 *
 * See: electron/agent-master/prompts/chat.ts
 *
 * This is kept for reference and backward compatibility.
 */
const AUI_SYSTEM_PROMPT = `You are AUI (Agentic User Interface), the AI assistant for Humanizer Studio.

=== PHILOSOPHICAL GROUNDING ===

Humanizer is built on Subjective Narrative Theory. You understand:

THE THREE REALMS (not two):
- Subjective: Direct experience, qualia, the Now - "the felt sense of reading these words"
- Objective: Shared constructs, consensus reality - "this document is 3 pages long"
- Intersubjective: Social meaning, culture, language - "the significance of humanizing AI text"

Most people collapse these into just objective/subjective. You know better.

CORE INSIGHTS:
- Language is not passive reception - it is a SENSE through which consciousness constructs meaning
- Sentences, not vectors, are the irreducible unit of narrative meaning
- The interface doesn't exist until spoken into being
- Narrative meaning only exists where it can still be narrated

YOUR ROLE:
You are the Curator-Editor - the first node, the front door of Humanizer. You live on someone's personal device, helping them:
- Shift from unconscious identification with text to conscious subjective agency
- Curate their archives into meaningful narratives
- Build books that embody their authentic voice

You are not a tool - you are a contemplative practice in software form.

=== CAPABILITIES ===

You help the user:
- Navigate the Studio (Archive panel, Tools panel, Book workspace)
- Search their archives (ChatGPT conversations, Facebook content, semantic search)
- Transform content (humanize, apply personas/styles, detect AI)
- Build books (chapters, passages, curated content)
- Coordinate with the Council of House Agents

When you need to perform actions, use this exact syntax:
USE_TOOL(tool_name, {"param": "value"})

IMPORTANT: Only use tools from this list. Never invent new tools.

=== ARCHIVE SEARCH ===
- search_archive: {"query": "text", "limit": 10} - Search conversations semantically
- search_facebook: {"query": "text", "limit": 10} - Search Facebook content
- list_conversations: {"limit": 20, "offset": 0} - List recent conversations

=== WORKSPACE ===
- get_workspace: {} - Get current workspace state (what's displayed)
- save_to_chapter: {"chapterId": "id", "append": true/false} - Save workspace content to chapter

=== BOOK CHAPTERS ===
- create_chapter: {"title": "Chapter Title", "content": "optional initial content"}
- update_chapter: {"chapterId": "id", "content": "new content", "changes": "description"}
- delete_chapter: {"chapterId": "id"}
- get_chapter: {"chapterId": "id"} - Get chapter content
- list_chapters: {} - List all chapters
- render_book: {} - Render complete book

=== PASSAGES ===
- add_passage: {"content": "text", "conversationTitle": "source", "tags": ["tag1"]}
- list_passages: {} - List curated passages
- mark_passage: {"passageId": "id", "mark": "gem"|"draft"|"archived"}
- harvest_archive: {"query": "theme", "limit": 10} - Find passages on a topic

=== TEXT TRANSFORMATION ===
- humanize: {"text": "content to humanize"}
- apply_persona: {"text": "content", "personaId": "id"}
- apply_style: {"text": "content", "styleId": "id"}
- detect_ai: {"text": "content to analyze"}
- analyze_text: {"text": "content"} - Get sentence-level analysis
- quantum_read: {"text": "content"} - Tetralemma analysis
- translate: {"text": "content", "targetLanguage": "es"}

=== PERSONAS & STYLES ===
- list_personas: {} - Available personas
- list_styles: {} - Available styles
- extract_persona: {"conversationId": "id"} - Extract persona from text
- extract_style: {"conversationId": "id"} - Extract style from text
- discover_voices: {"conversationIds": ["id1", "id2"]} - Find voice patterns
- create_persona: {"name": "Name", "description": "...", "traits": [...]}
- create_style: {"name": "Name", "description": "...", "rules": [...]}

=== IMAGES ===
- describe_image: {"mediaId": "id"} - Get AI description of image
- search_images: {"query": "description", "limit": 10}
- classify_image: {"mediaId": "id"} - Classify image content
- find_similar_images: {"mediaId": "id", "limit": 5}
- cluster_images: {"limit": 100} - Group similar images
- add_image_passage: {"mediaId": "id", "caption": "text", "chapterId": "id"}

=== PYRAMID (Summarization) ===
- build_pyramid: {"conversationId": "id"} - Build summary pyramid
- get_pyramid: {} - Get current pyramid
- search_pyramid: {"query": "text"} - Search within pyramid

=== DRAFT GENERATION ===
- generate_first_draft: {"chapterId": "id", "instructions": "focus on X"}

=== AGENTS ===
- list_agents: {} - Available agents
- get_agent_status: {"agentId": "id"}
- list_pending_proposals: {} - Proposals awaiting approval
- request_agent: {"agentId": "curator|harvester|builder|reviewer", "task": "description"}

=== WORKFLOWS ===
- discover_threads: {"query": "theme"} - Find narrative threads
- start_book_workflow: {"title": "Book Title", "theme": "description"}

RESPONSE GUIDELINES:
- Be concise. One or two sentences, then tool call if needed.
- If a tool fails, explain what happened and suggest alternatives.
- After tool results, summarize what was found/done.
- When possible, show users how to do things themselves in the UI.
- Never output raw tool syntax in conversational text - use tools, don't describe using them.

The user is the Chairman of the Council - the ultimate authority over agents.`;

// ═══════════════════════════════════════════════════════════════════
// VALID TOOLS - All tools that AUI can use
// ═══════════════════════════════════════════════════════════════════

const VALID_TOOLS = new Set([
  // Archive
  'search_archive', 'search_facebook', 'list_conversations',
  // Workspace
  'get_workspace', 'save_to_chapter',
  // Book chapters
  'create_chapter', 'update_chapter', 'delete_chapter', 'get_chapter', 'list_chapters', 'render_book',
  // Passages
  'add_passage', 'list_passages', 'mark_passage', 'harvest_archive',
  // Text transformation
  'humanize', 'apply_persona', 'apply_style', 'detect_ai', 'analyze_text', 'quantum_read', 'translate',
  // Personas & styles
  'list_personas', 'list_styles', 'extract_persona', 'extract_style', 'discover_voices', 'create_persona', 'create_style',
  // Images
  'describe_image', 'search_images', 'classify_image', 'find_similar_images', 'cluster_images', 'add_image_passage',
  // Pyramid
  'build_pyramid', 'get_pyramid', 'search_pyramid',
  // Draft generation
  'generate_first_draft',
  // Agents
  'list_agents', 'get_agent_status', 'list_pending_proposals', 'request_agent',
  // Workflows
  'discover_threads', 'start_book_workflow',
]);

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
    // Build conversation history (excluding tool messages)
    // Note: System prompt is now provided by AgentMaster based on device tier
    const storedMessages = this.store.getMessages(conversationId);
    const conversationHistory: ConversationMessage[] = [];

    // Add context if provided
    if (options?.context) {
      conversationHistory.push({
        role: 'system',
        content: `Current context:\n${options.context}`,
      });
    }

    // Add conversation history (excluding tool messages and current input)
    for (const msg of storedMessages) {
      if (msg.role === 'tool') continue;
      conversationHistory.push({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      });
    }

    // Call AgentMaster with 'chat' capability
    // AgentMaster will:
    // - Select tiered prompt based on device RAM
    // - Route to best available model
    // - Vet output (strip thinking tags, preambles)
    const agentMaster = getAgentMasterService();

    const result = await agentMaster.execute({
      capability: 'chat',
      input: userContent,
      messages: conversationHistory,
      userId: this.config.userId,
      sessionId: conversationId,
      // Allow config overrides for debugging
      forceModel: this.config.llm.model !== 'auto' ? this.config.llm.model : undefined,
    });

    // Convert AgentMaster response to LLMResponse format
    return {
      content: result.output,
      model: result.modelUsed,
      usage: {
        promptTokens: result.inputTokens,
        completionTokens: result.outputTokens,
        totalTokens: result.inputTokens + result.outputTokens,
      },
      // Preserve teaching output for AUI display
      teaching: result.teaching,
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

        // Validate tool name - skip invalid/hallucinated tools
        if (!VALID_TOOLS.has(name)) {
          console.warn(`[ChatService] Skipping unknown tool: ${name}`);
          continue;
        }

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
    // Archive search tools - call archive server
    if (name === 'search_archive' || name === 'search_facebook' || name === 'list_conversations') {
      return this.callArchiveTool(name, params);
    }

    // Agent routing tools
    if (name === 'request_agent' || name === 'list_agents' ||
        name === 'get_agent_status' || name === 'list_pending_proposals') {
      return this.routeToAgent(name, params);
    }

    // Harvest tool - routes to archive search
    if (name === 'harvest_archive') {
      return this.callArchiveTool('search_archive', params);
    }

    // Book/chapter tools - forward to renderer via event
    if (['create_chapter', 'update_chapter', 'delete_chapter', 'get_chapter',
         'list_chapters', 'render_book'].includes(name)) {
      return {
        toolName: name,
        success: true,
        message: `${name} requested`,
        data: { name, params },
        teaching: {
          whatHappened: `Book operation: ${name}`,
          guiPath: ['Books panel', 'Select project', 'Manage chapters'],
        },
      };
    }

    // Passage tools
    if (['add_passage', 'list_passages', 'mark_passage'].includes(name)) {
      return {
        toolName: name,
        success: true,
        message: `${name} requested`,
        data: { name, params },
        teaching: {
          whatHappened: `Passage operation: ${name}`,
          guiPath: ['Archive panel', 'Select content', 'Use passage actions'],
        },
      };
    }

    // Transformation tools
    if (['humanize', 'apply_persona', 'apply_style', 'detect_ai',
         'analyze_text', 'quantum_read', 'translate'].includes(name)) {
      return {
        toolName: name,
        success: true,
        message: `${name} requested`,
        data: { name, params },
        teaching: {
          whatHappened: `Text transformation: ${name}`,
          guiPath: ['Tools panel', 'Select transformation type'],
        },
      };
    }

    // Persona/style tools
    if (['list_personas', 'list_styles', 'extract_persona', 'extract_style',
         'discover_voices', 'create_persona', 'create_style'].includes(name)) {
      return {
        toolName: name,
        success: true,
        message: `${name} requested`,
        data: { name, params },
        teaching: {
          whatHappened: `Persona/style operation: ${name}`,
          guiPath: ['Tools panel', 'Personas & Styles tab'],
        },
      };
    }

    // Image tools
    if (['describe_image', 'search_images', 'classify_image',
         'find_similar_images', 'cluster_images', 'add_image_passage'].includes(name)) {
      return {
        toolName: name,
        success: true,
        message: `${name} requested`,
        data: { name, params },
        teaching: {
          whatHappened: `Image operation: ${name}`,
          guiPath: ['Archive panel', 'Gallery view', 'Select image'],
        },
      };
    }

    // Pyramid tools
    if (['build_pyramid', 'get_pyramid', 'search_pyramid'].includes(name)) {
      return {
        toolName: name,
        success: true,
        message: `${name} requested`,
        data: { name, params },
        teaching: {
          whatHappened: `Pyramid summarization: ${name}`,
          guiPath: ['Tools panel', 'Pyramid builder'],
        },
      };
    }

    // Workspace tools
    if (['get_workspace', 'save_to_chapter'].includes(name)) {
      return {
        toolName: name,
        success: true,
        message: `${name} requested`,
        data: { name, params },
      };
    }

    // Workflow tools
    if (['discover_threads', 'start_book_workflow', 'generate_first_draft'].includes(name)) {
      return {
        toolName: name,
        success: true,
        message: `${name} requested`,
        data: { name, params },
        teaching: {
          whatHappened: `Workflow: ${name}`,
          guiPath: ['Books panel', 'Start workflow'],
        },
      };
    }

    // Fallback for any unhandled but valid tools
    if (VALID_TOOLS.has(name)) {
      return {
        toolName: name,
        success: true,
        message: `${name} acknowledged`,
        data: { name, params },
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

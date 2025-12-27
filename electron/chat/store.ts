/**
 * Chat Store - SQLite persistence for conversations
 */

import * as path from 'path';
import * as fs from 'fs';
import type {
  ChatConversation,
  ChatMessage,
  ToolResult,
} from './types';

// Use require for better-sqlite3 to handle the default export
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('better-sqlite3') as typeof import('better-sqlite3');
type DatabaseInstance = import('better-sqlite3').Database;

// ═══════════════════════════════════════════════════════════════════
// CHAT STORE
// ═══════════════════════════════════════════════════════════════════

export class ChatStore {
  private db: DatabaseInstance;
  private initialized = false;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  // ─────────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────────────

  initialize(): void {
    if (this.initialized) return;

    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Execute schema (split by ; and filter empty)
    const statements = schema
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      this.db.exec(statement);
    }

    this.initialized = true;
  }

  close(): void {
    this.db.close();
  }

  // ─────────────────────────────────────────────────────────────────
  // CONVERSATIONS
  // ─────────────────────────────────────────────────────────────────

  createConversation(conversation: Omit<ChatConversation, 'messageCount'>): ChatConversation {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, title, started_at, tags, archived, project_id, preview)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      conversation.id,
      conversation.title,
      conversation.startedAt,
      JSON.stringify(conversation.tags),
      conversation.archived ? 1 : 0,
      conversation.projectId || null,
      conversation.preview || null
    );

    return { ...conversation, messageCount: 0 };
  }

  getConversation(id: string): ChatConversation | null {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations WHERE id = ?
    `);

    const row = stmt.get(id) as ConversationRow | undefined;
    if (!row) return null;

    return this.rowToConversation(row);
  }

  listConversations(options?: {
    limit?: number;
    offset?: number;
    projectId?: string;
    archived?: boolean;
  }): ChatConversation[] {
    let query = 'SELECT * FROM conversations WHERE 1=1';
    const params: unknown[] = [];

    if (options?.projectId) {
      query += ' AND project_id = ?';
      params.push(options.projectId);
    }

    if (options?.archived !== undefined) {
      query += ' AND archived = ?';
      params.push(options.archived ? 1 : 0);
    }

    query += ' ORDER BY started_at DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options?.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as ConversationRow[];

    return rows.map(this.rowToConversation);
  }

  updateConversation(id: string, updates: Partial<ChatConversation>): boolean {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.endedAt !== undefined) {
      fields.push('ended_at = ?');
      values.push(updates.endedAt);
    }
    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.archived !== undefined) {
      fields.push('archived = ?');
      values.push(updates.archived ? 1 : 0);
    }
    if (updates.preview !== undefined) {
      fields.push('preview = ?');
      values.push(updates.preview);
    }

    if (fields.length === 0) return false;

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE conversations SET ${fields.join(', ')} WHERE id = ?
    `);

    const result = stmt.run(...values);
    return result.changes > 0;
  }

  deleteConversation(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM conversations WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ─────────────────────────────────────────────────────────────────
  // MESSAGES
  // ─────────────────────────────────────────────────────────────────

  addMessage(message: ChatMessage): ChatMessage {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_results, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.id,
      message.conversationId,
      message.role,
      message.content,
      message.timestamp,
      message.toolResults ? JSON.stringify(message.toolResults) : null,
      message.metadata ? JSON.stringify(message.metadata) : null
    );

    // Update conversation message count and preview
    this.db.prepare(`
      UPDATE conversations
      SET message_count = message_count + 1,
          preview = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      message.content.slice(0, 200),
      Date.now(),
      message.conversationId
    );

    return message;
  }

  getMessages(conversationId: string, options?: {
    limit?: number;
    beforeTimestamp?: number;
  }): ChatMessage[] {
    let query = 'SELECT * FROM messages WHERE conversation_id = ?';
    const params: unknown[] = [conversationId];

    if (options?.beforeTimestamp) {
      query += ' AND timestamp < ?';
      params.push(options.beforeTimestamp);
    }

    query += ' ORDER BY timestamp ASC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as MessageRow[];

    return rows.map(this.rowToMessage);
  }

  getMessage(id: string): ChatMessage | null {
    const stmt = this.db.prepare('SELECT * FROM messages WHERE id = ?');
    const row = stmt.get(id) as MessageRow | undefined;
    if (!row) return null;
    return this.rowToMessage(row);
  }

  updateMessage(id: string, updates: Partial<ChatMessage>): boolean {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.toolResults !== undefined) {
      fields.push('tool_results = ?');
      values.push(JSON.stringify(updates.toolResults));
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length === 0) return false;

    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE messages SET ${fields.join(', ')} WHERE id = ?
    `);

    const result = stmt.run(...values);
    return result.changes > 0;
  }

  // ─────────────────────────────────────────────────────────────────
  // TOOL EXECUTION LOG
  // ─────────────────────────────────────────────────────────────────

  logToolExecution(
    messageId: string,
    toolName: string,
    params: Record<string, unknown>,
    result: ToolResult,
    executionTimeMs: number
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO tool_executions (message_id, tool_name, params, success, result, error, agent_id, execution_time_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      messageId,
      toolName,
      JSON.stringify(params),
      result.success ? 1 : 0,
      result.data ? JSON.stringify(result.data) : null,
      result.error || null,
      result.agentId || null,
      executionTimeMs
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // LLM CALL LOG
  // ─────────────────────────────────────────────────────────────────

  logLLMCall(
    conversationId: string,
    provider: string,
    model: string,
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined,
    latencyMs: number,
    success: boolean,
    error?: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO llm_calls (conversation_id, provider, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, success, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      conversationId,
      provider,
      model,
      usage?.promptTokens || null,
      usage?.completionTokens || null,
      usage?.totalTokens || null,
      latencyMs,
      success ? 1 : 0,
      error || null
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // SEARCH
  // ─────────────────────────────────────────────────────────────────

  searchMessages(query: string, limit = 50): Array<ChatMessage & { conversationId: string }> {
    const stmt = this.db.prepare(`
      SELECT m.* FROM messages m
      JOIN messages_fts fts ON m.rowid = fts.rowid
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const rows = stmt.all(query, limit) as MessageRow[];
    return rows.map(this.rowToMessage);
  }

  // ─────────────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────────────

  getStats(): {
    totalConversations: number;
    totalMessages: number;
    archivedConversations: number;
    toolExecutions: number;
  } {
    const stats = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM conversations) as total_conversations,
        (SELECT COUNT(*) FROM messages) as total_messages,
        (SELECT COUNT(*) FROM conversations WHERE archived = 1) as archived_conversations,
        (SELECT COUNT(*) FROM tool_executions) as tool_executions
    `).get() as {
      total_conversations: number;
      total_messages: number;
      archived_conversations: number;
      tool_executions: number;
    };

    return {
      totalConversations: stats.total_conversations,
      totalMessages: stats.total_messages,
      archivedConversations: stats.archived_conversations,
      toolExecutions: stats.tool_executions,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────

  private rowToConversation(row: ConversationRow): ChatConversation {
    return {
      id: row.id,
      title: row.title,
      startedAt: row.started_at,
      endedAt: row.ended_at || undefined,
      messageCount: row.message_count,
      tags: row.tags ? JSON.parse(row.tags) : [],
      archived: row.archived === 1,
      projectId: row.project_id || undefined,
      preview: row.preview || undefined,
    };
  }

  private rowToMessage(row: MessageRow): ChatMessage {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as ChatMessage['role'],
      content: row.content,
      timestamp: row.timestamp,
      toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// ROW TYPES
// ═══════════════════════════════════════════════════════════════════

interface ConversationRow {
  id: string;
  title: string;
  started_at: number;
  ended_at: number | null;
  message_count: number;
  tags: string | null;
  archived: number;
  project_id: string | null;
  preview: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  timestamp: number;
  tool_results: string | null;
  metadata: string | null;
  created_at: number;
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════

let _store: ChatStore | null = null;

export function getChatStore(dbPath?: string): ChatStore {
  if (!_store) {
    if (!dbPath) {
      throw new Error('Database path required for first initialization');
    }
    _store = new ChatStore(dbPath);
    _store.initialize();
  }
  return _store;
}

export function closeChatStore(): void {
  if (_store) {
    _store.close();
    _store = null;
  }
}

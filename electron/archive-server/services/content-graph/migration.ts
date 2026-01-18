/**
 * UCG Migration - Migrate existing content to Universal Content Graph
 *
 * Migrates data from existing tables (conversations, messages, content_items)
 * into the unified content_nodes and content_links tables.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { ContentGraphDatabase } from './ContentGraphDatabase.js';
import type { ContentFormat, UCGSourceType as SourceType, LinkType } from '@humanizer/core';

/**
 * Migration progress callback
 */
export interface MigrationProgress {
  phase: 'conversations' | 'messages' | 'content_items' | 'links' | 'complete';
  current: number;
  total: number;
  currentItem?: string;
}

export type ProgressCallback = (progress: MigrationProgress) => void;

/**
 * Migration statistics
 */
export interface MigrationStats {
  conversationsMigrated: number;
  messagesMigrated: number;
  contentItemsMigrated: number;
  linksMigrated: number;
  errors: string[];
  duration: number;
}

/**
 * UCGMigration - Handles data migration to UCG format
 */
export class UCGMigration {
  private db: Database.Database;
  private graphDb: ContentGraphDatabase;

  // Maps old IDs to new UCG IDs
  private conversationIdMap = new Map<string, string>();
  private messageIdMap = new Map<string, string>();
  private contentItemIdMap = new Map<string, string>();

  constructor(db: Database.Database, graphDb: ContentGraphDatabase) {
    this.db = db;
    this.graphDb = graphDb;
  }

  /**
   * Run full migration
   */
  async migrate(
    onProgress?: ProgressCallback,
    options: { dryRun?: boolean } = {}
  ): Promise<MigrationStats> {
    const startTime = Date.now();
    const errors: string[] = [];
    let conversationsMigrated = 0;
    let messagesMigrated = 0;
    let contentItemsMigrated = 0;
    let linksMigrated = 0;

    // Create import batch for migration
    const batchId = options.dryRun ? 'dry-run' : this.graphDb.createImportBatch(
      'import' as SourceType,
      undefined,
      'UCG Migration'
    );

    try {
      // Phase 1: Migrate conversations
      conversationsMigrated = await this.migrateConversations(batchId, onProgress, errors);

      // Phase 2: Migrate messages
      messagesMigrated = await this.migrateMessages(batchId, onProgress, errors);

      // Phase 3: Migrate content_items
      contentItemsMigrated = await this.migrateContentItems(batchId, onProgress, errors);

      // Phase 4: Create links
      linksMigrated = await this.createLinks(onProgress, errors);

      // Complete
      onProgress?.({ phase: 'complete', current: 0, total: 0 });

      // Update batch status
      if (!options.dryRun) {
        this.graphDb.updateImportBatch(batchId, {
          status: 'completed',
          nodeCount: conversationsMigrated + messagesMigrated + contentItemsMigrated,
          errorCount: errors.length,
          errorLog: errors.slice(0, 100), // Limit error log
          completedAt: Date.now(),
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`Migration failed: ${errorMsg}`);

      if (!options.dryRun) {
        this.graphDb.updateImportBatch(batchId, {
          status: 'failed',
          errorCount: errors.length,
          errorLog: errors.slice(0, 100),
          completedAt: Date.now(),
        });
      }
    }

    return {
      conversationsMigrated,
      messagesMigrated,
      contentItemsMigrated,
      linksMigrated,
      errors,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Migrate conversations table
   */
  private async migrateConversations(
    batchId: string,
    onProgress?: ProgressCallback,
    errors: string[] = []
  ): Promise<number> {
    // Check if conversations table exists
    const tableExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'
    `).get();

    if (!tableExists) {
      console.log('[Migration] No conversations table found, skipping');
      return 0;
    }

    const total = (this.db.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number }).count;
    let migrated = 0;

    const rows = this.db.prepare(`
      SELECT * FROM conversations ORDER BY created_at
    `).all() as ConversationRow[];

    for (const row of rows) {
      try {
        onProgress?.({
          phase: 'conversations',
          current: migrated,
          total,
          currentItem: row.title,
        });

        // Skip if already migrated (check by URI)
        const existingUri = `content://chatgpt/conversation/${row.id}`;
        const existing = this.graphDb.getNodeByUri(existingUri);
        if (existing) {
          this.conversationIdMap.set(row.id, existing.id);
          migrated++;
          continue;
        }

        // Create content node
        const node = this.graphDb.createNode({
          text: row.summary || `Conversation: ${row.title}`,
          format: 'conversation',
          title: row.title,
          createdAt: row.created_at * 1000,
          sourceType: 'chatgpt',
          adapter: 'migration',
          originalId: row.id,
          originalPath: row.folder,
          importBatch: batchId,
          sourceMetadata: {
            folder: row.folder,
            messageCount: row.message_count,
            totalTokens: row.total_tokens,
            isInteresting: row.is_interesting,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          },
        });

        this.conversationIdMap.set(row.id, node.id);
        migrated++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to migrate conversation ${row.id}: ${errorMsg}`);
      }
    }

    return migrated;
  }

  /**
   * Migrate messages table
   */
  private async migrateMessages(
    batchId: string,
    onProgress?: ProgressCallback,
    errors: string[] = []
  ): Promise<number> {
    // Check if messages table exists
    const tableExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='messages'
    `).get();

    if (!tableExists) {
      console.log('[Migration] No messages table found, skipping');
      return 0;
    }

    const total = (this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }).count;
    let migrated = 0;

    // Process in batches
    const batchSize = 1000;
    let offset = 0;

    while (offset < total) {
      const rows = this.db.prepare(`
        SELECT * FROM messages ORDER BY created_at LIMIT ? OFFSET ?
      `).all(batchSize, offset) as MessageRow[];

      for (const row of rows) {
        try {
          onProgress?.({
            phase: 'messages',
            current: migrated,
            total,
            currentItem: `Message ${row.id.slice(0, 8)}`,
          });

          // Skip if no content
          if (!row.content?.trim()) {
            migrated++;
            continue;
          }

          // Skip if already migrated
          const existingUri = `content://chatgpt/message/${row.conversation_id}/${row.id}`;
          const existing = this.graphDb.getNodeByUri(existingUri);
          if (existing) {
            this.messageIdMap.set(row.id, existing.id);
            migrated++;
            continue;
          }

          // Get conversation node ID
          const convNodeId = this.conversationIdMap.get(row.conversation_id);

          // Create content node
          const node = this.graphDb.createNode({
            text: row.content,
            format: this.detectFormat(row.content),
            author: row.role,
            createdAt: row.created_at * 1000,
            sourceType: 'chatgpt',
            adapter: 'migration',
            originalId: row.id,
            originalPath: `${row.conversation_id}/${row.id}`,
            importBatch: batchId,
            sourceMetadata: {
              conversationId: row.conversation_id,
              parentId: row.parent_id,
              role: row.role,
              tokenCount: row.token_count,
            },
          });

          this.messageIdMap.set(row.id, node.id);

          // Create parent link to conversation
          if (convNodeId) {
            this.graphDb.createLink({
              sourceId: node.id,
              targetId: convNodeId,
              type: 'child',
              createdBy: 'migration',
            });
          }

          migrated++;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to migrate message ${row.id}: ${errorMsg}`);
        }
      }

      offset += batchSize;
    }

    return migrated;
  }

  /**
   * Migrate content_items table
   */
  private async migrateContentItems(
    batchId: string,
    onProgress?: ProgressCallback,
    errors: string[] = []
  ): Promise<number> {
    // Check if content_items table exists
    const tableExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='content_items'
    `).get();

    if (!tableExists) {
      console.log('[Migration] No content_items table found, skipping');
      return 0;
    }

    const total = (this.db.prepare('SELECT COUNT(*) as count FROM content_items').get() as { count: number }).count;
    let migrated = 0;

    // Process in batches
    const batchSize = 1000;
    let offset = 0;

    while (offset < total) {
      const rows = this.db.prepare(`
        SELECT * FROM content_items ORDER BY created_at LIMIT ? OFFSET ?
      `).all(batchSize, offset) as ContentItemRow[];

      for (const row of rows) {
        try {
          onProgress?.({
            phase: 'content_items',
            current: migrated,
            total,
            currentItem: row.title || `${row.type} ${row.id.slice(0, 8)}`,
          });

          // Skip if no text content
          if (!row.text?.trim()) {
            migrated++;
            continue;
          }

          // Determine source type from content_items type and source
          const sourceType = this.mapContentItemSource(row.type, row.source);

          // Skip if already migrated
          const existingUri = `content://${sourceType}/${row.id}`;
          const existing = this.graphDb.getNodeByUri(existingUri);
          if (existing) {
            this.contentItemIdMap.set(row.id, existing.id);
            migrated++;
            continue;
          }

          // Create content node
          const node = this.graphDb.createNode({
            text: row.text,
            format: this.detectFormat(row.text),
            title: row.title || undefined,
            author: row.author_name || undefined,
            createdAt: row.created_at * 1000,
            tags: row.tags ? JSON.parse(row.tags) : [],
            sourceType,
            adapter: 'migration',
            originalId: row.id,
            originalPath: row.file_path || undefined,
            importBatch: batchId,
            sourceMetadata: {
              type: row.type,
              source: row.source,
              authorId: row.author_id,
              isOwnContent: row.is_own_content === 1,
              parentId: row.parent_id,
              threadId: row.thread_id,
              context: row.context,
              mediaCount: row.media_count,
              metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            },
          });

          this.contentItemIdMap.set(row.id, node.id);
          migrated++;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to migrate content_item ${row.id}: ${errorMsg}`);
        }
      }

      offset += batchSize;
    }

    return migrated;
  }

  /**
   * Create links between migrated content
   */
  private async createLinks(
    onProgress?: ProgressCallback,
    errors: string[] = []
  ): Promise<number> {
    let linksMigrated = 0;

    // Create parent-child links for messages
    onProgress?.({
      phase: 'links',
      current: 0,
      total: this.messageIdMap.size,
      currentItem: 'Creating message links',
    });

    for (const [oldMsgId, newMsgId] of this.messageIdMap) {
      try {
        // Get original message to find parent
        const row = this.db.prepare(
          'SELECT parent_id FROM messages WHERE id = ?'
        ).get(oldMsgId) as { parent_id: string | null } | undefined;

        if (row?.parent_id && this.messageIdMap.has(row.parent_id)) {
          const parentNodeId = this.messageIdMap.get(row.parent_id)!;

          // Create responds-to link
          this.graphDb.createLink({
            sourceId: newMsgId,
            targetId: parentNodeId,
            type: 'responds-to',
            createdBy: 'migration',
          });

          linksMigrated++;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to create message link for ${oldMsgId}: ${errorMsg}`);
      }
    }

    // Create parent-child links for content_items
    for (const [oldItemId, newItemId] of this.contentItemIdMap) {
      try {
        const row = this.db.prepare(
          'SELECT parent_id, thread_id FROM content_items WHERE id = ?'
        ).get(oldItemId) as { parent_id: string | null; thread_id: string | null } | undefined;

        if (row?.parent_id && this.contentItemIdMap.has(row.parent_id)) {
          const parentNodeId = this.contentItemIdMap.get(row.parent_id)!;

          this.graphDb.createLink({
            sourceId: newItemId,
            targetId: parentNodeId,
            type: 'responds-to',
            createdBy: 'migration',
          });

          linksMigrated++;
        }

        // Create thread link if different from parent
        if (row?.thread_id && row.thread_id !== row?.parent_id &&
            this.contentItemIdMap.has(row.thread_id)) {
          const threadNodeId = this.contentItemIdMap.get(row.thread_id)!;

          this.graphDb.createLink({
            sourceId: newItemId,
            targetId: threadNodeId,
            type: 'child',
            createdBy: 'migration',
          });

          linksMigrated++;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to create content_item link for ${oldItemId}: ${errorMsg}`);
      }
    }

    // Migrate existing xanadu_links if present
    const xanaduExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='xanadu_links'
    `).get();

    if (xanaduExists) {
      const xanaduLinks = this.db.prepare('SELECT * FROM xanadu_links').all() as XanaduLinkRow[];

      for (const link of xanaduLinks) {
        try {
          // Try to find the nodes by URI
          const sourceNode = this.graphDb.getNodeByUri(link.source_uri);
          const targetNode = this.graphDb.getNodeByUri(link.target_uri);

          if (sourceNode && targetNode) {
            this.graphDb.createLink({
              sourceId: sourceNode.id,
              targetId: targetNode.id,
              type: this.mapXanaduLinkType(link.link_type),
              strength: link.link_strength,
              sourceAnchor: link.source_start !== null ? {
                start: link.source_start,
                end: link.source_end!,
              } : undefined,
              targetAnchor: link.target_start !== null ? {
                start: link.target_start,
                end: link.target_end!,
              } : undefined,
              createdBy: link.created_by,
              metadata: link.metadata ? JSON.parse(link.metadata) : undefined,
            });

            linksMigrated++;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to migrate xanadu_link ${link.id}: ${errorMsg}`);
        }
      }
    }

    return linksMigrated;
  }

  /**
   * Map content_items source to UCG source type
   */
  private mapContentItemSource(type: string, source: string): SourceType {
    const sourceMap: Record<string, SourceType> = {
      'facebook': 'facebook-post',
      'facebook_post': 'facebook-post',
      'facebook_comment': 'facebook-comment',
      'facebook_message': 'facebook-message',
      'facebook_photo': 'facebook-post',
      'openai': 'chatgpt',
      'claude': 'claude',
      'markdown': 'markdown',
      'text': 'text',
      'pdf': 'pdf',
    };

    return sourceMap[source] || sourceMap[type] || 'import';
  }

  /**
   * Map xanadu link type to UCG link type
   */
  private mapXanaduLinkType(xanaduType: string): LinkType {
    const typeMap: Record<string, LinkType> = {
      'parent': 'parent',
      'child': 'child',
      'reference': 'references',
      'transclusion': 'references',
      'similar': 'related-to',
      'follows': 'follows',
      'responds_to': 'responds-to',
      'version_of': 'version-of',
    };

    return typeMap[xanaduType] || 'related-to';
  }

  /**
   * Detect content format from text
   */
  private detectFormat(text: string): ContentFormat {
    if (text.includes('```') || text.includes('##') || text.includes('**')) {
      return 'markdown';
    }
    if (text.includes('<html') || text.includes('<div') || text.includes('<p>')) {
      return 'html';
    }
    return 'text';
  }

  /**
   * Check if migration has already been run
   */
  isMigrated(): boolean {
    const count = this.graphDb.getNodeCount();
    return count > 0;
  }

  /**
   * Get migration statistics without running migration
   */
  getPreMigrationStats(): {
    conversationsCount: number;
    messagesCount: number;
    contentItemsCount: number;
    existingUcgNodes: number;
  } {
    const getCount = (table: string): number => {
      try {
        const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
        return result.count;
      } catch {
        return 0;
      }
    };

    return {
      conversationsCount: getCount('conversations'),
      messagesCount: getCount('messages'),
      contentItemsCount: getCount('content_items'),
      existingUcgNodes: this.graphDb.getNodeCount(),
    };
  }
}

// Row types for existing tables
interface ConversationRow {
  id: string;
  folder: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  total_tokens: number;
  is_interesting: number;
  summary: string | null;
  metadata: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  role: string;
  content: string;
  created_at: number;
  token_count: number;
}

interface ContentItemRow {
  id: string;
  type: string;
  source: string;
  text: string | null;
  title: string | null;
  created_at: number;
  updated_at: number | null;
  author_name: string | null;
  author_id: string | null;
  is_own_content: number | null;
  parent_id: string | null;
  thread_id: string | null;
  context: string | null;
  file_path: string | null;
  media_count: number;
  metadata: string | null;
  tags: string | null;
}

interface XanaduLinkRow {
  id: string;
  source_uri: string;
  target_uri: string;
  link_type: string;
  link_strength: number;
  source_start: number | null;
  source_end: number | null;
  target_start: number | null;
  target_end: number | null;
  label: string | null;
  created_at: number;
  created_by: string;
  metadata: string | null;
}

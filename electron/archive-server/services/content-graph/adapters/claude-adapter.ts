/**
 * Claude Adapter - Parses Anthropic Claude exports into ContentNodes
 *
 * Handles the Claude export format (conversations.json with chat_messages)
 * and converts conversations and messages into universal ContentNode format.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ContentNode,
  ContentLink,
  ContentFormat,
  ContentAdapter,
  AdapterOptions,
  DetectionResult,
} from '@humanizer/core';

/**
 * Claude export format types
 */
interface ClaudeExport {
  uuid: string;
  name?: string;
  created_at: string;  // ISO 8601
  updated_at: string;
  chat_messages: ClaudeChatMessage[];
}

interface ClaudeChatMessage {
  uuid: string;
  text: string;
  sender: 'human' | 'assistant';
  created_at?: string;
  updated_at?: string;
  files?: Array<{ file_name: string; extracted_content?: string }>;
  attachments?: unknown[];
}

/**
 * Input types for Claude adapter
 */
type ClaudeInput =
  | string  // File path or directory path
  | ClaudeExport[]  // Direct array of conversations
  | Buffer;  // Raw file content

/**
 * Claude Adapter - Converts Claude exports to ContentNodes
 */
export class ClaudeAdapter implements ContentAdapter<ClaudeInput> {
  readonly id = 'claude';
  readonly name = 'Claude Conversations';
  readonly sourceType = 'claude' as const;
  readonly supportedFormats = [
    '.json',
    'application/json',
    'application/zip',
  ];
  readonly version = '1.0.0';

  /**
   * Detect if input is Claude export format
   */
  async detect(input: ClaudeInput): Promise<DetectionResult> {
    try {
      const data = await this.loadInput(input);
      if (!data) {
        return { canHandle: false, confidence: 0 };
      }

      const conversations = this.extractConversations(data);
      if (conversations.length === 0) {
        return { canHandle: false, confidence: 0 };
      }

      // Check for Claude-specific structure
      const sample = conversations[0];
      const hasUuid = sample.uuid !== undefined;
      const hasChatMessages = Array.isArray(sample.chat_messages);
      const hasClaudeSender = sample.chat_messages?.some(
        m => m.sender === 'human' || m.sender === 'assistant'
      );

      if (hasUuid && hasChatMessages && hasClaudeSender) {
        return {
          canHandle: true,
          confidence: 1.0,
          details: {
            sourceType: 'claude',
            estimatedCount: conversations.length,
          },
        };
      }

      if (hasChatMessages) {
        return {
          canHandle: true,
          confidence: 0.7,
          details: {
            sourceType: 'claude',
            estimatedCount: conversations.length,
          },
        };
      }

      return { canHandle: false, confidence: 0 };
    } catch {
      return { canHandle: false, confidence: 0 };
    }
  }

  /**
   * Parse Claude export into ContentNodes
   */
  async *parse(
    input: ClaudeInput,
    options?: AdapterOptions
  ): AsyncIterable<ContentNode> {
    const data = await this.loadInput(input);
    if (!data) {
      throw new Error('Failed to load input');
    }

    const conversations = this.extractConversations(data);
    const batchId = options?.batchId || randomUUID();

    for (const conv of conversations) {
      // Yield conversation node
      const convNode = this.conversationToNode(conv, batchId);
      yield convNode;

      // Yield message nodes
      for (let i = 0; i < conv.chat_messages.length; i++) {
        const msg = conv.chat_messages[i];
        const prevMsg = i > 0 ? conv.chat_messages[i - 1] : undefined;
        const msgNode = this.messageToNode(msg, conv, convNode.id, batchId, prevMsg?.uuid);
        yield msgNode;
      }
    }
  }

  /**
   * Extract links from a ContentNode
   */
  extractLinks(node: ContentNode, allNodes?: ContentNode[]): ContentLink[] {
    const links: ContentLink[] = [];

    // If this is a message node, link to parent conversation
    if (node.metadata.sourceMetadata?.conversationId) {
      const parentConv = allNodes?.find(
        n => n.source.originalId === node.metadata.sourceMetadata?.conversationId
      );
      if (parentConv) {
        links.push({
          id: randomUUID(),
          sourceId: node.id,
          targetId: parentConv.id,
          type: 'child',
          createdAt: Date.now(),
          createdBy: 'claude-adapter',
        });
        links.push({
          id: randomUUID(),
          sourceId: parentConv.id,
          targetId: node.id,
          type: 'parent',
          createdAt: Date.now(),
          createdBy: 'claude-adapter',
        });
      }
    }

    // If this is a message node with a previous message
    if (node.metadata.sourceMetadata?.previousMessageId) {
      const prevMsg = allNodes?.find(
        n => n.source.originalId === node.metadata.sourceMetadata?.previousMessageId
      );
      if (prevMsg) {
        links.push({
          id: randomUUID(),
          sourceId: node.id,
          targetId: prevMsg.id,
          type: 'responds-to',
          createdAt: Date.now(),
          createdBy: 'claude-adapter',
        });
        links.push({
          id: randomUUID(),
          sourceId: prevMsg.id,
          targetId: node.id,
          type: 'follows',
          createdAt: Date.now(),
          createdBy: 'claude-adapter',
        });
      }
    }

    return links;
  }

  /**
   * Load input data from various sources
   */
  private async loadInput(input: ClaudeInput): Promise<unknown> {
    // Direct data
    if (Array.isArray(input)) {
      return input;
    }

    // Buffer
    if (Buffer.isBuffer(input)) {
      return JSON.parse(input.toString('utf-8'));
    }

    // File/directory path
    if (typeof input === 'string') {
      const stat = fs.statSync(input);

      if (stat.isDirectory()) {
        // Look for conversations.json in directory
        const conversationsFile = path.join(input, 'conversations.json');
        if (fs.existsSync(conversationsFile)) {
          const content = fs.readFileSync(conversationsFile, 'utf-8');
          return JSON.parse(content);
        }
        return null;
      }

      // Single file
      const content = fs.readFileSync(input, 'utf-8');
      return JSON.parse(content);
    }

    return null;
  }

  /**
   * Extract conversations array from loaded data
   */
  private extractConversations(data: unknown): ClaudeExport[] {
    if (Array.isArray(data)) {
      return data.filter(
        item => item && typeof item === 'object' && 'chat_messages' in item
      );
    }
    if (typeof data === 'object' && data !== null && 'chat_messages' in data) {
      return [data as ClaudeExport];
    }
    return [];
  }

  /**
   * Convert a conversation to a ContentNode
   */
  private conversationToNode(conv: ClaudeExport, batchId: string): ContentNode {
    const id = randomUUID();
    const now = Date.now();

    // Extract all message text for the conversation node
    const text = conv.chat_messages
      .map(m => `[${m.sender}]: ${m.text}`)
      .join('\n\n');

    const createTime = this.parseISOTimestamp(conv.created_at);

    return {
      id,
      contentHash: '', // Will be computed by database
      uri: `content://claude/conversation/${conv.uuid}`,
      content: {
        text,
        format: 'conversation' as ContentFormat,
      },
      metadata: {
        title: conv.name || 'Untitled Claude Conversation',
        createdAt: createTime,
        importedAt: now,
        wordCount: this.countWords(text),
        tags: [],
        sourceMetadata: {
          messageCount: conv.chat_messages.length,
          updatedAt: this.parseISOTimestamp(conv.updated_at),
        },
      },
      source: {
        type: 'claude',
        adapter: this.id,
        originalId: conv.uuid,
        importBatch: batchId,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };
  }

  /**
   * Convert a message to a ContentNode
   */
  private messageToNode(
    msg: ClaudeChatMessage,
    conv: ClaudeExport,
    convNodeId: string,
    batchId: string,
    previousMsgId?: string
  ): ContentNode {
    const id = randomUUID();
    const now = Date.now();
    const createTime = msg.created_at ? this.parseISOTimestamp(msg.created_at) : now;

    // Include file contents if available
    let text = msg.text;
    if (msg.files && msg.files.length > 0) {
      const fileContents = msg.files
        .filter(f => f.extracted_content)
        .map(f => `\n\n--- File: ${f.file_name} ---\n${f.extracted_content}`)
        .join('');
      text += fileContents;
    }

    return {
      id,
      contentHash: '', // Will be computed by database
      uri: `content://claude/message/${conv.uuid}/${msg.uuid}`,
      content: {
        text,
        format: this.detectFormat(text),
      },
      metadata: {
        author: msg.sender,
        createdAt: createTime,
        importedAt: now,
        wordCount: this.countWords(text),
        tags: [],
        sourceMetadata: {
          sender: msg.sender,
          conversationId: conv.uuid,
          conversationTitle: conv.name,
          previousMessageId: previousMsgId,
          hasFiles: msg.files && msg.files.length > 0,
          fileNames: msg.files?.map(f => f.file_name),
          hasAttachments: msg.attachments && msg.attachments.length > 0,
        },
      },
      source: {
        type: 'claude',
        adapter: this.id,
        originalId: msg.uuid,
        originalPath: `${conv.uuid}/${msg.uuid}`,
        importBatch: batchId,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };
  }

  /**
   * Parse ISO 8601 timestamp to milliseconds
   */
  private parseISOTimestamp(isoString: string): number {
    try {
      return new Date(isoString).getTime();
    } catch {
      return Date.now();
    }
  }

  /**
   * Detect content format from text
   */
  private detectFormat(text: string): ContentFormat {
    // Check if content looks like markdown
    if (text.includes('```') || text.includes('##') || text.includes('**')) {
      return 'markdown';
    }

    // Check for code indicators
    if (text.includes('function ') || text.includes('const ') || text.includes('import ')) {
      return 'code';
    }

    return 'text';
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }
}

/**
 * Factory function for adapter registration
 */
export function createClaudeAdapter(): ClaudeAdapter {
  return new ClaudeAdapter();
}

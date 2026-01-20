/**
 * ChatGPT Adapter - Parses OpenAI ChatGPT exports into ContentNodes
 *
 * Handles the OpenAI export format (conversations.json) and converts
 * conversations and messages into universal ContentNode format.
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
  ParseResult,
  ParseError,
} from '@humanizer/core';

/**
 * OpenAI conversation format types
 */
interface OpenAIConversation {
  id?: string;
  conversation_id?: string;
  title?: string;
  create_time?: number;
  update_time?: number;
  mapping?: Record<string, OpenAIMappingNode>;
  current_node?: string;
  gizmo_id?: string | null;
  default_model_slug?: string;
}

interface OpenAIMappingNode {
  id: string;
  parent?: string | null;
  children: string[];
  message?: OpenAIMessage | null;
}

interface OpenAIMessage {
  id: string;
  author?: {
    role: 'user' | 'assistant' | 'system' | 'tool';
    name?: string;
    metadata?: Record<string, unknown>;
  };
  create_time?: number | null;
  update_time?: number | null;
  content?: {
    content_type: string;
    parts?: (string | Record<string, unknown>)[];
    text?: string;
  };
  status?: string;
  metadata?: Record<string, unknown>;
  recipient?: string;
  weight?: number;
  end_turn?: boolean;
}

/**
 * Input types for ChatGPT adapter
 */
type ChatGPTInput =
  | string  // File path or directory path
  | OpenAIConversation[]  // Direct array of conversations
  | { conversations: OpenAIConversation[] }  // Object with conversations array
  | Buffer;  // Raw file content

/**
 * ChatGPT Adapter - Converts OpenAI exports to ContentNodes
 */
export class ChatGPTAdapter implements ContentAdapter<ChatGPTInput> {
  readonly id = 'chatgpt';
  readonly name = 'ChatGPT Conversations';
  readonly sourceType = 'chatgpt' as const;
  readonly supportedFormats = [
    '.json',
    'application/json',
    'application/zip',
  ];
  readonly version = '1.0.0';

  /**
   * Detect if input is ChatGPT export format
   */
  async detect(input: ChatGPTInput): Promise<DetectionResult> {
    try {
      const data = await this.loadInput(input);
      if (!data) {
        return { canHandle: false, confidence: 0 };
      }

      const conversations = this.extractConversations(data);
      if (conversations.length === 0) {
        return { canHandle: false, confidence: 0 };
      }

      // Check for OpenAI-specific structure
      const sample = conversations[0];
      const hasMapping = sample.mapping !== undefined;
      const hasCreateTime = sample.create_time !== undefined;
      const hasConversationId = sample.conversation_id !== undefined || sample.id !== undefined;

      if (hasMapping) {
        return {
          canHandle: true,
          confidence: 1.0,
          details: {
            sourceType: 'chatgpt',
            estimatedCount: conversations.length,
            formatVersion: sample.default_model_slug || undefined,
          },
        };
      }

      if (hasCreateTime && hasConversationId) {
        return {
          canHandle: true,
          confidence: 0.8,
          details: {
            sourceType: 'chatgpt',
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
   * Parse ChatGPT export into ContentNodes
   */
  async *parse(
    input: ChatGPTInput,
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
      if (conv.mapping) {
        const messages = this.extractMessages(conv.mapping);
        for (const msg of messages) {
          const msgNode = this.messageToNode(msg, conv, convNode.id, batchId);
          if (msgNode) {
            yield msgNode;
          }
        }
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
          createdBy: 'chatgpt-adapter',
        });
        links.push({
          id: randomUUID(),
          sourceId: parentConv.id,
          targetId: node.id,
          type: 'parent',
          createdAt: Date.now(),
          createdBy: 'chatgpt-adapter',
        });
      }
    }

    // If this is a message node with a parent message
    if (node.metadata.sourceMetadata?.parentMessageId) {
      const parentMsg = allNodes?.find(
        n => n.source.originalId === node.metadata.sourceMetadata?.parentMessageId
      );
      if (parentMsg) {
        links.push({
          id: randomUUID(),
          sourceId: node.id,
          targetId: parentMsg.id,
          type: 'responds-to',
          createdAt: Date.now(),
          createdBy: 'chatgpt-adapter',
        });
      }
    }

    return links;
  }

  /**
   * Load input data from various sources
   */
  private async loadInput(input: ChatGPTInput): Promise<unknown> {
    // Direct data
    if (Array.isArray(input)) {
      return input;
    }
    if (typeof input === 'object' && input !== null && 'conversations' in input) {
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
  private extractConversations(data: unknown): OpenAIConversation[] {
    if (Array.isArray(data)) {
      return data;
    }
    if (typeof data === 'object' && data !== null) {
      if ('conversations' in data && Array.isArray((data as Record<string, unknown>).conversations)) {
        return (data as Record<string, unknown>).conversations as OpenAIConversation[];
      }
      // Single conversation
      if ('mapping' in data || 'create_time' in data) {
        return [data as OpenAIConversation];
      }
    }
    return [];
  }

  /**
   * Convert a conversation to a ContentNode
   */
  private conversationToNode(conv: OpenAIConversation, batchId: string): ContentNode {
    const id = randomUUID();
    const convId = conv.conversation_id || conv.id || randomUUID();
    const now = Date.now();

    // Extract all message text for the conversation node
    const messages = conv.mapping ? this.extractMessages(conv.mapping) : [];
    const text = messages
      .map(m => `[${m.author?.role || 'unknown'}]: ${this.extractMessageText(m)}`)
      .join('\n\n');

    const createTime = conv.create_time
      ? (conv.create_time > 1e12 ? conv.create_time : conv.create_time * 1000)
      : now;

    return {
      id,
      contentHash: '', // Will be computed by database
      uri: `content://chatgpt/conversation/${convId}`,
      content: {
        text,
        format: 'conversation' as ContentFormat,
      },
      metadata: {
        title: conv.title || 'Untitled Conversation',
        createdAt: createTime,
        importedAt: now,
        wordCount: this.countWords(text),
        tags: [],
        sourceMetadata: {
          messageCount: messages.length,
          model: conv.default_model_slug || undefined,
          gizmoId: conv.gizmo_id || undefined,
        },
      },
      source: {
        type: 'chatgpt',
        adapter: this.id,
        originalId: convId,
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
    msg: OpenAIMessage,
    conv: OpenAIConversation,
    convNodeId: string,
    batchId: string
  ): ContentNode | null {
    const text = this.extractMessageText(msg);
    if (!text.trim()) {
      return null;
    }

    const id = randomUUID();
    const msgId = msg.id || randomUUID();
    const convId = conv.conversation_id || conv.id || '';
    const now = Date.now();

    const createTime = msg.create_time
      ? (msg.create_time > 1e12 ? msg.create_time : msg.create_time * 1000)
      : now;

    // Find parent message ID from mapping
    let parentMessageId: string | undefined;
    if (conv.mapping) {
      for (const [nodeId, node] of Object.entries(conv.mapping)) {
        if (node.message?.id === msg.id && node.parent) {
          const parentNode = conv.mapping[node.parent];
          if (parentNode?.message?.id) {
            parentMessageId = parentNode.message.id;
          }
          break;
        }
      }
    }

    return {
      id,
      contentHash: '', // Will be computed by database
      uri: `content://chatgpt/message/${convId}/${msgId}`,
      content: {
        text,
        format: this.detectFormat(msg),
      },
      metadata: {
        author: msg.author?.role || 'unknown',
        createdAt: createTime,
        importedAt: now,
        wordCount: this.countWords(text),
        tags: [],
        sourceMetadata: {
          role: msg.author?.role,
          authorName: msg.author?.name,
          conversationId: convId,
          conversationTitle: conv.title,
          parentMessageId,
          status: msg.status,
          metadata: msg.metadata,
        },
      },
      source: {
        type: 'chatgpt',
        adapter: this.id,
        originalId: msgId,
        originalPath: `${convId}/${msgId}`,
        importBatch: batchId,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };
  }

  /**
   * Extract ordered messages from mapping
   */
  private extractMessages(mapping: Record<string, OpenAIMappingNode>): OpenAIMessage[] {
    const messages: OpenAIMessage[] = [];
    const visited = new Set<string>();

    // Find root node (no parent)
    let rootId: string | undefined;
    for (const [nodeId, node] of Object.entries(mapping)) {
      if (!node.parent) {
        rootId = nodeId;
        break;
      }
    }

    if (!rootId) {
      return messages;
    }

    // Walk the tree (follow first child path)
    const walk = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = mapping[nodeId];
      if (!node) return;

      if (node.message && node.message.content) {
        messages.push(node.message);
      }

      // Follow children
      for (const childId of node.children) {
        walk(childId);
      }
    };

    walk(rootId);
    return messages;
  }

  /**
   * Extract text from message content, including inline images as markdown
   */
  private extractMessageText(msg: OpenAIMessage): string {
    if (!msg.content) {
      return '';
    }

    if (msg.content.text) {
      return msg.content.text;
    }

    if (msg.content.parts) {
      return msg.content.parts
        .map(part => {
          if (typeof part === 'string') {
            return part;
          }
          if (typeof part === 'object' && part !== null) {
            const partObj = part as Record<string, unknown>;

            // Handle image_asset_pointer - convert to markdown image
            if (partObj.content_type === 'image_asset_pointer' && partObj.asset_pointer) {
              const pointer = partObj.asset_pointer as string;
              // Convert sediment://file_XXX to file-service://file-XXX format
              // that can be resolved by the media endpoint
              const fileServiceUrl = pointer
                .replace('sediment://file_', 'file-service://file-')
                .replace('sediment://', 'file-service://');
              return `\n\n![image](${fileServiceUrl})\n\n`;
            }

            // Handle objects with text property (code blocks, etc.)
            if ('text' in partObj) {
              return (partObj as { text: string }).text;
            }
          }
          return '';
        })
        .join('\n');
    }

    return '';
  }

  /**
   * Detect content format from message
   */
  private detectFormat(msg: OpenAIMessage): ContentFormat {
    if (!msg.content) {
      return 'text';
    }

    const contentType = msg.content.content_type;
    if (contentType === 'code') {
      return 'code';
    }
    if (contentType === 'multimodal_text') {
      return 'markdown';
    }

    // Check if content looks like markdown
    const text = this.extractMessageText(msg);
    if (text.includes('```') || text.includes('##') || text.includes('**')) {
      return 'markdown';
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
export function createChatGPTAdapter(): ChatGPTAdapter {
  return new ChatGPTAdapter();
}

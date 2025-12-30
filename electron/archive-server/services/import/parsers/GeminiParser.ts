/**
 * GeminiParser - Parse Google Gemini conversation exports
 *
 * Handles both single conversation.json files and folders containing them.
 *
 * Gemini Format:
 * {
 *   "title": "...",
 *   "source": "Gemini",
 *   "messages": [
 *     {
 *       "id": "msg_0",
 *       "role": "user" | "model",
 *       "content": { "parts": [{ "text": "..." }] },
 *       "timestamp": 1766274482277
 *     }
 *   ]
 * }
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  ContentParser,
  ParseResult,
  ContentUnit,
  MediaRef,
  ContentLink,
} from '../ImportPipeline.js';
import type { ImportSourceType } from '../../embeddings/types.js';

interface GeminiMessage {
  id: string;
  role: 'user' | 'model';
  content: {
    parts: Array<{ text?: string; image?: unknown }>;
  };
  timestamp?: number;
}

interface GeminiConversation {
  title?: string;
  source?: string;
  messages: GeminiMessage[];
}

export interface GeminiParserOptions {
  verbose?: boolean;
}

export class GeminiParser implements ContentParser {
  name = 'gemini';
  private verbose: boolean;

  constructor(options: GeminiParserOptions = {}) {
    this.verbose = options.verbose ?? false;
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(`[GeminiParser] ${message}`);
    }
  }

  /**
   * Check if this parser can handle the source
   */
  async canParse(sourcePath: string): Promise<boolean> {
    const ext = path.extname(sourcePath).toLowerCase();

    // Handle .json files
    if (ext === '.json') {
      try {
        const content = await fs.readFile(sourcePath, 'utf-8');
        const data = JSON.parse(content);

        // Check for Gemini format markers
        if (data.source === 'Gemini') return true;
        if (data.messages && Array.isArray(data.messages)) {
          const firstMsg = data.messages[0];
          if (firstMsg?.content?.parts) return true;
          if (firstMsg?.role === 'model') return true;
        }
        return false;
      } catch {
        return false;
      }
    }

    // Handle folders containing conversation.json
    try {
      const stat = await fs.stat(sourcePath);
      if (stat.isDirectory()) {
        const files = await fs.readdir(sourcePath);
        if (files.includes('conversation.json')) {
          const jsonPath = path.join(sourcePath, 'conversation.json');
          return this.canParse(jsonPath);
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  /**
   * Parse Gemini conversation(s)
   */
  async parse(sourcePath: string, _sourceType: ImportSourceType): Promise<ParseResult> {
    const units: ContentUnit[] = [];
    const mediaRefs: MediaRef[] = [];
    const links: ContentLink[] = [];
    const errors: string[] = [];

    const stat = await fs.stat(sourcePath);
    let jsonPath = sourcePath;

    // If it's a directory, look for conversation.json
    if (stat.isDirectory()) {
      jsonPath = path.join(sourcePath, 'conversation.json');
    }

    this.log(`Parsing: ${jsonPath}`);

    try {
      const content = await fs.readFile(jsonPath, 'utf-8');
      const conversation: GeminiConversation = JSON.parse(content);

      // Generate conversation ID
      const conversationId = uuidv4();
      const conversationUri = `content://gemini/conversation/${conversationId}`;

      // Create conversation ContentUnit
      const conversationUnit: ContentUnit = {
        id: conversationId,
        uri: conversationUri,
        unitType: 'conversation',
        contentType: 'text',
        content: conversation.title || path.basename(sourcePath),
        wordCount: 0,
        charCount: 0,
        authorRole: 'system',
        createdAt: conversation.messages[0]?.timestamp || Date.now(),
        metadata: {
          originalSource: conversation.source,
          messageCount: conversation.messages.length,
          title: conversation.title,
        },
      };
      units.push(conversationUnit);

      this.log(`Processing conversation: "${conversation.title}" with ${conversation.messages.length} messages`);

      // Process messages
      let previousMessageUri: string | null = null;

      for (const msg of conversation.messages) {
        const messageId = msg.id || uuidv4();
        const messageUri = `content://gemini/message/${messageId}`;

        // Extract text from parts
        const textParts = msg.content.parts
          .filter(p => p.text)
          .map(p => p.text!)
          .join('\n');

        // Map role: "model" -> "assistant"
        const authorRole = msg.role === 'model' ? 'assistant' : msg.role;

        const messageUnit: ContentUnit = {
          id: messageId,
          uri: messageUri,
          unitType: 'message',
          contentType: 'text',
          content: textParts || '',
          wordCount: textParts ? textParts.split(/\s+/).length : 0,
          charCount: textParts ? textParts.length : 0,
          parentUri: conversationUri,
          authorRole: authorRole as 'user' | 'assistant' | 'system',
          createdAt: msg.timestamp || Date.now(),
          metadata: {
            conversationId,
            originalRole: msg.role,
          },
        };
        units.push(messageUnit);

        // Create parent link (message -> conversation)
        links.push({
          sourceUri: messageUri,
          targetUri: conversationUri,
          linkType: 'parent',
        });

        // Create sequence link (message -> previous message)
        if (previousMessageUri) {
          links.push({
            sourceUri: messageUri,
            targetUri: previousMessageUri,
            linkType: 'follows',
          });
        }

        // Check for media in parts
        for (let i = 0; i < msg.content.parts.length; i++) {
          const part = msg.content.parts[i];
          if (part.image) {
            const mediaRef: MediaRef = {
              contentUnitId: messageId,
              sourcePath: 'gemini-image-placeholder',
              originalPointer: 'gemini-image',
              referenceType: 'embed',
              position: i,
            };
            mediaRefs.push(mediaRef);
          }
        }

        previousMessageUri = messageUri;
      }

      this.log(`Parsed ${units.length} units, ${mediaRefs.length} media refs, ${links.length} links`);

    } catch (err) {
      errors.push(`Failed to parse ${jsonPath}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { units, mediaRefs, links, errors };
  }
}

export function createGeminiParser(options?: GeminiParserOptions): GeminiParser {
  return new GeminiParser(options);
}

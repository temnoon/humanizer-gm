/**
 * Text Adapter - Parses plain text files into ContentNodes
 *
 * Handles plain text files (.txt, .text) with basic metadata extraction.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ContentNode,
  ContentFormat,
  ContentAdapter,
  AdapterOptions,
  DetectionResult,
} from '@humanizer/core';

/**
 * Input types for Text adapter
 */
type TextInput =
  | string  // File path or raw text content
  | Buffer;  // Raw file content

/**
 * Text Adapter - Converts plain text files to ContentNodes
 */
export class TextAdapter implements ContentAdapter<TextInput> {
  readonly id = 'text';
  readonly name = 'Plain Text Files';
  readonly sourceType = 'text' as const;
  readonly supportedFormats = [
    '.txt',
    '.text',
    'text/plain',
  ];
  readonly version = '1.0.0';

  /**
   * Detect if input is plain text format
   */
  async detect(input: TextInput): Promise<DetectionResult> {
    try {
      // Check file extension
      if (typeof input === 'string' && this.isFilePath(input)) {
        const ext = path.extname(input).toLowerCase();
        if (this.supportedFormats.includes(ext)) {
          return {
            canHandle: true,
            confidence: 1.0,
            details: {
              sourceType: 'text',
            },
          };
        }
      }

      // Check content - plain text is the fallback
      const content = this.loadContent(input);
      if (content) {
        // If it's not JSON, XML, or binary, treat as plain text
        const looksLikeJson = content.trim().startsWith('{') || content.trim().startsWith('[');
        const looksLikeXml = content.trim().startsWith('<?xml') || content.trim().startsWith('<');
        const hasBinaryChars = /[\x00-\x08\x0E-\x1F]/.test(content.slice(0, 1000));

        if (!looksLikeJson && !looksLikeXml && !hasBinaryChars) {
          return {
            canHandle: true,
            confidence: 0.5,  // Lower confidence as fallback
            details: {
              sourceType: 'text',
            },
          };
        }
      }

      return { canHandle: false, confidence: 0 };
    } catch {
      return { canHandle: false, confidence: 0 };
    }
  }

  /**
   * Parse text into ContentNodes
   */
  async *parse(
    input: TextInput,
    options?: AdapterOptions
  ): AsyncIterable<ContentNode> {
    const content = this.loadContent(input);
    if (!content) {
      throw new Error('Failed to load input');
    }

    const batchId = options?.batchId || randomUUID();
    const filePath = typeof input === 'string' && this.isFilePath(input) ? input : undefined;

    // Create node
    const node = this.contentToNode(content, filePath, batchId);
    yield node;
  }

  /**
   * Render a ContentNode back to plain text
   */
  render(node: ContentNode): string {
    return node.content.text;
  }

  /**
   * Load content from input
   */
  private loadContent(input: TextInput): string | null {
    if (Buffer.isBuffer(input)) {
      return input.toString('utf-8');
    }

    if (typeof input === 'string') {
      if (this.isFilePath(input)) {
        try {
          return fs.readFileSync(input, 'utf-8');
        } catch {
          return null;
        }
      }
      // Assume raw text content
      return input;
    }

    return null;
  }

  /**
   * Check if string is a file path
   */
  private isFilePath(str: string): boolean {
    try {
      return fs.existsSync(str);
    } catch {
      return false;
    }
  }

  /**
   * Convert text content to ContentNode
   */
  private contentToNode(
    content: string,
    filePath: string | undefined,
    batchId: string
  ): ContentNode {
    const id = randomUUID();
    const now = Date.now();

    // Try to extract title from first line
    const lines = content.split('\n');
    let title: string | undefined;

    // Use first non-empty line as potential title
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        // Only use if it's reasonably short (like a title)
        if (trimmed.length <= 100) {
          title = trimmed;
        }
        break;
      }
    }

    // Fall back to filename
    if (!title && filePath) {
      title = path.basename(filePath, path.extname(filePath));
    }

    // Try to get file stats for creation time
    let createdAt = now;
    if (filePath) {
      try {
        const stats = fs.statSync(filePath);
        createdAt = stats.birthtime.getTime();
      } catch {
        // Ignore errors
      }
    }

    return {
      id,
      contentHash: '', // Will be computed by database
      uri: `content://text/${filePath ? path.basename(filePath) : id}`,
      content: {
        text: content,
        format: 'text' as ContentFormat,
      },
      metadata: {
        title,
        createdAt,
        importedAt: now,
        wordCount: this.countWords(content),
        tags: [],
        sourceMetadata: {
          lineCount: lines.length,
          charCount: content.length,
        },
      },
      source: {
        type: 'text',
        adapter: this.id,
        originalPath: filePath,
        importBatch: batchId,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };
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
export function createTextAdapter(): TextAdapter {
  return new TextAdapter();
}

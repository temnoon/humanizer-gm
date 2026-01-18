/**
 * Markdown Adapter - Parses Markdown files into ContentNodes
 *
 * Handles markdown files (.md, .markdown) with optional YAML frontmatter.
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
 * Input types for Markdown adapter
 */
type MarkdownInput =
  | string  // File path or raw markdown content
  | Buffer;  // Raw file content

/**
 * Parsed frontmatter metadata
 */
interface FrontmatterMeta {
  title?: string;
  author?: string;
  date?: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Markdown Adapter - Converts Markdown files to ContentNodes
 */
export class MarkdownAdapter implements ContentAdapter<MarkdownInput> {
  readonly id = 'markdown';
  readonly name = 'Markdown Files';
  readonly sourceType = 'markdown' as const;
  readonly supportedFormats = [
    '.md',
    '.markdown',
    '.mdown',
    '.mkd',
    'text/markdown',
    'text/x-markdown',
  ];
  readonly version = '1.0.0';

  /**
   * Detect if input is Markdown format
   */
  async detect(input: MarkdownInput): Promise<DetectionResult> {
    try {
      // Check file extension
      if (typeof input === 'string' && this.isFilePath(input)) {
        const ext = path.extname(input).toLowerCase();
        if (this.supportedFormats.includes(ext)) {
          return {
            canHandle: true,
            confidence: 1.0,
            details: {
              sourceType: 'markdown',
            },
          };
        }
      }

      // Check content
      const content = this.loadContent(input);
      if (!content) {
        return { canHandle: false, confidence: 0 };
      }

      // Check for markdown indicators
      const hasMarkdownIndicators = this.hasMarkdownIndicators(content);
      if (hasMarkdownIndicators) {
        return {
          canHandle: true,
          confidence: 0.8,
          details: {
            sourceType: 'markdown',
          },
        };
      }

      return { canHandle: false, confidence: 0 };
    } catch {
      return { canHandle: false, confidence: 0 };
    }
  }

  /**
   * Parse Markdown into ContentNodes
   */
  async *parse(
    input: MarkdownInput,
    options?: AdapterOptions
  ): AsyncIterable<ContentNode> {
    const content = this.loadContent(input);
    if (!content) {
      throw new Error('Failed to load input');
    }

    const batchId = options?.batchId || randomUUID();
    const filePath = typeof input === 'string' && this.isFilePath(input) ? input : undefined;

    // Parse frontmatter
    const { frontmatter, body } = this.parseFrontmatter(content);

    // Create node
    const node = this.contentToNode(body, frontmatter, filePath, batchId);
    yield node;
  }

  /**
   * Render a ContentNode back to Markdown
   */
  render(node: ContentNode): string {
    let markdown = '';

    // Add frontmatter if metadata exists
    const meta = node.metadata;
    if (meta.title || meta.author || meta.tags.length > 0) {
      markdown += '---\n';
      if (meta.title) markdown += `title: "${meta.title}"\n`;
      if (meta.author) markdown += `author: "${meta.author}"\n`;
      if (meta.tags.length > 0) {
        markdown += `tags:\n${meta.tags.map(t => `  - ${t}`).join('\n')}\n`;
      }
      markdown += '---\n\n';
    }

    // Add content
    markdown += node.content.rendered || node.content.text;

    return markdown;
  }

  /**
   * Extract links from a Markdown ContentNode
   */
  extractLinks(node: ContentNode, allNodes?: ContentNode[]): ContentLink[] {
    const links: ContentLink[] = [];
    const text = node.content.text;

    // Find markdown links: [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = linkRegex.exec(text)) !== null) {
      const [fullMatch, linkText, url] = match;

      // Check if URL is a local file reference
      if (!url.startsWith('http') && !url.startsWith('#')) {
        const targetNode = allNodes?.find(n =>
          n.source.originalPath?.endsWith(url) ||
          n.metadata.title === linkText
        );

        if (targetNode) {
          links.push({
            id: randomUUID(),
            sourceId: node.id,
            targetId: targetNode.id,
            type: 'references',
            sourceAnchor: {
              start: match.index,
              end: match.index + fullMatch.length,
              text: linkText,
            },
            createdAt: Date.now(),
            createdBy: 'markdown-adapter',
          });
        }
      }
    }

    return links;
  }

  /**
   * Load content from input
   */
  private loadContent(input: MarkdownInput): string | null {
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
      // Assume raw markdown content
      return input;
    }

    return null;
  }

  /**
   * Check if string is a file path
   */
  private isFilePath(str: string): boolean {
    // Check if it looks like a path and exists
    try {
      return fs.existsSync(str);
    } catch {
      return false;
    }
  }

  /**
   * Check for markdown indicators in content
   */
  private hasMarkdownIndicators(content: string): boolean {
    const indicators = [
      /^#+ /m,                    // Headers
      /^\* /m,                    // Unordered list
      /^- /m,                     // Unordered list (dash)
      /^\d+\. /m,                 // Ordered list
      /```/,                      // Code blocks
      /\*\*[^*]+\*\*/,           // Bold
      /\*[^*]+\*/,               // Italic
      /\[.+\]\(.+\)/,            // Links
      /!\[.+\]\(.+\)/,           // Images
      /^>/m,                      // Blockquotes
      /^---$/m,                   // Horizontal rule
      /^___$/m,                   // Horizontal rule
    ];

    return indicators.some(regex => regex.test(content));
  }

  /**
   * Parse YAML frontmatter from markdown content
   */
  private parseFrontmatter(content: string): { frontmatter: FrontmatterMeta; body: string } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { frontmatter: {}, body: content };
    }

    const yamlContent = match[1];
    const body = content.slice(match[0].length);

    // Simple YAML parsing (handles basic key: value pairs)
    const frontmatter: FrontmatterMeta = {};
    const lines = yamlContent.split('\n');
    let currentKey: string | null = null;
    let currentArray: string[] | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for array item
      if (trimmed.startsWith('- ') && currentKey) {
        if (!currentArray) {
          currentArray = [];
          frontmatter[currentKey] = currentArray;
        }
        currentArray.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ''));
        continue;
      }

      // Reset array context
      currentArray = null;

      // Parse key: value
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        currentKey = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        if (value) {
          frontmatter[currentKey] = value.replace(/^["']|["']$/g, '');
        }
      }
    }

    return { frontmatter, body };
  }

  /**
   * Convert markdown content to ContentNode
   */
  private contentToNode(
    content: string,
    frontmatter: FrontmatterMeta,
    filePath: string | undefined,
    batchId: string
  ): ContentNode {
    const id = randomUUID();
    const now = Date.now();

    // Extract plain text (strip markdown formatting)
    const plainText = this.stripMarkdown(content);

    // Determine title from frontmatter or first heading or filename
    let title = frontmatter.title;
    if (!title) {
      const headingMatch = content.match(/^#+ (.+)$/m);
      if (headingMatch) {
        title = headingMatch[1];
      } else if (filePath) {
        title = path.basename(filePath, path.extname(filePath));
      }
    }

    // Parse date from frontmatter
    let createdAt = now;
    if (frontmatter.date) {
      const parsed = new Date(frontmatter.date);
      if (!isNaN(parsed.getTime())) {
        createdAt = parsed.getTime();
      }
    }

    // Convert tags
    let tags: string[] = [];
    if (frontmatter.tags) {
      tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
    }

    return {
      id,
      contentHash: '', // Will be computed by database
      uri: `content://markdown/${filePath ? path.basename(filePath) : id}`,
      content: {
        text: plainText,
        format: 'markdown' as ContentFormat,
        rendered: content,
      },
      metadata: {
        title,
        author: frontmatter.author,
        createdAt,
        importedAt: now,
        wordCount: this.countWords(plainText),
        tags,
        sourceMetadata: {
          frontmatter,
          hasCodeBlocks: content.includes('```'),
          hasImages: /!\[.+\]\(.+\)/.test(content),
        },
      },
      source: {
        type: 'markdown',
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
   * Strip markdown formatting from text
   */
  private stripMarkdown(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, '')        // Code blocks
      .replace(/`[^`]+`/g, '')               // Inline code
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')  // Images
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // Links (keep text)
      .replace(/^#{1,6}\s+/gm, '')           // Headers
      .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')  // Formatting
      .replace(/^\s*[-*+]\s+/gm, '')         // Unordered lists
      .replace(/^\s*\d+\.\s+/gm, '')         // Ordered lists
      .replace(/^\s*>/gm, '')                // Blockquotes
      .replace(/^---+$/gm, '')               // Horizontal rules
      .replace(/\n{3,}/g, '\n\n')            // Multiple newlines
      .trim();
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
export function createMarkdownAdapter(): MarkdownAdapter {
  return new MarkdownAdapter();
}

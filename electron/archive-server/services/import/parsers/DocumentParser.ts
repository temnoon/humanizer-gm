/**
 * DocumentParser - Parse plain text and markdown documents
 *
 * Handles:
 * - .txt files - Plain text, paragraph splitting
 * - .md files - Markdown with frontmatter extraction
 *
 * Produces a single document ContentUnit with optional passages.
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
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

/**
 * Frontmatter extracted from markdown files
 */
interface Frontmatter {
  title?: string;
  author?: string;
  date?: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Passage - a section of a document (for chunking)
 */
interface Passage {
  content: string;
  type: 'heading' | 'paragraph' | 'code' | 'list' | 'blockquote';
  level?: number;
  startOffset: number;
  endOffset: number;
}

export class DocumentParser implements ContentParser {
  private verbose: boolean;
  private chunkByHeadings: boolean;
  private minPassageWords: number;

  constructor(options: {
    verbose?: boolean;
    chunkByHeadings?: boolean;
    minPassageWords?: number;
  } = {}) {
    this.verbose = options.verbose ?? false;
    this.chunkByHeadings = options.chunkByHeadings ?? true;
    this.minPassageWords = options.minPassageWords ?? 50;
  }

  private log(...args: unknown[]): void {
    if (this.verbose) {
      console.log('[DocumentParser]', ...args);
    }
  }

  /**
   * Check if this parser can handle the source
   */
  async canParse(sourcePath: string): Promise<boolean> {
    const ext = path.extname(sourcePath).toLowerCase();
    return ext === '.txt' || ext === '.md' || ext === '.markdown';
  }

  /**
   * Parse a document file
   */
  async parse(sourcePath: string, sourceType: ImportSourceType): Promise<ParseResult> {
    const units: ContentUnit[] = [];
    const mediaRefs: MediaRef[] = [];
    const links: ContentLink[] = [];
    const errors: string[] = [];

    if (!existsSync(sourcePath)) {
      errors.push(`File not found: ${sourcePath}`);
      return { units, mediaRefs, links, errors };
    }

    try {
      const content = await fs.readFile(sourcePath, 'utf-8');
      const ext = path.extname(sourcePath).toLowerCase();
      const filename = path.basename(sourcePath);

      // Extract frontmatter for markdown files
      let frontmatter: Frontmatter = {};
      let bodyContent = content;

      if (ext === '.md' || ext === '.markdown') {
        const extracted = this.extractFrontmatter(content);
        frontmatter = extracted.frontmatter;
        bodyContent = extracted.body;
      }

      // Generate document URI
      const docId = uuidv4();
      const docUri = `content://${sourceType}/document/${docId}`;

      // Calculate document stats
      const wordCount = bodyContent.split(/\s+/).filter(Boolean).length;

      // Create document ContentUnit
      const docUnit: ContentUnit = {
        id: docId,
        uri: docUri,
        unitType: 'document',
        contentType: ext === '.md' || ext === '.markdown' ? 'markdown' : 'text',
        content: bodyContent,
        wordCount,
        charCount: bodyContent.length,
        createdAt: Date.now(),
        isOwnContent: true, // Assume user's own document
        authorName: frontmatter.author,
        metadata: {
          filename,
          title: frontmatter.title ?? this.inferTitle(bodyContent, filename),
          ...frontmatter,
        },
      };

      units.push(docUnit);

      // Extract passages if chunking is enabled
      if (this.chunkByHeadings && (ext === '.md' || ext === '.markdown')) {
        const passages = this.extractPassages(bodyContent);

        for (let i = 0; i < passages.length; i++) {
          const passage = passages[i];
          const passageId = uuidv4();
          const passageUri = `content://${sourceType}/passage/${passageId}`;

          const passageUnit: ContentUnit = {
            id: passageId,
            uri: passageUri,
            unitType: 'passage',
            contentType: 'markdown',
            content: passage.content,
            wordCount: passage.content.split(/\s+/).filter(Boolean).length,
            charCount: passage.content.length,
            parentUri: docUri,
            position: i,
            isOwnContent: true,
            metadata: {
              passageType: passage.type,
              level: passage.level,
              startOffset: passage.startOffset,
              endOffset: passage.endOffset,
            },
          };

          // Only add passages that meet minimum word count
          if (passageUnit.wordCount >= this.minPassageWords) {
            units.push(passageUnit);

            // Create parent link
            links.push({
              sourceUri: passageUri,
              targetUri: docUri,
              linkType: 'parent',
            });

            // Create sequence link
            if (i > 0 && units.length > 2) {
              const prevPassage = units[units.length - 2];
              links.push({
                sourceUri: passageUri,
                targetUri: prevPassage.uri,
                linkType: 'follows',
              });
            }
          }
        }
      }

      // Extract media references from markdown images
      if (ext === '.md' || ext === '.markdown') {
        const imageRefs = this.extractMarkdownImages(bodyContent, docId, sourcePath);
        mediaRefs.push(...imageRefs);
      }

      this.log(`Parsed document: ${filename}, ${wordCount} words, ${units.length} units`);

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Error parsing ${sourcePath}: ${errorMsg}`);
    }

    return { units, mediaRefs, links, errors };
  }

  /**
   * Extract YAML frontmatter from markdown content
   */
  private extractFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { frontmatter: {}, body: content };
    }

    const frontmatterText = match[1];
    const body = content.slice(match[0].length);

    // Simple YAML parsing (key: value)
    const frontmatter: Frontmatter = {};

    for (const line of frontmatterText.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim();
      let value: unknown = line.slice(colonIndex + 1).trim();

      // Remove quotes
      if (typeof value === 'string' &&
          ((value.startsWith('"') && value.endsWith('"')) ||
           (value.startsWith("'") && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }

      // Parse arrays [a, b, c]
      if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(s => s.trim());
      }

      frontmatter[key] = value;
    }

    return { frontmatter, body };
  }

  /**
   * Infer title from content or filename
   */
  private inferTitle(content: string, filename: string): string {
    // Try to find first heading
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }

    // Fall back to filename without extension
    return path.basename(filename, path.extname(filename));
  }

  /**
   * Extract passages from markdown content
   */
  private extractPassages(content: string): Passage[] {
    const passages: Passage[] = [];
    const lines = content.split('\n');

    let currentPassage: Passage | null = null;
    let currentOffset = 0;

    for (const line of lines) {
      const lineLength = line.length + 1; // +1 for newline

      // Check for heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        // Save current passage
        if (currentPassage && currentPassage.content.trim()) {
          currentPassage.endOffset = currentOffset;
          passages.push(currentPassage);
        }

        // Start new passage with heading
        currentPassage = {
          content: line,
          type: 'heading',
          level: headingMatch[1].length,
          startOffset: currentOffset,
          endOffset: currentOffset,
        };
      }
      // Check for code block
      else if (line.startsWith('```')) {
        if (currentPassage) {
          currentPassage.content += '\n' + line;
          if (currentPassage.type !== 'code') {
            currentPassage.type = 'code';
          }
        }
      }
      // Check for blockquote
      else if (line.startsWith('>')) {
        if (currentPassage) {
          currentPassage.content += '\n' + line;
          if (currentPassage.type === 'heading' || currentPassage.type === 'paragraph') {
            currentPassage.type = 'blockquote';
          }
        }
      }
      // Check for list item
      else if (line.match(/^[-*+]\s+/) || line.match(/^\d+\.\s+/)) {
        if (currentPassage) {
          currentPassage.content += '\n' + line;
          if (currentPassage.type === 'heading' || currentPassage.type === 'paragraph') {
            currentPassage.type = 'list';
          }
        }
      }
      // Regular paragraph content
      else {
        if (currentPassage) {
          currentPassage.content += '\n' + line;
        } else {
          currentPassage = {
            content: line,
            type: 'paragraph',
            startOffset: currentOffset,
            endOffset: currentOffset,
          };
        }
      }

      currentOffset += lineLength;
    }

    // Save final passage
    if (currentPassage && currentPassage.content.trim()) {
      currentPassage.endOffset = currentOffset;
      passages.push(currentPassage);
    }

    return passages;
  }

  /**
   * Extract markdown image references
   */
  private extractMarkdownImages(
    content: string,
    docId: string,
    sourcePath: string
  ): MediaRef[] {
    const refs: MediaRef[] = [];
    const docDir = path.dirname(sourcePath);

    // Match ![alt](path) and ![alt](path "title")
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;

    while ((match = imageRegex.exec(content)) !== null) {
      const altText = match[1];
      const imagePath = match[2].split(' ')[0].replace(/["']/g, '');

      // Resolve relative paths
      const absolutePath = path.isAbsolute(imagePath)
        ? imagePath
        : path.resolve(docDir, imagePath);

      if (existsSync(absolutePath)) {
        refs.push({
          contentUnitId: docId,
          sourcePath: absolutePath,
          referenceType: 'embed',
          caption: altText || undefined,
        });
      }
    }

    return refs;
  }
}

/**
 * Create a DocumentParser instance
 */
export function createDocumentParser(options: {
  verbose?: boolean;
  chunkByHeadings?: boolean;
  minPassageWords?: number;
} = {}): DocumentParser {
  return new DocumentParser(options);
}

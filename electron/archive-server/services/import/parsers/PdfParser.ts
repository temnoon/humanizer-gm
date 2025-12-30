/**
 * PdfParser - Extract text from PDF documents
 *
 * Converts PDF files to ContentUnits for the import pipeline.
 * Uses pdf-parse for text extraction.
 *
 * Produces:
 * - One document-level ContentUnit with full text
 * - URI format: content://local/document/{uuid}
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pdfParse from 'pdf-parse';

import type {
  ContentParser,
  ParseResult,
  ContentUnit,
  ContentLink,
} from '../ImportPipeline.js';
import type { ImportSourceType } from '../../embeddings/types.js';

/**
 * PDF metadata extracted from the document
 */
interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
  pageCount: number;
}

export class PdfParser implements ContentParser {
  private verbose: boolean;

  constructor(options: { verbose?: boolean } = {}) {
    this.verbose = options.verbose ?? false;
  }

  private log(...args: unknown[]): void {
    if (this.verbose) {
      console.log('[PdfParser]', ...args);
    }
  }

  /**
   * Check if this parser can handle the source file
   */
  async canParse(sourcePath: string): Promise<boolean> {
    const ext = path.extname(sourcePath).toLowerCase();
    return ext === '.pdf';
  }

  /**
   * Parse a PDF file into ContentUnits
   */
  async parse(sourcePath: string, _sourceType: ImportSourceType): Promise<ParseResult> {
    const units: ContentUnit[] = [];
    const links: ContentLink[] = [];
    const errors: string[] = [];

    try {
      this.log('Parsing PDF:', sourcePath);

      // Read the PDF file
      const buffer = await fs.readFile(sourcePath);

      // Extract text and metadata
      const data = await pdfParse(buffer);

      // Extract metadata
      const metadata = this.extractMetadata(data, sourcePath);
      this.log('Extracted metadata:', metadata);

      // Generate stable URI
      const docId = uuidv4();
      const docUri = `content://local/document/${docId}`;

      // Clean and normalize text
      const cleanedText = this.cleanText(data.text);
      const wordCount = cleanedText.split(/\s+/).filter(Boolean).length;

      // Create document ContentUnit
      const docUnit: ContentUnit = {
        id: docId,
        uri: docUri,
        unitType: 'document',
        contentType: 'text',
        content: cleanedText,
        wordCount,
        charCount: cleanedText.length,
        createdAt: metadata.creationDate?.getTime() ?? Date.now(),
        updatedAt: metadata.modificationDate?.getTime(),
        authorName: metadata.author,
        isOwnContent: false, // PDFs are typically external documents
        metadata: {
          title: metadata.title || path.basename(sourcePath, '.pdf'),
          pageCount: metadata.pageCount,
          author: metadata.author,
          subject: metadata.subject,
          keywords: metadata.keywords,
          creator: metadata.creator,
          producer: metadata.producer,
          originalPath: sourcePath,
          mimeType: 'application/pdf',
        },
      };

      units.push(docUnit);
      this.log(`Created document unit with ${wordCount} words, ${metadata.pageCount} pages`);

      // Optionally split into page-level chunks
      // This could be enhanced to parse page breaks from the PDF
      // For now, we create a single document unit

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to parse PDF ${sourcePath}: ${errorMsg}`);
      console.error('[PdfParser] Error:', errorMsg);
    }

    return { units, mediaRefs: [], links, errors };
  }

  /**
   * Extract metadata from PDF parse result
   */
  private extractMetadata(data: Awaited<ReturnType<typeof pdfParse>>, sourcePath: string): PdfMetadata {
    const info = data.info || {};

    return {
      title: info.Title || path.basename(sourcePath, '.pdf'),
      author: info.Author,
      subject: info.Subject,
      keywords: (info as Record<string, unknown>).Keywords as string | undefined,
      creator: info.Creator,
      producer: info.Producer,
      creationDate: info.CreationDate ? new Date(info.CreationDate) : undefined,
      modificationDate: info.ModDate ? new Date(info.ModDate) : undefined,
      pageCount: data.numpages || 1,
    };
  }

  /**
   * Clean and normalize extracted text
   */
  private cleanText(text: string): string {
    return text
      // Normalize line endings
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Remove excessive whitespace
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      // Trim
      .trim();
  }
}

/**
 * Create a PdfParser instance
 */
export function createPdfParser(options: { verbose?: boolean } = {}): PdfParser {
  return new PdfParser(options);
}

/**
 * PDF Extraction Handler
 *
 * Extracts text content from PDF files using pdf-parse.
 * Falls back to basic extraction if pdf-parse is not available.
 */

import * as fs from 'fs';
import type { PdfExtractionResult } from '../types';

// Try to load pdf-parse dynamically
let pdfParse: ((buffer: Buffer) => Promise<{
  text: string;
  numpages: number;
  info?: {
    Title?: string;
    Author?: string;
    Subject?: string;
    Creator?: string;
    CreationDate?: string;
  };
}>) | null = null;

let pdfParseChecked = false;

async function loadPdfParse(): Promise<boolean> {
  if (pdfParseChecked) return pdfParse !== null;
  pdfParseChecked = true;

  try {
    const module = await import('pdf-parse');
    pdfParse = module.default || module;
    console.log('[PDF Handler] pdf-parse loaded successfully');
    return true;
  } catch (err) {
    console.log('[PDF Handler] pdf-parse not available:', (err as Error).message);
    return false;
  }
}

/**
 * Check if PDF extraction is available
 */
export async function isPdfExtractionAvailable(): Promise<boolean> {
  return loadPdfParse();
}

/**
 * Extract text and metadata from a PDF file
 */
export async function extractPdf(
  filePath: string,
  _options?: Record<string, unknown>
): Promise<PdfExtractionResult> {
  // Verify file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF file not found: ${filePath}`);
  }

  // Load pdf-parse if not already loaded
  const available = await loadPdfParse();
  if (!available || !pdfParse) {
    throw new Error(
      'pdf-parse not installed. Run: npm install pdf-parse'
    );
  }

  // Read the PDF file
  const buffer = await fs.promises.readFile(filePath);

  // Parse PDF
  const result = await pdfParse(buffer);

  // Count words in extracted text
  const wordCount = result.text
    .split(/\s+/)
    .filter(word => word.length > 0).length;

  return {
    text: result.text,
    pageCount: result.numpages,
    metadata: result.info ? {
      title: result.info.Title,
      author: result.info.Author,
      subject: result.info.Subject,
      creator: result.info.Creator,
      creationDate: result.info.CreationDate,
    } : undefined,
    wordCount,
  };
}

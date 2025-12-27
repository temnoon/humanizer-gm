/**
 * File Content Readers
 *
 * Extract text content from various file formats.
 * Designed to work in browser environment with File System Access API.
 */

import type { DocumentFormat, FileCategory } from './types';

// ============================================
// Format Detection
// ============================================

const EXTENSION_MAP: Record<string, { category: FileCategory; format?: DocumentFormat }> = {
  // Documents
  txt: { category: 'document', format: 'plaintext' },
  text: { category: 'document', format: 'plaintext' },
  md: { category: 'document', format: 'markdown' },
  mdx: { category: 'document', format: 'markdown' },
  markdown: { category: 'document', format: 'markdown' },
  doc: { category: 'document', format: 'word' },
  docx: { category: 'document', format: 'word' },
  pdf: { category: 'document', format: 'pdf' },
  rtf: { category: 'document', format: 'rtf' },
  html: { category: 'document', format: 'html' },
  htm: { category: 'document', format: 'html' },

  // Data
  json: { category: 'data', format: 'json' },
  csv: { category: 'data' },
  xml: { category: 'data' },
  yaml: { category: 'data' },
  yml: { category: 'data' },
  toml: { category: 'data' },

  // Code
  js: { category: 'code' },
  jsx: { category: 'code' },
  ts: { category: 'code' },
  tsx: { category: 'code' },
  py: { category: 'code' },
  rb: { category: 'code' },
  rs: { category: 'code' },
  go: { category: 'code' },
  java: { category: 'code' },
  c: { category: 'code' },
  cpp: { category: 'code' },
  h: { category: 'code' },
  hpp: { category: 'code' },
  css: { category: 'code' },
  scss: { category: 'code' },
  less: { category: 'code' },
  sql: { category: 'code' },
  sh: { category: 'code' },
  bash: { category: 'code' },
  zsh: { category: 'code' },

  // Images
  jpg: { category: 'image' },
  jpeg: { category: 'image' },
  png: { category: 'image' },
  gif: { category: 'image' },
  webp: { category: 'image' },
  svg: { category: 'image' },
  bmp: { category: 'image' },
  ico: { category: 'image' },
  heic: { category: 'image' },
  heif: { category: 'image' },

  // Video
  mp4: { category: 'video' },
  mov: { category: 'video' },
  webm: { category: 'video' },
  avi: { category: 'video' },
  mkv: { category: 'video' },
  m4v: { category: 'video' },

  // Audio
  mp3: { category: 'audio' },
  wav: { category: 'audio' },
  m4a: { category: 'audio' },
  ogg: { category: 'audio' },
  flac: { category: 'audio' },
  aac: { category: 'audio' },

  // Archives
  zip: { category: 'archive' },
  tar: { category: 'archive' },
  gz: { category: 'archive' },
  rar: { category: 'archive' },
  '7z': { category: 'archive' },
};

/**
 * Get category and format from file extension
 */
export function classifyFile(filename: string): { category: FileCategory; format?: DocumentFormat } {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MAP[ext] ?? { category: 'unknown' };
}

/**
 * Check if file content can be extracted
 */
export function isExtractable(category: FileCategory, format?: DocumentFormat): boolean {
  if (category === 'document') {
    return format !== undefined && ['plaintext', 'markdown', 'html', 'json'].includes(format);
    // Note: word and pdf require additional libraries
  }
  if (category === 'code' || category === 'data') {
    return true; // All code/data files are plain text
  }
  return false;
}

// ============================================
// Text Extraction
// ============================================

/**
 * Read file as text using File System Access API
 */
export async function readFileAsText(
  fileHandle: FileSystemFileHandle
): Promise<string> {
  const file = await fileHandle.getFile();
  return file.text();
}

/**
 * Read file as array buffer
 */
export async function readFileAsBuffer(
  fileHandle: FileSystemFileHandle
): Promise<ArrayBuffer> {
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

/**
 * Extract text content from a file
 */
export async function extractContent(
  fileHandle: FileSystemFileHandle,
  format: DocumentFormat
): Promise<{ content: string; wordCount: number; charCount: number }> {
  let content: string;

  switch (format) {
    case 'plaintext':
    case 'markdown':
    case 'json':
      content = await readFileAsText(fileHandle);
      break;

    case 'html':
      content = await extractFromHtml(fileHandle);
      break;

    case 'word':
      // Word documents need mammoth.js or similar
      // For now, return placeholder
      content = '[Word document - content extraction not yet implemented]';
      break;

    case 'pdf':
      // PDFs need pdf.js or similar
      content = '[PDF document - content extraction not yet implemented]';
      break;

    case 'rtf':
      content = '[RTF document - content extraction not yet implemented]';
      break;

    default:
      content = '';
  }

  // Calculate stats
  const charCount = content.length;
  const wordCount = content
    .split(/\s+/)
    .filter((word) => word.length > 0).length;

  return { content, wordCount, charCount };
}

/**
 * Extract text from HTML file
 */
async function extractFromHtml(fileHandle: FileSystemFileHandle): Promise<string> {
  const html = await readFileAsText(fileHandle);

  // Create a temporary DOM to extract text
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Remove script and style elements
  const scripts = doc.querySelectorAll('script, style, noscript');
  scripts.forEach((el) => el.remove());

  // Get text content
  return doc.body?.textContent?.trim() ?? '';
}

/**
 * Generate preview from content
 */
export function generatePreview(content: string, maxLength: number = 500): string {
  if (content.length <= maxLength) {
    return content;
  }

  // Try to cut at a word boundary
  const truncated = content.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.8) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}

// ============================================
// MIME Types
// ============================================

const MIME_MAP: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  json: 'application/json',
  xml: 'application/xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  zip: 'application/zip',
};

/**
 * Get MIME type from extension
 */
export function getMimeType(extension: string): string {
  return MIME_MAP[extension.toLowerCase()] ?? 'application/octet-stream';
}

// ============================================
// File Statistics
// ============================================

/**
 * Get file metadata without reading full content
 */
export async function getFileMetadata(
  fileHandle: FileSystemFileHandle
): Promise<{
  name: string;
  size: number;
  lastModified: number;
  type: string;
}> {
  const file = await fileHandle.getFile();
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    type: file.type || getMimeType(file.name.split('.').pop() ?? ''),
  };
}

/**
 * FileTypeDetector - Universal file type detection
 *
 * Detects file types for the import pipeline:
 * - MIME type from extension and magic bytes
 * - Archive format detection (OpenAI, Claude, Facebook)
 * - Document type detection
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, createReadStream } from 'fs';
import AdmZip from 'adm-zip';
import type { ImportSourceType } from '../../embeddings/types.js';

/**
 * Detection result
 */
export interface DetectionResult {
  sourceType: ImportSourceType;
  mimeType: string;
  confidence: 'high' | 'medium' | 'low';
  details?: Record<string, unknown>;
}

/**
 * Magic byte signatures for common file types
 */
const MAGIC_SIGNATURES: Array<{
  bytes: number[];
  mimeType: string;
  sourceType?: ImportSourceType;
}> = [
  // ZIP (and derivatives like docx, odt)
  { bytes: [0x50, 0x4B, 0x03, 0x04], mimeType: 'application/zip' },

  // PDF
  { bytes: [0x25, 0x50, 0x44, 0x46], mimeType: 'application/pdf', sourceType: 'pdf' },

  // PNG
  { bytes: [0x89, 0x50, 0x4E, 0x47], mimeType: 'image/png' },

  // JPEG
  { bytes: [0xFF, 0xD8, 0xFF], mimeType: 'image/jpeg' },

  // GIF
  { bytes: [0x47, 0x49, 0x46, 0x38], mimeType: 'image/gif' },

  // WebP
  { bytes: [0x52, 0x49, 0x46, 0x46], mimeType: 'image/webp' }, // RIFF header
];

/**
 * Extension to source type mapping
 */
const EXTENSION_MAP: Record<string, { sourceType: ImportSourceType; mimeType: string }> = {
  '.txt': { sourceType: 'txt', mimeType: 'text/plain' },
  '.md': { sourceType: 'md', mimeType: 'text/markdown' },
  '.markdown': { sourceType: 'md', mimeType: 'text/markdown' },
  '.docx': { sourceType: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.doc': { sourceType: 'docx', mimeType: 'application/msword' },
  '.pdf': { sourceType: 'pdf', mimeType: 'application/pdf' },
  '.odt': { sourceType: 'odt', mimeType: 'application/vnd.oasis.opendocument.text' },
  '.zip': { sourceType: 'zip', mimeType: 'application/zip' },
  '.json': { sourceType: 'txt', mimeType: 'application/json' },
};

export class FileTypeDetector {
  /**
   * Detect file type from path
   */
  async detect(filePath: string): Promise<DetectionResult> {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();

    // Check extension mapping first
    const extMapping = EXTENSION_MAP[ext];
    if (extMapping && ext !== '.zip') {
      return {
        sourceType: extMapping.sourceType,
        mimeType: extMapping.mimeType,
        confidence: 'high',
      };
    }

    // For ZIP files, inspect contents to determine actual type
    if (ext === '.zip') {
      return this.detectZipType(filePath);
    }

    // Try magic byte detection
    const magicResult = await this.detectFromMagicBytes(filePath);
    if (magicResult) {
      // If it's a ZIP based on magic bytes, inspect further
      if (magicResult.mimeType === 'application/zip') {
        return this.detectZipType(filePath);
      }
      return magicResult;
    }

    // Fallback: try to read as text
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Check if it's JSON
      try {
        const data = JSON.parse(content);

        // Check for Gemini conversation format
        if (this.isGeminiConversation(data)) {
          return {
            sourceType: 'gemini' as ImportSourceType,
            mimeType: 'application/json',
            confidence: 'high',
            details: { format: 'gemini-conversation' },
          };
        }

        // Check for OpenAI single conversation format
        if (this.isOpenAISingleConversation(data)) {
          return {
            sourceType: 'openai',
            mimeType: 'application/json',
            confidence: 'high',
            details: { format: 'openai-single-conversation' },
          };
        }

        // Check for generic conversation format (array of messages)
        if (this.isGenericConversation(data)) {
          return {
            sourceType: 'conversation' as ImportSourceType,
            mimeType: 'application/json',
            confidence: 'medium',
            details: { format: 'generic-conversation' },
          };
        }

        // Unknown JSON
        return {
          sourceType: 'txt',
          mimeType: 'application/json',
          confidence: 'low',
        };
      } catch {
        // Not JSON, treat as plain text
      }

      return {
        sourceType: 'txt',
        mimeType: 'text/plain',
        confidence: 'low',
      };
    } catch {
      // Binary file we can't identify
      return {
        sourceType: 'zip',
        mimeType: 'application/octet-stream',
        confidence: 'low',
      };
    }
  }

  /**
   * Check if JSON is a Gemini conversation
   */
  private isGeminiConversation(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;

    const obj = data as Record<string, unknown>;

    // Check for explicit Gemini source
    if (obj.source === 'Gemini') return true;

    // Check for Gemini message structure
    if (Array.isArray(obj.messages)) {
      const msgs = obj.messages as unknown[];
      if (msgs.length > 0) {
        const firstMsg = msgs[0] as Record<string, unknown>;
        // Gemini messages have content.parts structure
        if (firstMsg?.content && typeof firstMsg.content === 'object') {
          const content = firstMsg.content as Record<string, unknown>;
          if (Array.isArray(content.parts)) return true;
        }
        // Also check for "model" role (Gemini uses "model" instead of "assistant")
        if (firstMsg?.role === 'model') return true;
      }
    }

    return false;
  }

  /**
   * Check if JSON is an OpenAI single conversation
   */
  private isOpenAISingleConversation(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;

    const obj = data as Record<string, unknown>;

    // OpenAI conversations have a 'mapping' object with message DAG
    if (obj.mapping && typeof obj.mapping === 'object') {
      return true;
    }

    return false;
  }

  /**
   * Check if JSON looks like a generic conversation
   */
  private isGenericConversation(data: unknown): boolean {
    // Array of objects with role/content
    if (Array.isArray(data)) {
      if (data.length > 0) {
        const first = data[0] as Record<string, unknown>;
        if (first && ('role' in first || 'content' in first || 'text' in first)) {
          return true;
        }
      }
    }

    // Object with messages array
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.messages)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detect from magic bytes
   */
  private async detectFromMagicBytes(filePath: string): Promise<DetectionResult | null> {
    const buffer = Buffer.alloc(16);
    const fd = await fs.open(filePath, 'r');

    try {
      await fd.read(buffer, 0, 16, 0);
    } finally {
      await fd.close();
    }

    for (const sig of MAGIC_SIGNATURES) {
      const matches = sig.bytes.every((byte, i) => buffer[i] === byte);
      if (matches) {
        return {
          sourceType: sig.sourceType ?? 'zip',
          mimeType: sig.mimeType,
          confidence: 'high',
        };
      }
    }

    return null;
  }

  /**
   * Detect the type of a ZIP archive by inspecting contents
   */
  async detectZipType(zipPath: string): Promise<DetectionResult> {
    try {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();
      const entryNames = entries.map(e => e.entryName.toLowerCase());

      // Check for OpenAI ChatGPT export
      if (this.hasOpenAISignature(entryNames)) {
        return {
          sourceType: 'openai',
          mimeType: 'application/zip',
          confidence: 'high',
          details: { format: 'openai-chatgpt-export' },
        };
      }

      // Check for Claude export
      if (this.hasClaudeSignature(entryNames, zip)) {
        return {
          sourceType: 'claude',
          mimeType: 'application/zip',
          confidence: 'high',
          details: { format: 'claude-export' },
        };
      }

      // Check for Facebook export
      if (this.hasFacebookSignature(entryNames)) {
        return {
          sourceType: 'facebook',
          mimeType: 'application/zip',
          confidence: 'high',
          details: { format: 'facebook-export' },
        };
      }

      // Check for DOCX (Office Open XML)
      if (entryNames.includes('[content_types].xml') || entryNames.some(n => n.startsWith('word/'))) {
        return {
          sourceType: 'docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          confidence: 'high',
        };
      }

      // Check for ODT
      if (entryNames.includes('mimetype') || entryNames.includes('content.xml')) {
        // Read mimetype file to confirm
        const mimetypeEntry = zip.getEntry('mimetype');
        if (mimetypeEntry) {
          const mimeContent = mimetypeEntry.getData().toString('utf-8').trim();
          if (mimeContent.includes('opendocument.text')) {
            return {
              sourceType: 'odt',
              mimeType: 'application/vnd.oasis.opendocument.text',
              confidence: 'high',
            };
          }
        }
      }

      // Generic ZIP
      return {
        sourceType: 'zip',
        mimeType: 'application/zip',
        confidence: 'medium',
      };

    } catch (err) {
      // Couldn't read as ZIP
      return {
        sourceType: 'zip',
        mimeType: 'application/zip',
        confidence: 'low',
        details: { error: String(err) },
      };
    }
  }

  /**
   * Check for OpenAI ChatGPT export signature
   */
  private hasOpenAISignature(entryNames: string[]): boolean {
    // OpenAI exports have conversations.json at root or nested
    // They also have a specific mapping structure with conversation IDs
    return entryNames.some(n =>
      n === 'conversations.json' ||
      n.endsWith('/conversations.json') ||
      // Alternative: folder structure with conversation folders
      n.includes('conversation') && n.endsWith('.json')
    );
  }

  /**
   * Check for Claude export signature
   */
  private hasClaudeSignature(entryNames: string[], zip: AdmZip): boolean {
    // Claude exports have conversations.json AND users.json
    const hasConversations = entryNames.some(n =>
      n === 'conversations.json' || n.endsWith('/conversations.json')
    );
    const hasUsers = entryNames.some(n =>
      n === 'users.json' || n.endsWith('/users.json')
    );

    if (hasConversations && hasUsers) {
      return true;
    }

    // Alternatively, check for Claude-specific structure in conversations.json
    if (hasConversations) {
      try {
        const convEntry = zip.getEntry('conversations.json');
        if (convEntry) {
          const content = convEntry.getData().toString('utf-8');
          const data = JSON.parse(content);

          // Claude conversations have a different structure than OpenAI
          // They have 'uuid', 'name', 'chat_messages' instead of 'mapping'
          if (Array.isArray(data) && data.length > 0) {
            const first = data[0];
            if ('uuid' in first && 'chat_messages' in first) {
              return true;
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    return false;
  }

  /**
   * Check for Facebook export signature
   */
  private hasFacebookSignature(entryNames: string[]): boolean {
    // Facebook exports have specific folder structure
    const fbFolders = [
      'messages/',
      'posts/',
      'photos_and_videos/',
      'your_activity_across_facebook/',
      'about_you/',
      'comments_and_reactions/',
    ];

    const matchCount = fbFolders.filter(folder =>
      entryNames.some(n => n.startsWith(folder) || n.includes(`/${folder}`))
    ).length;

    // If we match multiple Facebook-specific folders, it's likely a Facebook export
    return matchCount >= 2;
  }

  /**
   * Get a human-readable description of the detected type
   */
  getTypeDescription(result: DetectionResult): string {
    switch (result.sourceType) {
      case 'openai':
        return 'OpenAI ChatGPT Export';
      case 'claude':
        return 'Claude Export';
      case 'facebook':
        return 'Facebook Data Export';
      case 'txt':
        return 'Plain Text';
      case 'md':
        return 'Markdown Document';
      case 'docx':
        return 'Microsoft Word Document';
      case 'pdf':
        return 'PDF Document';
      case 'odt':
        return 'OpenDocument Text';
      case 'zip':
        return 'ZIP Archive';
      default:
        return 'Unknown';
    }
  }
}

/**
 * Create a FileTypeDetector instance
 */
export function createFileTypeDetector(): FileTypeDetector {
  return new FileTypeDetector();
}

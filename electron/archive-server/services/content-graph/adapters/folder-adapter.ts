/**
 * Folder Adapter - Recursively imports documents from a directory
 *
 * Scans directories, detects file types, and routes through appropriate adapters
 * (markdown, text, etc.) to create ContentNodes.
 *
 * Features:
 * - Recursive directory scanning
 * - Auto-detection of file types via extension
 * - Folder structure tracking via links
 * - Progress reporting
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

// Import other adapters for delegation
import { MarkdownAdapter } from './markdown-adapter.js';
import { TextAdapter } from './text-adapter.js';

// ============================================================================
// Types
// ============================================================================

interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  mtime: number;
  isDirectory: boolean;
  parentPath?: string;
}

interface FolderNode {
  id: string;
  path: string;
  name: string;
  children: string[]; // child node IDs
}

// Input types for Folder adapter
type FolderInput =
  | string  // Directory path
  | { folderPath: string; recursive?: boolean; extensions?: string[] };

// ============================================================================
// Folder Adapter Implementation
// ============================================================================

export class FolderAdapter implements ContentAdapter<FolderInput> {
  readonly id = 'folder';
  readonly name = 'Local Folder Import';
  readonly sourceType = 'file' as const;
  readonly supportedFormats = [
    'directory',
    'folder',
  ];
  readonly version = '1.0.0';

  // Supported file extensions (lowercase, with dot)
  private readonly supportedExtensions = new Set([
    '.md', '.markdown',
    '.txt', '.text',
    '.json',
    '.html', '.htm',
    '.rst', '.adoc',
    '.org',
    '.tex', '.latex',
    '.csv',
  ]);

  // Delegate adapters
  private markdownAdapter = new MarkdownAdapter();
  private textAdapter = new TextAdapter();

  /**
   * Detect if input is a valid directory
   */
  async detect(input: FolderInput): Promise<DetectionResult> {
    try {
      const folderPath = this.getFolderPath(input);
      if (!folderPath || !fs.existsSync(folderPath)) {
        return { canHandle: false, confidence: 0 };
      }

      const stat = fs.statSync(folderPath);
      if (!stat.isDirectory()) {
        return { canHandle: false, confidence: 0 };
      }

      // Count supported files
      const files = this.scanDirectory(folderPath, true);
      const supportedFiles = files.filter(f => !f.isDirectory && this.isSupported(f.extension));

      if (supportedFiles.length === 0) {
        return {
          canHandle: true,
          confidence: 0.3,
          details: {
            sourceType: 'file',
            estimatedCount: 0,
            warnings: ['No supported files found in directory'],
          },
        };
      }

      return {
        canHandle: true,
        confidence: 0.9,
        details: {
          sourceType: 'file',
          estimatedCount: supportedFiles.length,
        },
      };
    } catch {
      return { canHandle: false, confidence: 0 };
    }
  }

  /**
   * Parse folder contents into ContentNodes
   */
  async *parse(
    input: FolderInput,
    options?: AdapterOptions
  ): AsyncIterable<ContentNode> {
    const folderPath = this.getFolderPath(input);
    if (!folderPath) {
      throw new Error('Invalid folder path');
    }

    const recursive = typeof input === 'object' ? input.recursive !== false : true;
    const allowedExtensions = typeof input === 'object' && input.extensions
      ? new Set(input.extensions.map(e => e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))
      : this.supportedExtensions;

    const batchId = options?.batchId || randomUUID();

    // Scan directory
    const files = this.scanDirectory(folderPath, recursive);

    // Track folder structure
    const folderNodes = new Map<string, FolderNode>();

    // Create root folder node
    const rootFolderId = randomUUID();
    const rootFolderName = path.basename(folderPath);
    folderNodes.set(folderPath, {
      id: rootFolderId,
      path: folderPath,
      name: rootFolderName,
      children: [],
    });

    // Yield root folder as a ContentNode
    yield this.createFolderNode(rootFolderId, folderPath, rootFolderName, batchId, true);

    // Process files
    for (const file of files) {
      if (file.isDirectory) {
        // Create folder node
        const folderId = randomUUID();
        folderNodes.set(file.path, {
          id: folderId,
          path: file.path,
          name: file.name,
          children: [],
        });

        // Add to parent's children
        const parentPath = path.dirname(file.path);
        const parentFolder = folderNodes.get(parentPath);
        if (parentFolder) {
          parentFolder.children.push(folderId);
        }

        yield this.createFolderNode(folderId, file.path, file.name, batchId, false, parentFolder?.id);
        continue;
      }

      // Skip unsupported files
      if (!this.isSupported(file.extension, allowedExtensions)) {
        continue;
      }

      // Get parent folder
      const parentPath = path.dirname(file.path);
      const parentFolder = folderNodes.get(parentPath);

      // Parse file based on extension
      const contentNode = await this.parseFile(file, batchId, parentFolder?.id);
      if (contentNode) {
        // Add to parent's children
        if (parentFolder) {
          parentFolder.children.push(contentNode.id);
        }
        yield contentNode;
      }
    }
  }

  /**
   * Extract links from a ContentNode
   */
  extractLinks(node: ContentNode, allNodes?: ContentNode[]): ContentLink[] {
    const links: ContentLink[] = [];

    // Link files to their parent folder
    if (node.metadata.sourceMetadata?.parentFolderId) {
      const parentId = node.metadata.sourceMetadata.parentFolderId as string;
      const parentNode = allNodes?.find(n => n.id === parentId);

      if (parentNode) {
        links.push({
          id: randomUUID(),
          sourceId: node.id,
          targetId: parentNode.id,
          type: 'child',
          createdAt: Date.now(),
          createdBy: 'folder-adapter',
        });
        links.push({
          id: randomUUID(),
          sourceId: parentNode.id,
          targetId: node.id,
          type: 'parent',
          createdAt: Date.now(),
          createdBy: 'folder-adapter',
        });
      }
    }

    return links;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private getFolderPath(input: FolderInput): string | null {
    if (typeof input === 'string') {
      return input;
    }
    if (typeof input === 'object' && input !== null && 'folderPath' in input) {
      return input.folderPath;
    }
    return null;
  }

  private isSupported(extension: string, allowedSet = this.supportedExtensions): boolean {
    const ext = extension.toLowerCase();
    return allowedSet.has(ext) || allowedSet.has(`.${ext}`);
  }

  private scanDirectory(dirPath: string, recursive: boolean): FileInfo[] {
    const results: FileInfo[] = [];

    const scan = (currentPath: string, parentPath?: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentPath, { withFileTypes: true });
      } catch (err) {
        console.warn(`[FolderAdapter] Cannot read directory ${currentPath}:`, err);
        return;
      }

      for (const entry of entries) {
        // Skip hidden files and directories
        if (entry.name.startsWith('.')) continue;
        // Skip node_modules and other common non-content directories
        if (['node_modules', '__pycache__', 'venv', '.git', 'dist', 'build'].includes(entry.name)) continue;

        const fullPath = path.join(currentPath, entry.name);

        try {
          const stat = fs.statSync(fullPath);
          const extension = path.extname(entry.name);

          results.push({
            path: fullPath,
            name: entry.name,
            extension,
            size: stat.size,
            mtime: stat.mtimeMs,
            isDirectory: entry.isDirectory(),
            parentPath,
          });

          if (entry.isDirectory() && recursive) {
            scan(fullPath, currentPath);
          }
        } catch (err) {
          console.warn(`[FolderAdapter] Cannot stat ${fullPath}:`, err);
        }
      }
    };

    scan(dirPath);

    // Sort: directories first, then files alphabetically
    results.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });

    return results;
  }

  private createFolderNode(
    id: string,
    folderPath: string,
    name: string,
    batchId: string,
    isRoot: boolean,
    parentFolderId?: string
  ): ContentNode {
    return {
      id,
      contentHash: '',
      uri: `content://file/folder/${encodeURIComponent(folderPath)}`,
      content: {
        text: `Folder: ${name}`,
        format: 'text' as ContentFormat,
      },
      metadata: {
        title: name,
        createdAt: Date.now(),
        importedAt: Date.now(),
        wordCount: 0,
        tags: ['folder'],
        sourceMetadata: {
          isFolder: true,
          isRoot,
          parentFolderId,
        },
      },
      source: {
        type: 'file',
        adapter: this.id,
        originalId: folderPath,
        originalPath: folderPath,
        importBatch: batchId,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };
  }

  private async parseFile(
    file: FileInfo,
    batchId: string,
    parentFolderId?: string
  ): Promise<ContentNode | null> {
    try {
      const content = fs.readFileSync(file.path, 'utf-8');
      if (!content.trim()) return null;

      const ext = file.extension.toLowerCase();
      const nodeId = randomUUID();

      // Determine format and source type based on extension
      let format: ContentFormat = 'text';
      let sourceType: 'markdown' | 'text' | 'html' | 'file' = 'file';

      if (['.md', '.markdown'].includes(ext)) {
        format = 'markdown';
        sourceType = 'markdown';
      } else if (['.html', '.htm'].includes(ext)) {
        format = 'html';
        sourceType = 'html';
      } else if (['.json'].includes(ext)) {
        format = 'json';
      } else if (['.tex', '.latex'].includes(ext)) {
        format = 'latex';
      } else {
        format = 'text';
        sourceType = 'text';
      }

      // Extract title from content or use filename
      const title = this.extractTitle(content, ext) || file.name;

      const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

      return {
        id: nodeId,
        contentHash: '',
        uri: `content://${sourceType}/${encodeURIComponent(file.path)}`,
        content: {
          text: content,
          format,
        },
        metadata: {
          title,
          createdAt: file.mtime,
          importedAt: Date.now(),
          wordCount,
          tags: [],
          sourceMetadata: {
            filename: file.name,
            extension: file.extension,
            size: file.size,
            parentFolderId,
          },
        },
        source: {
          type: sourceType,
          adapter: this.id,
          originalId: file.path,
          originalPath: file.path,
          importBatch: batchId,
        },
        version: {
          number: 1,
          rootId: nodeId,
        },
      };
    } catch (err) {
      console.warn(`[FolderAdapter] Failed to parse ${file.path}:`, err);
      return null;
    }
  }

  private extractTitle(content: string, extension: string): string | null {
    const ext = extension.toLowerCase();

    if (['.md', '.markdown'].includes(ext)) {
      // Look for first H1 heading
      const h1Match = content.match(/^#\s+(.+)$/m);
      if (h1Match) return h1Match[1].trim();

      // Look for underlined heading
      const underlineMatch = content.match(/^(.+)\n={3,}$/m);
      if (underlineMatch) return underlineMatch[1].trim();
    }

    if (['.html', '.htm'].includes(ext)) {
      // Look for <title> or <h1>
      const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) return titleMatch[1].trim();

      const h1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (h1Match) return h1Match[1].trim();
    }

    // For other files, take first non-empty line (up to 100 chars)
    const firstLine = content.split('\n').find(line => line.trim().length > 0);
    if (firstLine && firstLine.length <= 100) {
      return firstLine.trim();
    }

    return null;
  }
}

/**
 * Factory function for adapter registration
 */
export function createFolderAdapter(): FolderAdapter {
  return new FolderAdapter();
}

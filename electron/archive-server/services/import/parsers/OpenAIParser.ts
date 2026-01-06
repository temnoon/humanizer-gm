/**
 * OpenAIParser - Parse ChatGPT export archives
 *
 * Handles the OpenAI export format which contains:
 * - conversations.json - Array of conversation objects with mapping tree
 * - Media files with various naming patterns
 *
 * The mapping tree is a DAG where each node has:
 * - id: Node ID
 * - parent: Parent node ID (null for root)
 * - children: Array of child node IDs
 * - message: The actual message content (can be null for root)
 *
 * Media references appear in several forms:
 * - asset_pointer: sediment://file_{hash} or file-service://file-{ID}
 * - attachments: Array in message metadata
 * - DALL-E metadata: In content parts
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import AdmZip from 'adm-zip';

import type {
  ContentParser,
  ParseResult,
  ContentUnit,
  MediaRef,
  ContentLink,
} from '../ImportPipeline.js';
import type {
  ImportSourceType,
  OpenAIConversation,
  OpenAIMappingNode,
} from '../../embeddings/types.js';

/**
 * Media reference extracted from conversation JSON
 */
interface ExtractedMediaRef {
  type: 'sediment' | 'file-service' | 'file' | 'attachment' | 'dalle';
  pointer?: string;
  fileId?: string;
  fileHash?: string;
  filename?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  mimeType?: string;
  dalleMetadata?: Record<string, unknown>;
}

/**
 * Linearized message from mapping tree
 */
interface LinearizedMessage {
  id: string;
  nodeId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  authorName?: string;
  content: string;
  createTime: number | null;
  position: number;
  parentId: string | null;
  mediaRefs: ExtractedMediaRef[];
  metadata: Record<string, unknown>;
}

/**
 * Media extensions to look for in archives
 */
const MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
  '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.pdf',
]);

export class OpenAIParser implements ContentParser {
  private verbose: boolean;

  constructor(options: { verbose?: boolean } = {}) {
    this.verbose = options.verbose ?? false;
  }

  private log(...args: unknown[]): void {
    if (this.verbose) {
      console.log('[OpenAIParser]', ...args);
    }
  }

  /**
   * Check if this parser can handle the source
   */
  async canParse(sourcePath: string): Promise<boolean> {
    const ext = path.extname(sourcePath).toLowerCase();

    if (ext !== '.zip') {
      return false;
    }

    // Check if it's an OpenAI export by looking for conversations.json
    try {
      const zipFiles = this.listZipContents(sourcePath);
      return zipFiles.some(f =>
        f.endsWith('conversations.json') ||
        f.includes('/conversations.json')
      );
    } catch {
      return false;
    }
  }

  /**
   * Parse the OpenAI export archive
   */
  async parse(sourcePath: string, _sourceType: ImportSourceType): Promise<ParseResult> {
    const units: ContentUnit[] = [];
    const mediaRefs: MediaRef[] = [];
    const links: ContentLink[] = [];
    const errors: string[] = [];

    // Create temporary extraction directory
    const tmpDir = path.join(path.dirname(sourcePath), `_openai_extract_${Date.now()}`);

    try {
      // Extract archive
      this.log('Extracting archive to', tmpDir);
      await this.extractZip(sourcePath, tmpDir);

      // Find conversations.json
      const conversationsPath = await this.findConversationsJson(tmpDir);
      if (!conversationsPath) {
        throw new Error('conversations.json not found in archive');
      }

      this.log('Found conversations.json at', conversationsPath);

      // Load conversations
      const conversationsJson = await fs.readFile(conversationsPath, 'utf-8');
      const conversations: OpenAIConversation[] = JSON.parse(conversationsJson);

      this.log(`Loaded ${conversations.length} conversations`);

      // Find all media files in archive
      const mediaFiles = await this.findMediaFiles(tmpDir);
      this.log(`Found ${mediaFiles.length} media files`);

      // Process each conversation
      for (let i = 0; i < conversations.length; i++) {
        const conv = conversations[i];

        try {
          const result = this.parseConversation(conv, i, tmpDir, mediaFiles);
          units.push(...result.units);
          mediaRefs.push(...result.mediaRefs);
          links.push(...result.links);
          errors.push(...result.errors);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push(`Error parsing conversation ${conv.id || i}: ${errorMsg}`);
        }
      }

      this.log(`Parsed ${units.length} units, ${mediaRefs.length} media refs, ${links.length} links`);

    } finally {
      // Clean up temporary directory
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    return { units, mediaRefs, links, errors };
  }

  /**
   * Parse a single conversation
   */
  private parseConversation(
    conv: OpenAIConversation,
    index: number,
    tmpDir: string,
    mediaFiles: string[]
  ): ParseResult {
    const units: ContentUnit[] = [];
    const mediaRefs: MediaRef[] = [];
    const links: ContentLink[] = [];
    const errors: string[] = [];

    // Generate conversation URI
    const convId = conv.id || conv.conversation_id || uuidv4();
    const convUri = `content://openai/conversation/${convId}`;

    // Linearize mapping tree to get messages in order
    const messages = this.linearizeMapping(conv.mapping, conv.current_node);

    // Calculate conversation stats
    const totalContent = messages.map(m => m.content).join('\n');
    const wordCount = totalContent.split(/\s+/).filter(Boolean).length;

    // Create conversation ContentUnit
    const convUnit: ContentUnit = {
      id: convId,
      uri: convUri,
      unitType: 'conversation',
      contentType: 'text',
      content: totalContent,
      wordCount,
      charCount: totalContent.length,
      createdAt: conv.create_time ? conv.create_time * 1000 : Date.now(),
      updatedAt: conv.update_time ? conv.update_time * 1000 : undefined,
      isOwnContent: false, // Conversations contain both user and assistant
      metadata: {
        title: conv.title,
        isArchived: conv.is_archived,
        modelSlug: conv.default_model_slug,
        gizmoId: conv.gizmo_id,
        messageCount: messages.length,
        index,
      },
    };

    units.push(convUnit);

    // Process each message
    for (const msg of messages) {
      try {
        const msgId = msg.id;
        const msgUri = `content://openai/message/${msgId}`;

        // Map OpenAI role to ContentUnit authorRole (tool -> third_party)
        const authorRole: 'user' | 'assistant' | 'system' | 'third_party' =
          msg.role === 'tool' ? 'third_party' : msg.role;

        // Create message ContentUnit
        const msgUnit: ContentUnit = {
          id: msgId,
          uri: msgUri,
          unitType: 'message',
          contentType: 'text',
          content: msg.content,
          wordCount: msg.content.split(/\s+/).filter(Boolean).length,
          charCount: msg.content.length,
          parentUri: convUri,
          position: msg.position,
          authorRole,
          authorName: msg.authorName,
          isOwnContent: msg.role === 'user',
          createdAt: msg.createTime ? msg.createTime * 1000 : undefined,
          metadata: msg.metadata,
        };

        units.push(msgUnit);

        // Create parent link (message -> conversation)
        links.push({
          sourceUri: msgUri,
          targetUri: convUri,
          linkType: 'parent',
        });

        // Create sequence link (message -> previous message)
        if (msg.position > 0 && messages[msg.position - 1]) {
          const prevMsgId = messages[msg.position - 1].id;
          links.push({
            sourceUri: msgUri,
            targetUri: `content://openai/message/${prevMsgId}`,
            linkType: 'follows',
          });
        }

        // Process media references
        for (const mediaRef of msg.mediaRefs) {
          const resolvedPath = this.resolveMediaPath(mediaRef, tmpDir, mediaFiles);

          if (resolvedPath) {
            mediaRefs.push({
              contentUnitId: msgId,
              sourcePath: resolvedPath,
              originalPointer: mediaRef.pointer,
              referenceType: mediaRef.type === 'dalle' ? 'generated' :
                            mediaRef.type === 'attachment' ? 'attachment' : 'embed',
            });
          } else if (mediaRef.pointer) {
            // Record unresolved reference for debugging
            errors.push(`Unresolved media: ${mediaRef.pointer} (size: ${mediaRef.sizeBytes})`);
          }
        }

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Error processing message ${msg.id}: ${errorMsg}`);
      }
    }

    return { units, mediaRefs, links, errors };
  }

  /**
   * Linearize the mapping tree to get messages in chronological order
   *
   * OpenAI conversations use a DAG structure where each node has:
   * - parent: reference to parent node
   * - children: array of child node IDs
   *
   * We walk from root to current_node, collecting messages along the path.
   */
  private linearizeMapping(
    mapping: Record<string, OpenAIMappingNode>,
    currentNode: string
  ): LinearizedMessage[] {
    const messages: LinearizedMessage[] = [];

    // Find root node (parent is null)
    const rootId = Object.keys(mapping).find(id => mapping[id].parent === null);
    if (!rootId) {
      return messages;
    }

    // Build path from root to current_node
    const path = this.findPathToNode(mapping, rootId, currentNode);

    // Extract messages along the path
    let position = 0;
    for (const nodeId of path) {
      const node = mapping[nodeId];
      if (!node?.message) continue;

      const msg = node.message;
      const role = msg.author?.role || 'unknown';

      // Skip system/tool messages without content
      const content = this.extractMessageContent(msg);
      if (!content && (role === 'system' || role === 'tool')) {
        continue;
      }

      // Extract media references from this message
      const mediaRefs = this.extractMediaRefs(msg);

      messages.push({
        id: msg.id,
        nodeId,
        role: role as 'user' | 'assistant' | 'system' | 'tool',
        authorName: msg.author?.name,
        content,
        createTime: msg.create_time,
        position: position++,
        parentId: node.parent,
        mediaRefs,
        metadata: {
          status: msg.status,
          endTurn: msg.end_turn,
          recipient: msg.recipient,
        },
      });
    }

    return messages;
  }

  /**
   * Find path from root to target node using BFS
   */
  private findPathToNode(
    mapping: Record<string, OpenAIMappingNode>,
    startId: string,
    targetId: string
  ): string[] {
    // BFS to find path
    const visited = new Set<string>();
    const queue: { id: string; path: string[] }[] = [{ id: startId, path: [startId] }];

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;

      if (id === targetId) {
        return path;
      }

      if (visited.has(id)) continue;
      visited.add(id);

      const node = mapping[id];
      if (!node?.children) continue;

      for (const childId of node.children) {
        if (!visited.has(childId)) {
          queue.push({ id: childId, path: [...path, childId] });
        }
      }
    }

    // If target not found, return path to deepest node
    return this.findDeepestPath(mapping, startId);
  }

  /**
   * Find the deepest path from a start node (fallback)
   */
  private findDeepestPath(
    mapping: Record<string, OpenAIMappingNode>,
    startId: string
  ): string[] {
    let deepestPath: string[] = [startId];
    const node = mapping[startId];

    if (node?.children?.length) {
      for (const childId of node.children) {
        const childPath = this.findDeepestPath(mapping, childId);
        if (childPath.length + 1 > deepestPath.length) {
          deepestPath = [startId, ...childPath];
        }
      }
    }

    return deepestPath;
  }

  /**
   * Extract text content from a message
   */
  private extractMessageContent(msg: OpenAIMappingNode['message']): string {
    if (!msg?.content) return '';

    const { content } = msg;

    // Handle text field directly
    if (content.text) {
      return content.text;
    }

    // Handle parts array
    if (content.parts && Array.isArray(content.parts)) {
      const textParts: string[] = [];

      for (const part of content.parts) {
        if (typeof part === 'string') {
          textParts.push(part);
        } else if (part && typeof part === 'object') {
          // Check for text in object parts
          if ('text' in part && typeof part.text === 'string') {
            textParts.push(part.text);
          }
        }
      }

      return textParts.join('\n');
    }

    return '';
  }

  /**
   * Extract media references from a message
   */
  private extractMediaRefs(msg: OpenAIMappingNode['message']): ExtractedMediaRef[] {
    const refs: ExtractedMediaRef[] = [];
    if (!msg) return refs;

    // Extract from content parts
    const parts = msg.content?.parts || [];
    for (const part of parts) {
      if (typeof part !== 'object' || !part) continue;

      const assetPointer = (part as Record<string, unknown>).asset_pointer as string | undefined;
      if (assetPointer) {
        const ref = this.parseAssetPointer(part as Record<string, unknown>);
        if (ref) refs.push(ref);
      }
    }

    // Extract from metadata.attachments
    const attachments = (msg.metadata as Record<string, unknown>)?.attachments as Array<{
      id?: string;
      name?: string;
      size?: number;
      mimeType?: string;
      width?: number;
      height?: number;
    }> | undefined;

    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        refs.push({
          type: 'attachment',
          fileId: att.id,
          filename: att.name,
          sizeBytes: att.size,
          mimeType: att.mimeType,
          width: att.width,
          height: att.height,
        });
      }
    }

    return refs;
  }

  /**
   * Parse an asset_pointer into a structured reference
   */
  private parseAssetPointer(part: Record<string, unknown>): ExtractedMediaRef | null {
    const pointer = part.asset_pointer as string;
    if (!pointer) return null;

    const ref: ExtractedMediaRef = {
      type: 'file',
      pointer,
      sizeBytes: part.size_bytes as number | undefined,
      width: part.width as number | undefined,
      height: part.height as number | undefined,
    };

    if (pointer.startsWith('sediment://')) {
      ref.type = 'sediment';
      ref.fileHash = pointer.replace('sediment://', '');
    } else if (pointer.startsWith('file-service://')) {
      ref.type = 'file-service';
      ref.fileId = pointer.replace('file-service://', '');

      // Check for DALL-E metadata
      const metadata = part.metadata as Record<string, unknown> | undefined;
      const dalleMetadata = metadata?.dalle as Record<string, unknown> | undefined;
      if (dalleMetadata) {
        ref.type = 'dalle';
        ref.dalleMetadata = dalleMetadata;
      }
    } else if (pointer.startsWith('file://')) {
      ref.type = 'file';
      ref.filename = pointer.replace('file://', '').split('/').pop();
    }

    return ref;
  }

  /**
   * Resolve a media reference to an actual file path
   */
  private resolveMediaPath(
    ref: ExtractedMediaRef,
    tmpDir: string,
    mediaFiles: string[]
  ): string | null {
    // Strategy 1: Match by sediment file hash pattern
    if (ref.type === 'sediment' && ref.fileHash) {
      const pattern = ref.fileHash;
      const match = mediaFiles.find(f => path.basename(f).startsWith(pattern));
      if (match) return match;
    }

    // Strategy 2: Match by file-service ID
    if ((ref.type === 'file-service' || ref.type === 'dalle') && ref.fileId) {
      const pattern = ref.fileId;
      const match = mediaFiles.find(f => path.basename(f).includes(pattern));
      if (match) return match;
    }

    // Strategy 3: Match by file size (if unique)
    if (ref.sizeBytes) {
      const matchingBySize = mediaFiles.filter(async f => {
        try {
          const stats = await fs.stat(f);
          return stats.size === ref.sizeBytes;
        } catch {
          return false;
        }
      });

      if (matchingBySize.length === 1) {
        return matchingBySize[0];
      }
    }

    // Strategy 4: Match by filename
    if (ref.filename) {
      const match = mediaFiles.find(f =>
        path.basename(f).toLowerCase() === ref.filename!.toLowerCase()
      );
      if (match) return match;
    }

    return null;
  }

  /**
   * Extract a ZIP file to a directory
   */
  private async extractZip(zipPath: string, destDir: string): Promise<void> {
    await fs.mkdir(destDir, { recursive: true });

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);
  }

  /**
   * List contents of a ZIP file
   */
  private listZipContents(zipPath: string): string[] {
    try {
      const zip = new AdmZip(zipPath);
      return zip.getEntries().map(entry => entry.entryName);
    } catch {
      return [];
    }
  }

  /**
   * Find conversations.json in extracted directory
   */
  private async findConversationsJson(dir: string): Promise<string | null> {
    // Common locations
    const candidates = [
      path.join(dir, 'conversations.json'),
      path.join(dir, 'chatgpt', 'conversations.json'),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    // Recursive search
    const files = await this.walkDirectory(dir);
    return files.find(f => path.basename(f) === 'conversations.json') ?? null;
  }

  /**
   * Find all media files in a directory
   */
  private async findMediaFiles(dir: string): Promise<string[]> {
    const allFiles = await this.walkDirectory(dir);
    return allFiles.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return MEDIA_EXTENSIONS.has(ext);
    });
  }

  /**
   * Walk a directory recursively
   */
  private async walkDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];

    async function walk(currentDir: string) {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);

          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            files.push(fullPath);
          }
        }
      } catch {
        // Ignore directories we can't read
      }
    }

    if (existsSync(dir)) {
      await walk(dir);
    }

    return files;
  }
}

/**
 * Create an OpenAIParser instance
 */
export function createOpenAIParser(options: { verbose?: boolean } = {}): OpenAIParser {
  return new OpenAIParser(options);
}

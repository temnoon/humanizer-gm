/**
 * Universal Content Graph (UCG) - Main Module
 *
 * A single, universal content interchange format that all sources normalize to.
 * New formats require only adapters, never schema changes.
 *
 * Usage:
 * ```typescript
 * import { ContentGraphDatabase, adapterRegistry } from './content-graph';
 *
 * // Initialize database
 * const db = new Database('archive.db');
 * const graphDb = new ContentGraphDatabase(db, vecLoaded);
 * graphDb.initialize();
 *
 * // Register adapters
 * registerBuiltinAdapters();
 *
 * // Import content
 * const adapter = adapterRegistry.get('chatgpt');
 * for await (const node of adapter.parse(input)) {
 *   graphDb.insertNode(node);
 * }
 * ```
 */

// Core database operations
export { ContentGraphDatabase } from './ContentGraphDatabase.js';

// Schema and migrations
export {
  ContentGraphSchema,
  UCG_SCHEMA_VERSION,
  EMBEDDING_DIM,
  SCHEMA_SQL,
  INDEXES_SQL,
  FTS_SQL,
  VECTOR_TABLE_SQL,
  type ContentNodeRow,
  type ContentLinkRow,
  type ContentBlobRow,
  type ContentVersionRow,
  type ImportBatchRow,
  type ContentQualityRow,
} from './schema.js';

// Adapter registry
export {
  AdapterRegistry,
  adapterRegistry,
  registerBuiltinAdapter,
} from './AdapterRegistry.js';

// Graph operations
export {
  LinkGraph,
  type TraversalResult,
  type NodePath,
  type LinkStats,
  type ContentCluster,
} from './LinkGraph.js';

// Version control
export {
  VersionControl,
  type ContentDiff,
  type TextChange,
  type MetadataChange,
  type VersionTreeNode,
} from './VersionControl.js';

// Chunking service
export {
  ChunkingService,
  getChunkingService,
  TARGET_CHUNK_CHARS,
  MAX_CHUNK_CHARS,
  MIN_CHUNK_CHARS,
  type ContentChunk,
  type ChunkingResult,
  type ChunkBoundary,
  type ChunkingStrategy,
  type ChunkingConfig,
} from './ChunkingService.js';

// Ingestion service
export {
  IngestionService,
  type IngestionSource,
  type IngestionProgress,
  type IngestionStats,
  type IngestionOptions,
} from './IngestionService.js';

// Adapters
export {
  ChatGPTAdapter,
  createChatGPTAdapter,
  ClaudeAdapter,
  createClaudeAdapter,
  MarkdownAdapter,
  createMarkdownAdapter,
  TextAdapter,
  createTextAdapter,
} from './adapters/index.js';

// Re-export core types
export type {
  ContentNode,
  ContentLink,
  ContentBlob,
  ContentAnchor,
  LinkAnchor,
  ContentFormat,
  SourceType,
  LinkType,
  CreateContentNodeOptions,
  CreateContentLinkOptions,
  ContentNodeQuery,
  ContentLinkQuery,
  ContentVersion,
  ContentLineage,
  ContentAdapter,
  AdapterOptions,
  DetectionResult,
  ParseResult,
  ParseError,
  AdapterMetadata,
} from '@humanizer/core';

/**
 * Register all built-in adapters
 */
export function registerBuiltinAdapters(): void {
  const { adapterRegistry, registerBuiltinAdapter } = require('./AdapterRegistry.js');
  const { createChatGPTAdapter } = require('./adapters/chatgpt-adapter.js');
  const { createClaudeAdapter } = require('./adapters/claude-adapter.js');
  const { createMarkdownAdapter } = require('./adapters/markdown-adapter.js');
  const { createTextAdapter } = require('./adapters/text-adapter.js');

  // Register with priorities (higher = checked first)
  registerBuiltinAdapter(createChatGPTAdapter, 100);
  registerBuiltinAdapter(createClaudeAdapter, 90);
  registerBuiltinAdapter(createMarkdownAdapter, 50);
  registerBuiltinAdapter(createTextAdapter, 10);  // Lowest priority (fallback)

  console.log(`[UCG] Registered ${adapterRegistry.count} built-in adapters`);
}

/**
 * Initialize the complete UCG system
 */
export async function initializeContentGraph(
  db: import('better-sqlite3').Database,
  vecLoaded: boolean = false
) {
  // Import at runtime to avoid circular deps
  const { ContentGraphDatabase } = await import('./ContentGraphDatabase.js');
  const { LinkGraph } = await import('./LinkGraph.js');
  const { VersionControl } = await import('./VersionControl.js');
  const { IngestionService } = await import('./IngestionService.js');

  // Create and initialize database
  const graphDb = new ContentGraphDatabase(db, vecLoaded);
  graphDb.initialize();

  // Create services
  const linkGraph = new LinkGraph(db, graphDb);
  const versionControl = new VersionControl(db, graphDb);
  const ingestionService = new IngestionService(db, graphDb, vecLoaded);

  // Register adapters
  registerBuiltinAdapters();

  console.log('[UCG] Content Graph initialized');

  return { graphDb, linkGraph, versionControl, ingestionService };
}

/**
 * Universal Import Pipeline
 *
 * Unified import system for all content types:
 * - OpenAI ChatGPT exports
 * - Claude exports
 * - Facebook archives
 * - Documents (txt, md, docx, pdf, odt)
 * - ZIP archives
 *
 * Key principles:
 * - Content-addressable media storage (SHA-256 hash)
 * - Unified ContentUnit output
 * - Bidirectional Xanadu links
 * - Single SQLite database as source of truth
 */

export {
  ContentAddressableStore,
  createContentAddressableStore,
  type StoreResult,
  type PointerManifest,
} from './media/ContentAddressableStore.js';

export {
  ImportPipeline,
  createImportPipeline,
  type ContentUnit,
  type MediaRef,
  type ContentLink,
  type ParseResult,
  type ContentParser,
  type ImportOptions,
  type ImportResult,
  type ProgressCallback,
} from './ImportPipeline.js';

export {
  FileTypeDetector,
  createFileTypeDetector,
  type DetectionResult,
} from './detection/FileTypeDetector.js';

// Parsers
export {
  OpenAIParser,
  createOpenAIParser,
  GeminiParser,
  createGeminiParser,
  DocumentParser,
  createDocumentParser,
} from './parsers/index.js';

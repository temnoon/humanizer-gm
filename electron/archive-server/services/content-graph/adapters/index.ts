/**
 * Content Graph Adapters - Export all adapters
 *
 * Each adapter normalizes a specific format into ContentNode objects.
 */

// Adapter exports
export { ChatGPTAdapter, createChatGPTAdapter } from './chatgpt-adapter.js';
export { ClaudeAdapter, createClaudeAdapter } from './claude-adapter.js';
export { MarkdownAdapter, createMarkdownAdapter } from './markdown-adapter.js';
export { TextAdapter, createTextAdapter } from './text-adapter.js';
export { FacebookAdapter, createFacebookAdapter } from './facebook-adapter.js';
export { FolderAdapter, createFolderAdapter } from './folder-adapter.js';
export { RedditAdapter, createRedditAdapter } from './reddit-adapter.js';
export { InstagramAdapter, createInstagramAdapter } from './instagram-adapter.js';

// Re-export types
export type { ContentAdapter, AdapterOptions, DetectionResult, ParseResult, ParseError } from '@humanizer/core';

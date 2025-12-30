/**
 * Content Parsers
 *
 * Each parser implements the ContentParser interface and handles
 * a specific source type:
 *
 * - OpenAIParser: ChatGPT export archives (.zip with conversations.json)
 * - GeminiParser: Google Gemini conversation exports (.json)
 * - DocumentParser: Plain text and markdown files (.txt, .md)
 *
 * Future parsers:
 * - ClaudeParser: Claude export archives
 * - FacebookParser: Facebook data exports
 * - DocxParser: Word documents (using mammoth)
 * - PdfParser: PDF documents (using pdf-parse)
 */

export { OpenAIParser, createOpenAIParser } from './OpenAIParser.js';
export { GeminiParser, createGeminiParser } from './GeminiParser.js';
export { DocumentParser, createDocumentParser } from './DocumentParser.js';

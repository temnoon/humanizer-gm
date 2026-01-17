/**
 * ContentBlockExtractor - Extract structured content blocks from messages
 *
 * Parses messages to find and extract:
 * - Fenced code blocks (with language detection)
 * - JSON payloads (DALL-E prompts, artifacts, canvas, tool results)
 * - Markdown sections
 * - Transcribed notebook content
 *
 * Each extracted block carries metadata for searchability:
 * - gizmo_id (custom GPT identifier)
 * - created_at (timestamp)
 * - block_type (code, transcription, artifact, image_prompt, etc.)
 * - language (for code blocks)
 */

// ============================================================================
// Types
// ============================================================================

export type BlockType =
  | 'code'            // Fenced code block
  | 'image_prompt'    // DALL-E/image generation prompt
  | 'artifact'        // Claude artifact
  | 'canvas'          // ChatGPT canvas
  | 'search_result'   // Tool search results
  | 'transcription'   // Handwritten notebook transcription
  | 'json_data'       // Other structured JSON
  | 'prose'           // Regular text/markdown prose

export interface ExtractedBlock {
  id: string
  blockType: BlockType
  content: string
  language?: string           // For code blocks: python, typescript, etc.

  // Position in source
  startOffset: number
  endOffset: number

  // Metadata from parent
  parentMessageId: string
  parentConversationId: string
  conversationTitle?: string
  gizmoId?: string            // Custom GPT identifier
  createdAt?: number          // Unix timestamp

  // Additional parsed data
  metadata?: Record<string, unknown>
}

export interface ExtractionContext {
  messageId: string
  conversationId: string
  conversationTitle?: string
  gizmoId?: string
  createdAt?: number
  role?: string
}

export interface ExtractionResult {
  blocks: ExtractedBlock[]
  stats: {
    codeBlocks: number
    imagePrompts: number
    artifacts: number
    jsonBlocks: number
    proseBlocks: number
  }
}

// ============================================================================
// Known GPT Identifiers
// ============================================================================

// Map of known gizmo_ids to their purposes
const KNOWN_GIZMOS: Record<string, { name: string; produces: BlockType }> = {
  // Add Journal Recognizer and other known custom GPTs here
  // Format: 'gizmo_id': { name: 'Human Name', produces: 'transcription' }
};

/**
 * Check if a gizmo_id indicates a transcription source
 */
function isTranscriptionGizmo(gizmoId?: string): boolean {
  if (!gizmoId) return false;

  // Known transcription GPTs
  const transcriptionKeywords = [
    'journal', 'notebook', 'handwrit', 'transcri', 'recogni'
  ];

  const gizmoInfo = KNOWN_GIZMOS[gizmoId];
  if (gizmoInfo?.produces === 'transcription') return true;

  // Check name patterns (gizmo_id often contains descriptive text)
  const lowerGizmo = gizmoId.toLowerCase();
  return transcriptionKeywords.some(kw => lowerGizmo.includes(kw));
}

// ============================================================================
// Extraction Patterns
// ============================================================================

// Fenced code block: ```language\n...\n```
const CODE_BLOCK_REGEX = /```(\w*)\n([\s\S]*?)```/g;

// JSON object at message start or standalone
const JSON_OBJECT_REGEX = /^\s*(\{[\s\S]*\})\s*$/;

// DALL-E prompt patterns
const DALLE_PROMPT_PATTERNS = [
  /\{"prompt"\s*:\s*"([^"]+)"[^}]*\}/g,
  /\{"size"\s*:\s*"[^"]+"\s*,\s*"prompt"\s*:\s*"([^"]+)"\}/g,
];

// Claude artifact pattern
const ARTIFACT_REGEX = /<artifact[^>]*>([\s\S]*?)<\/artifact>/gi;

// ChatGPT canvas pattern (if present in exports)
const CANVAS_REGEX = /<canvas[^>]*>([\s\S]*?)<\/canvas>/gi;

// ============================================================================
// ContentBlockExtractor Class
// ============================================================================

export class ContentBlockExtractor {
  private blockCounter = 0;

  /**
   * Extract all content blocks from a message
   */
  extract(content: string, context: ExtractionContext): ExtractionResult {
    const blocks: ExtractedBlock[] = [];
    const stats = {
      codeBlocks: 0,
      imagePrompts: 0,
      artifacts: 0,
      jsonBlocks: 0,
      proseBlocks: 0,
    };

    // Track what ranges we've extracted to avoid overlap
    const extractedRanges: Array<[number, number]> = [];

    // 1. Extract fenced code blocks
    const codeBlocks = this.extractCodeBlocks(content, context);
    for (const block of codeBlocks) {
      blocks.push(block);
      extractedRanges.push([block.startOffset, block.endOffset]);
      stats.codeBlocks++;
    }

    // 2. Extract JSON payloads (DALL-E prompts, etc.)
    const jsonBlocks = this.extractJsonPayloads(content, context, extractedRanges);
    for (const block of jsonBlocks) {
      blocks.push(block);
      extractedRanges.push([block.startOffset, block.endOffset]);
      if (block.blockType === 'image_prompt') {
        stats.imagePrompts++;
      } else {
        stats.jsonBlocks++;
      }
    }

    // 3. Extract artifacts
    const artifactBlocks = this.extractArtifacts(content, context, extractedRanges);
    for (const block of artifactBlocks) {
      blocks.push(block);
      extractedRanges.push([block.startOffset, block.endOffset]);
      stats.artifacts++;
    }

    // 4. Check if entire message is a transcription (from Journal Recognizer etc.)
    if (isTranscriptionGizmo(context.gizmoId) && blocks.length === 0) {
      // The whole message is likely a transcription
      const transcriptionBlock = this.createBlock(
        'transcription',
        content.trim(),
        0,
        content.length,
        context
      );
      blocks.push(transcriptionBlock);
    }

    // 5. Extract remaining prose sections (if significant)
    const proseBlocks = this.extractProse(content, context, extractedRanges);
    for (const block of proseBlocks) {
      blocks.push(block);
      stats.proseBlocks++;
    }

    return { blocks, stats };
  }

  /**
   * Extract fenced code blocks
   */
  private extractCodeBlocks(content: string, context: ExtractionContext): ExtractedBlock[] {
    const blocks: ExtractedBlock[] = [];
    let match;

    CODE_BLOCK_REGEX.lastIndex = 0;
    while ((match = CODE_BLOCK_REGEX.exec(content)) !== null) {
      const language = match[1] || 'text';
      const code = match[2].trim();

      // Skip empty or very short code blocks
      if (code.length < 10) continue;

      const block = this.createBlock(
        'code',
        code,
        match.index,
        match.index + match[0].length,
        context,
        { language }
      );
      block.language = language;
      blocks.push(block);
    }

    return blocks;
  }

  /**
   * Extract JSON payloads (DALL-E prompts, structured data)
   */
  private extractJsonPayloads(
    content: string,
    context: ExtractionContext,
    excludeRanges: Array<[number, number]>
  ): ExtractedBlock[] {
    const blocks: ExtractedBlock[] = [];

    // Check for DALL-E prompts
    for (const pattern of DALLE_PROMPT_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (this.isInRange(match.index, excludeRanges)) continue;

        const prompt = match[1];
        if (prompt.length < 10) continue;

        // Extract the prompt text as the content (not the JSON wrapper)
        const block = this.createBlock(
          'image_prompt',
          prompt,
          match.index,
          match.index + match[0].length,
          context,
          {
            rawJson: match[0],
            promptType: 'dalle'
          }
        );
        blocks.push(block);
      }
    }

    // Check if entire message is a JSON object
    const jsonMatch = content.match(JSON_OBJECT_REGEX);
    if (jsonMatch && !this.isInRange(0, excludeRanges)) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);

        // Determine JSON type
        if (parsed.prompt && (parsed.size || parsed.model)) {
          // Image generation prompt
          const block = this.createBlock(
            'image_prompt',
            parsed.prompt,
            0,
            content.length,
            context,
            { rawJson: jsonMatch[1], parsedData: parsed }
          );
          blocks.push(block);
        } else if (parsed.type === 'artifact' || parsed.artifact) {
          // Claude artifact
          const artifactContent = parsed.content || parsed.artifact?.content || JSON.stringify(parsed);
          const block = this.createBlock(
            'artifact',
            artifactContent,
            0,
            content.length,
            context,
            { rawJson: jsonMatch[1], parsedData: parsed }
          );
          blocks.push(block);
        } else if (parsed.results || parsed.query) {
          // Search results
          const searchContent = parsed.results
            ? JSON.stringify(parsed.results, null, 2)
            : jsonMatch[1];
          const block = this.createBlock(
            'search_result',
            searchContent,
            0,
            content.length,
            context,
            { rawJson: jsonMatch[1], parsedData: parsed }
          );
          blocks.push(block);
        } else {
          // Generic JSON data
          const block = this.createBlock(
            'json_data',
            jsonMatch[1],
            0,
            content.length,
            context,
            { parsedData: parsed }
          );
          blocks.push(block);
        }
      } catch {
        // Not valid JSON, skip
      }
    }

    return blocks;
  }

  /**
   * Extract Claude artifacts and ChatGPT canvas blocks
   */
  private extractArtifacts(
    content: string,
    context: ExtractionContext,
    excludeRanges: Array<[number, number]>
  ): ExtractedBlock[] {
    const blocks: ExtractedBlock[] = [];

    // Claude artifacts
    ARTIFACT_REGEX.lastIndex = 0;
    let match;
    while ((match = ARTIFACT_REGEX.exec(content)) !== null) {
      if (this.isInRange(match.index, excludeRanges)) continue;

      const artifactContent = match[1].trim();
      if (artifactContent.length < 10) continue;

      const block = this.createBlock(
        'artifact',
        artifactContent,
        match.index,
        match.index + match[0].length,
        context
      );
      blocks.push(block);
    }

    // ChatGPT canvas
    CANVAS_REGEX.lastIndex = 0;
    while ((match = CANVAS_REGEX.exec(content)) !== null) {
      if (this.isInRange(match.index, excludeRanges)) continue;

      const canvasContent = match[1].trim();
      if (canvasContent.length < 10) continue;

      const block = this.createBlock(
        'canvas',
        canvasContent,
        match.index,
        match.index + match[0].length,
        context
      );
      blocks.push(block);
    }

    return blocks;
  }

  /**
   * Extract prose sections (text between other blocks)
   */
  private extractProse(
    content: string,
    context: ExtractionContext,
    excludeRanges: Array<[number, number]>
  ): ExtractedBlock[] {
    const blocks: ExtractedBlock[] = [];

    // Sort ranges by start position
    const sortedRanges = [...excludeRanges].sort((a, b) => a[0] - b[0]);

    let lastEnd = 0;
    for (const [start, end] of sortedRanges) {
      if (start > lastEnd) {
        const prose = content.slice(lastEnd, start).trim();
        if (prose.length >= 50) { // Only keep substantial prose
          const block = this.createBlock(
            'prose',
            prose,
            lastEnd,
            start,
            context
          );
          blocks.push(block);
        }
      }
      lastEnd = Math.max(lastEnd, end);
    }

    // Check for prose after the last extracted block
    if (lastEnd < content.length) {
      const prose = content.slice(lastEnd).trim();
      if (prose.length >= 50) {
        const block = this.createBlock(
          'prose',
          prose,
          lastEnd,
          content.length,
          context
        );
        blocks.push(block);
      }
    }

    return blocks;
  }

  /**
   * Create a block with all metadata
   */
  private createBlock(
    blockType: BlockType,
    content: string,
    startOffset: number,
    endOffset: number,
    context: ExtractionContext,
    extraMetadata?: Record<string, unknown>
  ): ExtractedBlock {
    this.blockCounter++;

    return {
      id: `block-${context.messageId}-${this.blockCounter}`,
      blockType,
      content,
      startOffset,
      endOffset,
      parentMessageId: context.messageId,
      parentConversationId: context.conversationId,
      conversationTitle: context.conversationTitle,
      gizmoId: context.gizmoId,
      createdAt: context.createdAt,
      metadata: extraMetadata,
    };
  }

  /**
   * Check if a position falls within any excluded range
   */
  private isInRange(pos: number, ranges: Array<[number, number]>): boolean {
    return ranges.some(([start, end]) => pos >= start && pos < end);
  }

  /**
   * Reset the block counter (for testing)
   */
  resetCounter(): void {
    this.blockCounter = 0;
  }
}

// ============================================================================
// Convenience function
// ============================================================================

/**
 * Quick extraction without instantiating the class
 */
export function extractContentBlocks(
  content: string,
  context: ExtractionContext
): ExtractionResult {
  const extractor = new ContentBlockExtractor();
  return extractor.extract(content, context);
}

// ============================================================================
// Utilities for identifying block types
// ============================================================================

/**
 * Check if content looks like a transcription
 */
export function looksLikeTranscription(content: string): boolean {
  // Handwritten transcriptions often have these characteristics:
  const indicators = [
    /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/, // Date at start
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i, // Day at start
    /\b(notebook|journal|page \d+|entry)\b/i, // Journal keywords
    /^\s*[-•]\s+/m, // Bullet points (common in notes)
  ];

  return indicators.some(pattern => pattern.test(content));
}

/**
 * Detect the language of a code block from content if not specified
 */
export function detectCodeLanguage(code: string): string {
  // Simple heuristics for common languages
  if (/^(import|from)\s+\w+/.test(code)) return 'python';
  if (/^(const|let|var|function|import)\s+/.test(code)) return 'javascript';
  if (/^(interface|type|const|let)\s+\w+\s*[:<]/.test(code)) return 'typescript';
  if (/^(def|class)\s+\w+/.test(code)) return 'python';
  if (/^\s*<\w+/.test(code)) return 'html';
  if (/^\{[\s\S]*\}$/.test(code.trim())) return 'json';
  if (/^SELECT|INSERT|UPDATE|DELETE/i.test(code)) return 'sql';
  if (/^#!\s*\//.test(code)) return 'bash';

  return 'text';
}

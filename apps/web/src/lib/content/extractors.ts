/**
 * Content Extractors
 *
 * Extract meaningful text from structured JSON content like:
 * - DALL-E image generation prompts
 * - Anthropic Artifacts (code, documents, SVGs)
 * - OpenAI Canvas documents
 * - Tool calls and function results
 *
 * Philosophy: Find the "real" human-readable content beneath the structure.
 */

export interface ExtractedContent {
  /** The main text content */
  text: string;
  /** Type of content extracted */
  type: 'dalle-prompt' | 'artifact' | 'canvas' | 'tool-call' | 'plain';
  /** Original metadata preserved */
  metadata?: Record<string, unknown>;
  /** Title if available */
  title?: string;
  /** Language for code */
  language?: string;
}

/**
 * Try to parse content as JSON and extract meaningful text
 * Returns original content if not JSON or extraction fails
 */
export function extractContent(content: string): ExtractedContent {
  // Quick check: does it look like JSON?
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { text: content, type: 'plain' };
  }

  try {
    const parsed = JSON.parse(trimmed);

    // Try each extractor in order of specificity
    const extracted =
      extractDallePrompt(parsed) ||
      extractAnthropicArtifact(parsed) ||
      extractOpenAICanvas(parsed) ||
      extractToolCall(parsed) ||
      extractGenericContent(parsed);

    if (extracted) {
      return extracted;
    }
  } catch {
    // Not valid JSON, return as-is
  }

  return { text: content, type: 'plain' };
}

/**
 * Extract DALL-E image generation prompts
 * Format: { "prompt": "...", "size": "...", ... }
 */
function extractDallePrompt(obj: unknown): ExtractedContent | null {
  if (!isObject(obj)) return null;

  // DALL-E typically has "prompt" and optionally "size", "quality", "style"
  if ('prompt' in obj && typeof obj.prompt === 'string') {
    const metadata: Record<string, unknown> = {};

    if ('size' in obj) metadata.size = obj.size;
    if ('quality' in obj) metadata.quality = obj.quality;
    if ('style' in obj) metadata.style = obj.style;
    if ('model' in obj) metadata.model = obj.model;
    if ('revised_prompt' in obj && typeof obj.revised_prompt === 'string') {
      // Include revised prompt as main text since it's often more interesting
      return {
        text: obj.revised_prompt,
        type: 'dalle-prompt',
        title: 'DALL-E Prompt',
        metadata: { original_prompt: obj.prompt, ...metadata },
      };
    }

    return {
      text: obj.prompt,
      type: 'dalle-prompt',
      title: 'DALL-E Prompt',
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  return null;
}

/**
 * Extract Anthropic Artifacts
 * Format: { "type": "code" | "text" | "svg", "content": "...", "title": "..." }
 * or wrapped: { "artifact": { ... } }
 */
function extractAnthropicArtifact(obj: unknown): ExtractedContent | null {
  if (!isObject(obj)) return null;

  // Handle wrapped format
  let artifact = obj;
  if ('artifact' in obj && isObject(obj.artifact)) {
    artifact = obj.artifact;
  }

  // Check for artifact structure
  if ('type' in artifact && 'content' in artifact) {
    const artType = artifact.type;
    const content = artifact.content;

    if (typeof content !== 'string') return null;

    const title = 'title' in artifact && typeof artifact.title === 'string'
      ? artifact.title
      : `Artifact (${artType})`;

    // For code artifacts, preserve language info
    if (artType === 'code' && 'language' in artifact) {
      return {
        text: content,
        type: 'artifact',
        title,
        language: String(artifact.language),
        metadata: { artifactType: artType },
      };
    }

    return {
      text: content,
      type: 'artifact',
      title,
      metadata: { artifactType: artType },
    };
  }

  return null;
}

/**
 * Extract OpenAI Canvas documents
 * Format: { "canvas": { "content": "...", "type": "...", ... } }
 * or: { "document": { "content": "...", ... } }
 * or: { "type": "document", "name": "...", "content": "..." } (flat format)
 */
function extractOpenAICanvas(obj: unknown): ExtractedContent | null {
  if (!isObject(obj)) return null;

  // Canvas wrapper
  if ('canvas' in obj && isObject(obj.canvas)) {
    const canvas = obj.canvas;
    if ('content' in canvas && typeof canvas.content === 'string') {
      const title = 'title' in canvas && typeof canvas.title === 'string'
        ? canvas.title
        : 'Canvas Document';

      return {
        text: canvas.content,
        type: 'canvas',
        title,
        language: 'language' in canvas ? String(canvas.language) : undefined,
      };
    }
  }

  // Document wrapper (alternative format)
  if ('document' in obj && isObject(obj.document)) {
    const doc = obj.document;
    if ('content' in doc && typeof doc.content === 'string') {
      return {
        text: doc.content,
        type: 'canvas',
        title: 'title' in doc && typeof doc.title === 'string' ? doc.title : 'Document',
      };
    }
  }

  // Flat format: { "type": "document", "name": "...", "content": "..." }
  // This is used by OpenAI Canvas when embedded in messages
  if ('type' in obj && 'content' in obj && typeof obj.content === 'string') {
    const docType = obj.type;
    if (docType === 'document' || docType === 'code' || docType === 'text') {
      const title = 'name' in obj && typeof obj.name === 'string'
        ? obj.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        : `${docType.charAt(0).toUpperCase() + docType.slice(1)}`;

      return {
        text: obj.content,
        type: 'canvas',
        title,
        language: 'language' in obj ? String(obj.language) : undefined,
        metadata: { docType },
      };
    }
  }

  return null;
}

/**
 * Extract tool call results
 * Format: { "tool": "...", "result": "..." } or { "function_call": { ... } }
 */
function extractToolCall(obj: unknown): ExtractedContent | null {
  if (!isObject(obj)) return null;

  // Tool result format
  if ('tool' in obj && 'result' in obj) {
    const result = obj.result;
    if (typeof result === 'string') {
      return {
        text: result,
        type: 'tool-call',
        title: `Tool: ${obj.tool}`,
        metadata: { tool: obj.tool },
      };
    }
    // If result is an object, try to stringify it nicely
    if (isObject(result)) {
      return {
        text: JSON.stringify(result, null, 2),
        type: 'tool-call',
        title: `Tool: ${obj.tool}`,
        metadata: { tool: obj.tool },
      };
    }
  }

  // Function call format
  if ('function_call' in obj && isObject(obj.function_call)) {
    const fc = obj.function_call;
    if ('name' in fc && 'arguments' in fc) {
      const args = typeof fc.arguments === 'string'
        ? fc.arguments
        : JSON.stringify(fc.arguments, null, 2);
      return {
        text: args,
        type: 'tool-call',
        title: `Function: ${fc.name}`,
        metadata: { function: fc.name },
      };
    }
  }

  return null;
}

/**
 * Generic content extraction for other JSON structures
 * Looks for common content fields
 */
function extractGenericContent(obj: unknown): ExtractedContent | null {
  if (!isObject(obj)) return null;

  // Priority order for content fields
  const contentFields = ['text', 'content', 'message', 'body', 'data', 'output', 'response'];

  for (const field of contentFields) {
    if (field in obj) {
      const value = obj[field as keyof typeof obj];
      if (typeof value === 'string' && value.length > 10) {
        return {
          text: value,
          type: 'plain',
          metadata: { sourceField: field },
        };
      }
    }
  }

  // If object has a single string value, return it
  const values = Object.values(obj);
  if (values.length === 1 && typeof values[0] === 'string') {
    return {
      text: values[0],
      type: 'plain',
    };
  }

  return null;
}

/**
 * Process content that might be JSON or plain text
 * Returns rendered markdown-safe content
 */
export function processContent(content: string): string {
  const extracted = extractContent(content);

  if (extracted.type === 'plain') {
    return content;
  }

  // Format extracted content nicely
  let output = '';

  if (extracted.title) {
    output += `### ${extracted.title}\n\n`;
  }

  if (extracted.type === 'dalle-prompt') {
    output += `*Image Generation Prompt:*\n\n> ${extracted.text}\n`;
    if (extracted.metadata?.original_prompt) {
      output += `\n*Original prompt:* ${extracted.metadata.original_prompt}\n`;
    }
  } else if (extracted.type === 'artifact' && extracted.language) {
    output += `\`\`\`${extracted.language}\n${extracted.text}\n\`\`\`\n`;
  } else if (extracted.type === 'tool-call') {
    output += `\`\`\`\n${extracted.text}\n\`\`\`\n`;
  } else {
    output += extracted.text;
  }

  return output;
}

/**
 * Type guard for objects
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Detect if content looks like raw JSON that should be extracted
 */
export function looksLikeStructuredContent(content: string): boolean {
  const trimmed = content.trim();

  // Must start with { or [
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return false;
  }

  // Quick validation - try parsing
  try {
    const parsed = JSON.parse(trimmed);

    // If it's an object with known structured content markers
    if (isObject(parsed)) {
      // Check for known wrapper keys
      const wrapperMarkers = ['prompt', 'artifact', 'canvas', 'tool', 'function_call', 'document'];
      if (wrapperMarkers.some((m) => m in parsed)) {
        return true;
      }

      // Check for flat format: { "type": "document"|"code"|"text", "content": "..." }
      if ('type' in parsed && 'content' in parsed) {
        const docTypes = ['document', 'code', 'text'];
        if (docTypes.includes(parsed.type as string)) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }

  return false;
}

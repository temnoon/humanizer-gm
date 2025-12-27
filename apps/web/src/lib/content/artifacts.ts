/**
 * Artifact Extraction
 *
 * Extracts embedded artifacts from content:
 * - JSON code blocks that are actually structured data
 * - Anthropic artifacts (canvas, code)
 * - OpenAI canvases
 * - Image generation prompts
 */

import type { PreprocessResult, Artifact } from './types';

let artifactIdCounter = 0;

/**
 * Generate a unique artifact ID
 */
function generateArtifactId(): string {
  return `artifact-${Date.now()}-${artifactIdCounter++}`;
}

/**
 * Extract and unpack JSON artifacts from content
 *
 * Detects patterns like:
 * ```json
 * { "type": "artifact", "title": "...", "content": "..." }
 * ```
 *
 * And replaces them with collapsible placeholders
 */
export function unpackJsonArtifacts(input: PreprocessResult): PreprocessResult {
  let content = input.content;
  const artifacts: Artifact[] = [...input.artifacts];

  // Pattern to match JSON code blocks that look like artifacts
  const artifactPattern = /```json\s*\n(\{[\s\S]*?"type"\s*:\s*"(?:artifact|canvas|code|image-prompt)"[\s\S]*?\})\s*\n```/g;

  const replacements: Array<{ original: string; placeholder: string; artifact: Artifact }> = [];

  let match: RegExpExecArray | null;
  while ((match = artifactPattern.exec(content)) !== null) {
    const jsonStr = match[1];
    const originalMatch = match[0];
    const offset = match.index;

    try {
      const parsed = JSON.parse(jsonStr);

      const artifact: Artifact = {
        id: generateArtifactId(),
        type: parsed.type || 'artifact',
        title: parsed.title || parsed.name || 'Untitled',
        content: parsed.content || parsed.code || parsed.body || jsonStr,
        language: parsed.language,
        offset,
        length: originalMatch.length,
        placeholder: '', // Will be set below
        metadata: parsed,
      };

      // Create a placeholder that renders nicely
      const placeholder = `\n\n---\n**[${artifact.type.toUpperCase()}]** ${artifact.title}\n\n<details>\n<summary>View content</summary>\n\n\`\`\`${artifact.language || ''}\n${artifact.content}\n\`\`\`\n\n</details>\n\n---\n\n`;

      artifact.placeholder = placeholder;
      artifacts.push(artifact);

      replacements.push({
        original: originalMatch,
        placeholder,
        artifact,
      });
    } catch {
      // Not valid JSON or not an artifact pattern, skip
      continue;
    }
  }

  // Apply replacements (in reverse order to preserve offsets)
  for (const { original, placeholder } of replacements.reverse()) {
    content = content.replace(original, placeholder);
  }

  return {
    ...input,
    content,
    artifacts,
    stats: {
      ...input.stats,
      artifactsExtracted: input.stats.artifactsExtracted + replacements.length,
    },
  };
}

/**
 * Extract image generation prompts
 *
 * These often appear as JSON with prompt/size/style fields
 */
export function extractImagePrompts(input: PreprocessResult): PreprocessResult {
  let content = input.content;
  const artifacts: Artifact[] = [...input.artifacts];

  // Pattern for DALL-E style prompts in JSON
  const promptPattern = /```json\s*\n(\{[\s\S]*?"prompt"\s*:[\s\S]*?\})\s*\n```/g;

  const replacements: Array<{ original: string; placeholder: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = promptPattern.exec(content)) !== null) {
    const jsonStr = match[1];
    const originalMatch = match[0];
    const offset = match.index;

    // Skip if already processed as artifact
    if (artifacts.some(a => a.offset === offset)) continue;

    try {
      const parsed = JSON.parse(jsonStr);

      // Check if this looks like an image prompt
      if (!parsed.prompt) continue;

      const artifact: Artifact = {
        id: generateArtifactId(),
        type: 'image-prompt',
        title: 'Image Generation',
        content: parsed.prompt,
        offset,
        length: originalMatch.length,
        placeholder: '',
        metadata: {
          size: parsed.size,
          style: parsed.style,
          quality: parsed.quality,
          model: parsed.model,
        },
      };

      const placeholder = `\n\n> **Image Prompt:** "${parsed.prompt}"\n\n`;
      artifact.placeholder = placeholder;
      artifacts.push(artifact);

      replacements.push({ original: originalMatch, placeholder });
    } catch {
      continue;
    }
  }

  // Apply replacements
  for (const { original, placeholder } of replacements.reverse()) {
    content = content.replace(original, placeholder);
  }

  return {
    ...input,
    content,
    artifacts,
    stats: {
      ...input.stats,
      artifactsExtracted: input.stats.artifactsExtracted + replacements.length,
    },
  };
}

/**
 * Check if content contains extractable artifacts
 */
export function hasArtifacts(content: string): boolean {
  return /```json\s*\n\{[\s\S]*?"(?:type|prompt)"\s*:/.test(content);
}

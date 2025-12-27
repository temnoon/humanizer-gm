/**
 * Visual Model Service - Ollama Vision Model Integration
 *
 * Uses Ollama vision-capable models (qwen3-vl, llava) for:
 * - Image description (natural language captions)
 * - Image classification (category tags)
 * - Full image analysis (objects, scene, mood)
 *
 * @requires Ollama running with a vision model installed
 */

import * as fs from 'fs/promises';
import * as path from 'path';

const OLLAMA_BASE = 'http://localhost:11434';

// Ordered by preference - first available will be used
const VISION_MODELS = ['qwen3-vl:8b', 'llava:13b', 'llava'];

export interface ImageAnalysis {
  description: string;
  categories: string[];
  objects: string[];
  scene: string;
  mood: string;
  confidence: number;
  model: string;
  processingTimeMs: number;
}

export interface ClassificationResult {
  categories: string[];
  confidence: number;
  model: string;
}

export interface DescriptionResult {
  description: string;
  model: string;
  processingTimeMs: number;
}

/**
 * Check if Ollama vision is available and get the best model
 */
export async function getAvailableVisionModel(): Promise<string | null> {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const installedModels = data.models?.map((m: { name: string }) => m.name) || [];

    // Return first available vision model
    for (const model of VISION_MODELS) {
      if (installedModels.includes(model)) {
        return model;
      }
    }

    // Check for any model containing 'vl', 'llava', or 'vision'
    const visionModel = installedModels.find(
      (m: string) => m.includes('vl') || m.includes('llava') || m.includes('vision')
    );

    return visionModel || null;
  } catch {
    return null;
  }
}

/**
 * Convert image file to base64
 */
async function imageToBase64(imagePath: string): Promise<string> {
  const absolutePath = path.resolve(imagePath);
  const buffer = await fs.readFile(absolutePath);
  return buffer.toString('base64');
}

/**
 * Check if file is an image based on extension
 */
export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(ext);
}

/**
 * Call Ollama with an image for vision analysis
 */
async function callVisionModel(
  imagePath: string,
  prompt: string,
  options: {
    model?: string;
    timeout?: number;
  } = {}
): Promise<{ response: string; model: string; timeMs: number }> {
  const model = options.model || (await getAvailableVisionModel());
  if (!model) {
    throw new Error('No vision model available. Install qwen3-vl or llava with: ollama pull qwen3-vl:8b');
  }

  const imageBase64 = await imageToBase64(imagePath);
  const timeoutMs = options.timeout ?? 120000; // 2 minute default for vision

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        images: [imageBase64],
        stream: false,
        options: {
          temperature: 0.3, // Lower temp for more consistent outputs
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama vision failed: ${response.statusText} - ${error}`);
    }

    const data = await response.json();
    const timeMs = Date.now() - startTime;

    return {
      response: data.response || '',
      model,
      timeMs,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Vision model timed out after ${timeoutMs / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate a natural language description of an image
 */
export async function describeImage(
  imagePath: string,
  options: { model?: string; detailed?: boolean } = {}
): Promise<DescriptionResult> {
  const prompt = options.detailed
    ? `Describe this image in detail. Include:
- What is shown (objects, people, text visible)
- The setting and context
- Any notable details or composition elements
- The apparent purpose or meaning of the image

Provide a thorough but concise description.`
    : `Describe what you see in this image in 2-3 sentences. Be specific about the main subjects and context.`;

  const result = await callVisionModel(imagePath, prompt, { model: options.model });

  return {
    description: result.response.trim(),
    model: result.model,
    processingTimeMs: result.timeMs,
  };
}

/**
 * Classify an image into category tags
 */
export async function classifyImage(
  imagePath: string,
  options: { model?: string } = {}
): Promise<ClassificationResult> {
  const prompt = `Classify this image with category tags. Return ONLY a JSON array of tags.

Consider these category types:
- Content type: person, group, landscape, building, food, animal, art, document, screenshot
- Photo type: photo, screenshot, meme, diagram, artwork, scan, selfie
- Context: family, work, travel, event, casual, formal, outdoor, indoor

Return only a JSON array like: ["photo", "person", "outdoor", "travel"]
No explanation, just the JSON array.`;

  const result = await callVisionModel(imagePath, prompt, { model: options.model });

  let categories: string[] = [];
  try {
    // Try to parse as JSON
    const cleaned = result.response.trim().replace(/```json\n?|\n?```/g, '');
    categories = JSON.parse(cleaned);
    if (!Array.isArray(categories)) {
      categories = extractTagsFromText(result.response);
    }
  } catch {
    // Fall back to extracting tags from natural language
    categories = extractTagsFromText(result.response);
  }

  return {
    categories,
    confidence: categories.length > 0 ? 0.8 : 0.3,
    model: result.model,
  };
}

/**
 * Extract category tags from natural language response
 */
function extractTagsFromText(text: string): string[] {
  const knownCategories = [
    'person', 'people', 'group', 'family', 'friends',
    'landscape', 'building', 'architecture', 'nature',
    'food', 'animal', 'pet', 'dog', 'cat',
    'art', 'artwork', 'painting', 'drawing',
    'document', 'text', 'screenshot', 'meme',
    'photo', 'selfie', 'portrait',
    'travel', 'vacation', 'work', 'event', 'celebration',
    'outdoor', 'indoor', 'beach', 'mountain', 'city', 'urban', 'rural',
    'casual', 'formal', 'professional',
    'day', 'night', 'sunset', 'sunrise',
  ];

  const lowerText = text.toLowerCase();
  const found = knownCategories.filter((cat) => lowerText.includes(cat));

  // Deduplicate and limit
  return Array.from(new Set(found)).slice(0, 8);
}

/**
 * Full image analysis - description, categories, objects, scene, mood
 */
export async function analyzeImage(
  imagePath: string,
  options: { model?: string } = {}
): Promise<ImageAnalysis> {
  const prompt = `Analyze this image comprehensively. Return a JSON object with these fields:
{
  "description": "2-3 sentence description of what's shown",
  "categories": ["array", "of", "category", "tags"],
  "objects": ["main", "objects", "detected"],
  "scene": "scene type (indoor/outdoor/studio/nature/urban/etc)",
  "mood": "emotional tone (happy/serene/dramatic/professional/casual/etc)"
}

Return only valid JSON, no explanation.`;

  const startTime = Date.now();
  const result = await callVisionModel(imagePath, prompt, { model: options.model });

  let analysis: Partial<ImageAnalysis> = {};
  try {
    const cleaned = result.response.trim().replace(/```json\n?|\n?```/g, '');
    analysis = JSON.parse(cleaned);
  } catch {
    // Fall back to individual calls if JSON parsing fails
    const [desc, classify] = await Promise.all([
      describeImage(imagePath, { model: options.model }),
      classifyImage(imagePath, { model: options.model }),
    ]);

    analysis = {
      description: desc.description,
      categories: classify.categories,
      objects: [],
      scene: 'unknown',
      mood: 'neutral',
    };
  }

  return {
    description: analysis.description || '',
    categories: analysis.categories || [],
    objects: analysis.objects || [],
    scene: analysis.scene || 'unknown',
    mood: analysis.mood || 'neutral',
    confidence: 0.75,
    model: result.model,
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * Batch process multiple images
 */
export async function* processImages(
  imagePaths: string[],
  options: {
    model?: string;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
  } = {}
): AsyncGenerator<{ path: string; analysis: ImageAnalysis | null; error?: string }> {
  const concurrency = options.concurrency ?? 2; // Conservative for local models
  let completed = 0;

  // Process in batches
  for (let i = 0; i < imagePaths.length; i += concurrency) {
    const batch = imagePaths.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map(async (imagePath) => {
        const analysis = await analyzeImage(imagePath, { model: options.model });
        return { path: imagePath, analysis };
      })
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const imagePath = batch[j];
      completed++;

      if (result.status === 'fulfilled') {
        options.onProgress?.(completed, imagePaths.length);
        yield result.value;
      } else {
        options.onProgress?.(completed, imagePaths.length);
        yield { path: imagePath, analysis: null, error: result.reason?.message || 'Unknown error' };
      }
    }
  }
}

/**
 * Quick health check for vision service
 */
export async function checkVisionHealth(): Promise<{
  available: boolean;
  model: string | null;
  error?: string;
}> {
  try {
    const model = await getAvailableVisionModel();
    return {
      available: model !== null,
      model,
      error: model ? undefined : 'No vision model installed',
    };
  } catch (error) {
    return {
      available: false,
      model: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default {
  getAvailableVisionModel,
  describeImage,
  classifyImage,
  analyzeImage,
  processImages,
  checkVisionHealth,
  isImageFile,
};

/**
 * Vision Provider Types
 *
 * Unified interface for multi-modal image analysis across providers:
 * - Ollama (local)
 * - Cloudflare Workers AI
 * - OpenAI
 * - Anthropic
 */

// ═══════════════════════════════════════════════════════════════════
// PROVIDER TYPES
// ═══════════════════════════════════════════════════════════════════

export type VisionProviderType = 'ollama' | 'cloudflare' | 'openai' | 'anthropic';

export interface VisionProviderConfig {
  type: VisionProviderType;
  endpoint?: string;          // API endpoint (optional, has defaults)
  apiKey?: string;            // API key for cloud providers
  model?: string;             // Model override
  timeout?: number;           // Request timeout in ms
  maxRetries?: number;        // Retry count on failure
}

// ═══════════════════════════════════════════════════════════════════
// MODEL CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export interface VisionModelConfig {
  modelId: string;
  displayName: string;
  provider: VisionProviderType;

  // Model capabilities
  supportsMultipleImages: boolean;
  maxImageSize?: number;      // Max bytes per image
  supportedFormats: string[]; // ['jpeg', 'png', 'webp', 'gif']

  // Vetting info
  vetted: boolean;
  vettedDate?: string;

  // Output filtering strategy
  outputStrategy: VisionOutputStrategy;

  // Known output patterns to filter
  patterns: {
    thinkingTags: string[];
    preamblePhrases: string[];
    closingPhrases: string[];
  };

  notes?: string;
}

export type VisionOutputStrategy =
  | 'xml-tags'      // Strip <think>, <reasoning> blocks
  | 'heuristic'     // Strip conversational preambles/closings
  | 'structured'    // Extract from JSON structure
  | 'json-block'    // Extract JSON from markdown code block
  | 'none';         // No filtering needed

// ═══════════════════════════════════════════════════════════════════
// REQUEST/RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════

export interface VisionRequest {
  // Image data (one of these required)
  imageBuffer?: Buffer;
  imageBase64?: string;
  imageUrl?: string;

  // Analysis options
  prompt?: string;            // Custom prompt (uses default if not provided)
  systemPrompt?: string;      // System prompt override
  temperature?: number;       // 0.0-1.0, lower = more deterministic
  maxTokens?: number;         // Max response tokens

  // Output format
  outputFormat?: 'json' | 'text';
  jsonSchema?: Record<string, unknown>;  // Expected JSON structure
}

export interface VisionResult {
  // Core analysis
  description: string;
  categories: string[];
  objects: string[];
  scene: string;
  mood?: string;

  // Confidence and metadata
  confidence: number;
  model: string;
  provider: VisionProviderType;
  processingTimeMs: number;

  // Raw output (for debugging)
  rawOutput?: string;

  // Filtering info
  filtered: boolean;
  filterStrategy?: VisionOutputStrategy;
  hadThinkingTags?: boolean;
  hadPreamble?: boolean;
}

export interface VisionError {
  code: string;
  message: string;
  provider: VisionProviderType;
  model?: string;
  retryable: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// PROVIDER INTERFACE
// ═══════════════════════════════════════════════════════════════════

export interface VisionProvider {
  readonly type: VisionProviderType;
  readonly defaultModel: string;

  /**
   * Check if provider is available and configured
   */
  isAvailable(): Promise<boolean>;

  /**
   * List available models for this provider
   */
  listModels(): Promise<string[]>;

  /**
   * Analyze an image
   */
  analyze(request: VisionRequest, model?: string): Promise<VisionResult>;

  /**
   * Get provider configuration
   */
  getConfig(): VisionProviderConfig;
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT TEMPLATES
// ═══════════════════════════════════════════════════════════════════

export interface VisionPromptTemplate {
  name: string;
  systemPrompt?: string;
  userPrompt: string;
  outputFormat: 'json' | 'text';
  jsonSchema?: Record<string, unknown>;
}

export const DEFAULT_ANALYSIS_PROMPT: VisionPromptTemplate = {
  name: 'image-analysis',
  systemPrompt: `You are an image analysis assistant. Analyze images and provide structured descriptions.
Always respond with valid JSON. Do not include any text before or after the JSON.`,
  userPrompt: `Analyze this image and provide:
1. A detailed description (2-3 sentences)
2. Categories (tags like: photo, artwork, screenshot, nature, people, food, etc.)
3. Objects visible in the image
4. Scene type (indoor, outdoor, studio, nature, urban, abstract, or unknown)
5. Mood/emotion conveyed (if applicable)

Respond ONLY with this JSON format, no other text:
{
  "description": "...",
  "categories": ["...", "..."],
  "objects": ["...", "..."],
  "scene": "...",
  "mood": "..."
}`,
  outputFormat: 'json',
  jsonSchema: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      categories: { type: 'array', items: { type: 'string' } },
      objects: { type: 'array', items: { type: 'string' } },
      scene: { type: 'string' },
      mood: { type: 'string' },
    },
    required: ['description', 'categories', 'objects', 'scene'],
  },
};

// ═══════════════════════════════════════════════════════════════════
// FACTORY TYPES
// ═══════════════════════════════════════════════════════════════════

export interface VisionProviderFactory {
  /**
   * Create a provider instance
   */
  create(config: VisionProviderConfig): VisionProvider;

  /**
   * Get the best available provider
   */
  getBestProvider(): Promise<VisionProvider | null>;

  /**
   * List all configured providers
   */
  listProviders(): VisionProviderType[];
}

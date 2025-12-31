/**
 * AgentMaster Types
 *
 * Unified LLM abstraction layer with:
 * - Tiered prompts based on device memory
 * - Automatic output vetting
 * - Model-agnostic capability routing
 */

import type { OutputStrategy, AIProviderType, AIResponse } from '../ai-control/types';

// ═══════════════════════════════════════════════════════════════════
// MEMORY TIERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Device memory tier determines prompt size and model selection
 *
 * tiny:     <8GB RAM  - Very short prompts, small models (llama3.2:1b)
 * standard: 8-16GB    - Balanced prompts, medium models (llama3.2:3b)
 * full:     >16GB     - Full prompts, any model
 */
export type MemoryTier = 'tiny' | 'standard' | 'full';

/**
 * Device profile - auto-detected or user-configured
 */
export interface DeviceProfile {
  /** Current memory tier */
  tier: MemoryTier;

  /** Total RAM in GB */
  ramGB: number;

  /** GPU VRAM in GB (if applicable) */
  gpuVRAMGB?: number;

  /** Prefer local models over cloud APIs */
  preferLocal: boolean;

  /** When this profile was detected */
  detectedAt: number;

  /** User override (if manually set) */
  userOverride?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// TIERED PROMPTS
// ═══════════════════════════════════════════════════════════════════

/**
 * A single prompt variant for a specific tier
 */
export interface PromptVariant {
  /** Which tier this variant is for */
  tier: MemoryTier;

  /** The system prompt content */
  systemPrompt: string;

  /** Approximate token count of prompt */
  tokenEstimate: number;

  /** Default max output tokens */
  maxTokens: number;

  /** Temperature for this tier */
  temperature?: number;

  /** Additional instructions to append */
  suffix?: string;
}

/**
 * Complete tiered prompt definition for a capability
 */
export interface TieredPromptDefinition {
  /** Capability ID (e.g., 'chat', 'humanizer') */
  capability: string;

  /** Human-readable name */
  name: string;

  /** Description of what this capability does */
  description: string;

  /** Prompt variants by tier */
  variants: {
    tiny: PromptVariant;
    standard: PromptVariant;
    full: PromptVariant;
  };

  /** Optional user prompt template (for wrapping user input) */
  userPromptTemplate?: string;

  /** Variables that can be interpolated into prompts */
  variables?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// VETTING PROFILES
// ═══════════════════════════════════════════════════════════════════

/**
 * Model-specific output vetting profile
 */
export interface VettingProfile {
  /** Model ID pattern (regex) */
  modelPattern: RegExp;

  /** Human-readable model name(s) */
  modelName: string;

  /** Provider this profile applies to */
  provider?: AIProviderType;

  /** Output filtering strategy */
  outputStrategy: OutputStrategy;

  /** Thinking tags to strip (e.g., '<think>', '</think>') */
  thinkingTags?: string[];

  /** Preamble phrases to remove (e.g., 'Here is the rewritten text:') */
  preamblePhrases?: string[];

  /** Closing phrases to remove (e.g., 'Let me know if you need anything else') */
  closingPhrases?: string[];

  /** Whether this profile has been vetted/tested */
  vetted: boolean;

  /** Date profile was last tested */
  vettedDate?: string;

  /** Notes about this model's behavior */
  notes?: string;
}

/**
 * Result of output filtering
 */
export interface VettingResult {
  /** Cleaned output content */
  content: string;

  /** Original raw output */
  raw: string;

  /** Strategy that was applied */
  strategy: OutputStrategy;

  /** What was stripped */
  stripped: {
    thinkingTags: boolean;
    preamble: boolean;
    closing: boolean;
  };

  /** Whether vetting succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// AGENT MASTER REQUEST/RESPONSE
// ═══════════════════════════════════════════════════════════════════

/**
 * Message in a conversation
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Request to AgentMaster
 */
export interface AgentMasterRequest {
  /** Capability to invoke (e.g., 'chat', 'humanizer', 'translation') */
  capability: string;

  /** Input text/content (current user message) */
  input: string;

  /** Conversation history (previous messages) */
  messages?: ConversationMessage[];

  /** Capability-specific parameters */
  params?: Record<string, unknown>;

  /** User ID for preferences and tracking */
  userId?: string;

  /** Session ID for context */
  sessionId?: string;

  /** Force a specific tier (overrides auto-detection) */
  forceTier?: MemoryTier;

  /** Force a specific model (for debugging) */
  forceModel?: string;

  /** Force a specific provider */
  forceProvider?: AIProviderType;

  /** Skip output vetting */
  skipVetting?: boolean;

  /** Stream the response */
  stream?: boolean;

  /** Token callback for streaming */
  onToken?: (token: string) => void;

  /** Variables to interpolate into prompts */
  variables?: Record<string, string>;
}

/**
 * Response from AgentMaster
 */
export interface AgentMasterResponse {
  /** Cleaned output content */
  output: string;

  /** Raw output before vetting (if different) */
  raw?: string;

  /** Model that was used */
  modelUsed: string;

  /** Provider that was used */
  providerUsed: AIProviderType;

  /** Memory tier that was used */
  tier: MemoryTier;

  /** Whether output was vetted */
  vetted: boolean;

  /** Vetting strategy applied */
  vettingStrategy?: OutputStrategy;

  /** What was stripped during vetting */
  vettingStripped?: {
    thinkingTags: boolean;
    preamble: boolean;
    closing: boolean;
  };

  /** Token usage */
  inputTokens: number;
  outputTokens: number;

  /** Processing time in milliseconds */
  processingTimeMs: number;

  /** Cost estimate (if available) */
  cost?: number;

  /** Request ID for tracking */
  requestId: string;

  /**
   * Teaching output for AUI - explains what happened
   */
  teaching?: {
    /** What this operation accomplished */
    whatHappened: string;

    /** Which prompt tier was used and why */
    promptTierUsed: MemoryTier;

    /** Which model was selected and why */
    modelSelected: string;

    /** What vetting was applied */
    vettingApplied: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE INTERFACE
// ═══════════════════════════════════════════════════════════════════

/**
 * AgentMaster service interface
 */
export interface AgentMasterService {
  /**
   * Execute a capability request
   */
  execute(request: AgentMasterRequest): Promise<AgentMasterResponse>;

  /**
   * Stream a capability request
   */
  stream(request: AgentMasterRequest): AsyncGenerator<string, AgentMasterResponse>;

  /**
   * Get current device profile
   */
  getDeviceProfile(): DeviceProfile;

  /**
   * Set device profile (user override)
   */
  setDeviceProfile(profile: Partial<DeviceProfile>): void;

  /**
   * Get prompt for a capability and tier
   */
  getPrompt(capability: string, tier?: MemoryTier): PromptVariant | undefined;

  /**
   * Get vetting profile for a model
   */
  getVettingProfile(modelId: string): VettingProfile | undefined;

  /**
   * List available capabilities
   */
  listCapabilities(): string[];

  /**
   * Check if a capability is available
   */
  isCapabilityAvailable(capability: string): Promise<boolean>;

  /**
   * Force re-detection of device profile
   */
  redetectDevice(): Promise<DeviceProfile>;
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT ENGINE TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Prompt engine configuration
 */
export interface PromptEngineConfig {
  /** Fallback tier if auto-detection fails */
  fallbackTier: MemoryTier;

  /** Allow user tier override */
  allowTierOverride: boolean;

  /** Max tokens for tiny tier prompts */
  tinyMaxPromptTokens: number;

  /** Max tokens for standard tier prompts */
  standardMaxPromptTokens: number;
}

/**
 * Result of prompt selection
 */
export interface PromptSelection {
  /** Selected prompt variant */
  prompt: PromptVariant;

  /** Selected tier */
  tier: MemoryTier;

  /** Why this tier was selected */
  reason: 'auto-detected' | 'user-override' | 'force-param' | 'fallback';

  /** Interpolated system prompt (with variables filled) */
  systemPrompt: string;

  /** User prompt (if templated) */
  userPrompt?: string;
}

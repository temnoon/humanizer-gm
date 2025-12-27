/**
 * AI Master Control - Core Types
 *
 * The "House of Houses" - unified interface for all AI model interactions
 * across the humanizer ecosystem.
 *
 * Design principles:
 * - Software requests capabilities, not specific models
 * - Users configure model preferences per capability class
 * - Admin sets system defaults, budgets, safety
 * - Safety layer is immutable - cannot be bypassed
 */

// ═══════════════════════════════════════════════════════════════════
// PROVIDER TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Supported AI providers
 */
export type AIProviderType =
  | 'ollama'       // Local inference
  | 'openai'       // OpenAI API
  | 'anthropic'    // Anthropic API
  | 'cloudflare'   // Cloudflare Workers AI
  | 'google'       // Google AI (Gemini)
  | 'cohere'       // Cohere API
  | 'mistral'      // Mistral API
  | 'groq'         // Groq API
  | 'together'     // Together AI
  | 'deepseek'     // DeepSeek API
  | 'local'        // Custom local endpoint
  | 'custom';      // Custom remote endpoint

/**
 * Provider configuration
 */
export interface AIProviderConfig {
  type: AIProviderType;
  endpoint?: string;
  apiKey?: string;
  organizationId?: string;
  timeout?: number;
  maxRetries?: number;
  rateLimitRPM?: number;  // Requests per minute
  enabled: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// CAPABILITY CLASSES
// ═══════════════════════════════════════════════════════════════════

/**
 * Built-in capability class IDs
 */
export type BuiltInCapability =
  | 'translation'     // Language translation
  | 'coding'          // Code generation/review
  | 'creative'        // Creative writing
  | 'analysis'        // Text analysis
  | 'summarization'   // Document summarization
  | 'ocr'             // Image text extraction
  | 'vision'          // Image understanding
  | 'embedding'       // Text embeddings
  | 'humanizer'       // AI detection evasion
  | 'detection'       // AI content detection
  | 'chat'            // Conversational AI
  | 'reasoning'       // Complex reasoning
  | 'extraction'      // Structured data extraction
  | 'classification'; // Text/content classification

/**
 * Capability class definition
 */
export interface ModelClass {
  id: string;               // 'translation', 'coding', or custom
  name: string;             // 'Language Translation'
  description: string;      // What this class is for
  category: 'text' | 'vision' | 'embedding' | 'multimodal';

  // Ranked model preferences (first = highest priority)
  models: ModelPreference[];

  // Prompt injection for this class
  systemPromptPrefix?: string;
  systemPromptSuffix?: string;

  // Class-specific constraints
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  maxInputTokens?: number;

  // Safety level for this class
  safetyLevel: SafetyLevel;

  // Whether this is a built-in or user-defined class
  builtIn: boolean;

  // Version for migration
  version: number;
}

/**
 * Model preference within a class
 */
export interface ModelPreference {
  modelId: string;          // 'gpt-4o', 'claude-3.5-sonnet', 'qwen3:14b'
  provider: AIProviderType;
  priority: number;         // Lower = higher priority

  // Conditions for using this model
  conditions?: ModelConditions;

  // Model-specific prompt adjustments
  promptOverride?: {
    systemPrefix?: string;
    systemSuffix?: string;
    userPrefix?: string;
    userSuffix?: string;
  };

  // Output filtering strategy (for models with artifacts)
  outputStrategy?: OutputStrategy;
}

/**
 * Conditions for model selection
 */
export interface ModelConditions {
  maxInputTokens?: number;    // Only use if input <= this
  minInputTokens?: number;    // Only use if input >= this
  onlyIfAvailable?: boolean;  // Skip if provider unavailable
  costTier?: CostTier;        // Cost constraint
  requiresLocal?: boolean;    // Must be local inference
  requiresPrivate?: boolean;  // No cloud API calls
  timeOfDay?: {               // Time-based routing
    start: string;            // '09:00'
    end: string;              // '17:00'
  };
}

export type CostTier = 'free' | 'low' | 'medium' | 'high' | 'premium';
export type SafetyLevel = 'strict' | 'standard' | 'creative' | 'unrestricted';

/**
 * Output filtering strategies
 */
export type OutputStrategy =
  | 'none'        // Clean output, no filtering
  | 'xml-tags'    // Strip <think>, <reasoning> blocks
  | 'heuristic'   // Strip conversational preambles
  | 'json-block'  // Extract JSON from code blocks
  | 'structured'; // Extract from structured output

// ═══════════════════════════════════════════════════════════════════
// USER PROFILE
// ═══════════════════════════════════════════════════════════════════

/**
 * User AI preferences - injected into all model calls
 */
export interface UserAIProfile {
  userId: string;
  displayName?: string;

  // Global preferences
  preferLocalModels: boolean;       // Privacy-first
  preferFastModels: boolean;        // Speed over quality
  preferCheapModels: boolean;       // Cost over quality

  // Budget controls
  dailyBudget?: number;             // Max spend per day (USD)
  monthlyBudget?: number;           // Max spend per month
  currentDailySpend?: number;       // Tracked spend today
  currentMonthlySpend?: number;     // Tracked spend this month

  // Language preferences
  preferredLanguage: string;        // 'en', 'es', 'zh'
  secondaryLanguages?: string[];    // Fallback languages

  // Writing style preferences
  writingStyle?: WritingStyle;
  verbosity?: Verbosity;
  formality?: Formality;

  // Per-class overrides
  classOverrides: Record<string, ClassOverride>;

  // Universal prompt additions (added to ALL calls)
  globalSystemPrefix?: string;
  globalSystemSuffix?: string;
  globalUserPrefix?: string;
  globalUserSuffix?: string;

  // Disabled capabilities
  disabledClasses?: string[];       // Classes user cannot use

  // Profile metadata
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type WritingStyle =
  | 'formal'
  | 'casual'
  | 'academic'
  | 'creative'
  | 'technical'
  | 'journalistic';

export type Verbosity =
  | 'concise'
  | 'balanced'
  | 'detailed'
  | 'verbose';

export type Formality =
  | 'very-formal'
  | 'formal'
  | 'neutral'
  | 'informal'
  | 'casual';

/**
 * Per-class override in user profile
 */
export interface ClassOverride {
  modelId?: string;           // Force specific model
  provider?: AIProviderType;  // Force specific provider
  disabled?: boolean;         // Disable this class for user
  customSystemPrompt?: string;// Full system prompt override
  temperature?: number;       // Temperature override
  maxTokens?: number;         // Max tokens override
}

// ═══════════════════════════════════════════════════════════════════
// ADMIN CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

/**
 * System-wide AI configuration (admin only)
 */
export interface SystemAIConfig {
  // Version for migrations
  version: number;
  updatedAt: string;
  updatedBy?: string;

  // Bootstrap defaults for new users
  defaultProfile: Partial<UserAIProfile>;

  // Provider configuration
  providers: Record<AIProviderType, AIProviderConfig>;
  enabledProviders: AIProviderType[];

  // Model whitelist/blacklist
  allowedModels?: string[];     // If set, only these models allowed
  blockedModels?: string[];     // These models are never used

  // Default model classes
  modelClasses: Record<string, ModelClass>;

  // Cost controls (system-wide)
  globalDailyBudget?: number;
  globalMonthlyBudget?: number;
  perUserDailyBudget?: number;
  perUserMonthlyBudget?: number;

  // Rate limiting
  globalRateLimitRPM?: number;
  perUserRateLimitRPM?: number;

  // Fallback chain when preferred model unavailable
  globalFallbackChain: string[];

  // Safety configuration (CANNOT be overridden by users)
  safety: SafetyConfig;

  // Audit settings
  audit: AuditConfig;

  // Storage/indexing defaults
  storage: StorageConfig;
}

/**
 * Immutable safety configuration
 * These settings CANNOT be disabled by users or overridden
 */
export interface SafetyConfig {
  // Content filtering (always on, level configurable)
  contentFiltering: 'strict' | 'standard';

  // PII detection and redaction
  piiDetection: boolean;
  piiRedaction: boolean;

  // Prompt injection protection
  blockPromptInjection: true;  // Literal true - cannot be false

  // Jailbreak attempt detection
  blockJailbreakAttempts: true;

  // Malware generation prevention
  blockMalwareGeneration: true;

  // Harmful content prevention
  blockHarmfulContent: true;

  // Rate limiting (always active)
  rateLimitPerUser: true;
  rateLimitPerIP: true;

  // Audit logging (always on)
  auditAllRequests: true;
  auditAllResponses: true;

  // Optional: Custom safety rules
  customRules?: SafetyRule[];
}

export interface SafetyRule {
  id: string;
  name: string;
  pattern: string;        // Regex pattern to detect
  action: 'block' | 'warn' | 'log';
  message?: string;       // Message to user if blocked
}

/**
 * Audit configuration
 */
export interface AuditConfig {
  enabled: boolean;
  logRequests: boolean;
  logResponses: boolean;
  logTokenUsage: boolean;
  logCosts: boolean;
  logErrors: boolean;
  retentionDays: number;
  exportFormat: 'json' | 'csv' | 'sqlite';
}

/**
 * Storage and indexing configuration
 */
export interface StorageConfig {
  // Embedding provider
  embeddingProvider: AIProviderType;
  embeddingModel: string;
  embeddingDimensions: number;

  // Vector database
  vectorStore: 'chroma' | 'pinecone' | 'qdrant' | 'sqlite-vec' | 'local';
  vectorStoreConfig?: Record<string, unknown>;

  // Indexing behavior
  autoIndexNewContent: boolean;
  indexingBatchSize: number;
  indexingConcurrency: number;

  // Chunking settings
  chunkSize: number;
  chunkOverlap: number;
  chunkStrategy: 'fixed' | 'sentence' | 'paragraph' | 'semantic';

  // Retention
  retentionDays?: number;
  maxStorageGB?: number;
}

// ═══════════════════════════════════════════════════════════════════
// REQUEST/RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * AI capability request - software calls capabilities, not models
 */
export interface AIRequest {
  // What capability to use
  capability: string;       // 'translation', 'coding', or custom class ID

  // Input content
  input: string | AIMultimodalInput;

  // Task-specific parameters
  params?: Record<string, unknown>;

  // Optional overrides (subject to user permissions)
  modelOverride?: string;
  providerOverride?: AIProviderType;
  temperatureOverride?: number;
  maxTokensOverride?: number;

  // Request metadata
  requestId?: string;
  userId?: string;
  sessionId?: string;

  // Streaming
  stream?: boolean;
  onToken?: (token: string) => void;
}

export interface AIMultimodalInput {
  text?: string;
  images?: Array<{
    data: Buffer | string;  // Buffer or base64
    mimeType: string;
  }>;
  audio?: Array<{
    data: Buffer | string;
    mimeType: string;
  }>;
  documents?: Array<{
    data: Buffer | string;
    mimeType: string;
    filename?: string;
  }>;
}

/**
 * AI capability response
 */
export interface AIResponse {
  // Response content
  output: string;

  // Structured output (if requested)
  structured?: Record<string, unknown>;

  // What was actually used
  modelUsed: string;
  providerUsed: AIProviderType;
  capabilityUsed: string;

  // Token usage
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;

  // Cost (if trackable)
  cost?: number;

  // Performance
  processingTimeMs: number;

  // Filtering applied
  filtered: boolean;
  filterStrategy?: OutputStrategy;

  // Safety
  safetyTriggered: boolean;
  safetyWarnings?: string[];

  // Metadata
  requestId: string;
  timestamp: string;
}

/**
 * AI streaming response chunk
 */
export interface AIStreamChunk {
  token: string;
  done: boolean;
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
}

// ═══════════════════════════════════════════════════════════════════
// ROUTER TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Router decision - explains why a model was selected
 */
export interface RouterDecision {
  selectedModel: string;
  selectedProvider: AIProviderType;
  reason: RouterReason;
  fallbacksAttempted?: string[];
  constraints: {
    userBudgetOk: boolean;
    systemBudgetOk: boolean;
    providerAvailable: boolean;
    modelAllowed: boolean;
    safetyCleared: boolean;
  };
}

export type RouterReason =
  | 'user_preference'      // User's top-ranked model for class
  | 'user_override'        // User explicitly requested this model
  | 'admin_override'       // Admin forced this model
  | 'fallback'             // Primary unavailable, using fallback
  | 'budget_constraint'    // Cheaper model due to budget
  | 'availability'         // Only available option
  | 'local_preference'     // User prefers local, using local
  | 'privacy_requirement'; // Privacy requires local

// ═══════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════

/**
 * AI Control events for monitoring/auditing
 */
export type AIControlEvent =
  | { type: 'request'; request: AIRequest; decision: RouterDecision }
  | { type: 'response'; response: AIResponse }
  | { type: 'error'; error: AIControlError; request: AIRequest }
  | { type: 'safety_block'; request: AIRequest; reason: string }
  | { type: 'budget_exceeded'; userId: string; budgetType: 'daily' | 'monthly' }
  | { type: 'rate_limited'; userId: string; provider: AIProviderType }
  | { type: 'fallback'; from: string; to: string; reason: string };

export interface AIControlError {
  code: string;
  message: string;
  provider?: AIProviderType;
  model?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE INTERFACE
// ═══════════════════════════════════════════════════════════════════

/**
 * AI Master Control service interface
 */
export interface AIControlService {
  /**
   * Call an AI capability
   */
  call(request: AIRequest): Promise<AIResponse>;

  /**
   * Stream an AI capability response
   */
  stream(request: AIRequest): AsyncGenerator<AIStreamChunk>;

  /**
   * Check if a capability is available
   */
  isCapabilityAvailable(capability: string): Promise<boolean>;

  /**
   * List available capabilities for current user
   */
  listCapabilities(): Promise<ModelClass[]>;

  /**
   * Get routing decision without executing
   */
  previewRouting(request: AIRequest): Promise<RouterDecision>;

  /**
   * Get user's current budget status
   */
  getBudgetStatus(userId: string): Promise<BudgetStatus>;

  /**
   * Update user profile
   */
  updateUserProfile(userId: string, updates: Partial<UserAIProfile>): Promise<void>;

  /**
   * Get user profile
   */
  getUserProfile(userId: string): Promise<UserAIProfile>;
}

export interface BudgetStatus {
  dailyLimit?: number;
  dailyUsed: number;
  dailyRemaining?: number;
  monthlyLimit?: number;
  monthlyUsed: number;
  monthlyRemaining?: number;
  isOverBudget: boolean;
}

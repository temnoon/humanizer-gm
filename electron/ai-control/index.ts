/**
 * AI Master Control
 *
 * The "House of Houses" - unified interface for all AI model interactions
 * across the humanizer ecosystem.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { ai } from './ai-control';
 *
 * // Call a capability - router finds best model
 * const result = await ai.call({
 *   capability: 'translation',
 *   input: 'Hello world',
 *   params: { targetLanguage: 'es' },
 * });
 *
 * // Preview routing without execution
 * const decision = await ai.preview({
 *   capability: 'coding',
 *   input: 'Write a function...',
 * });
 *
 * // Check capability availability
 * const available = await ai.isAvailable('vision');
 *
 * // List all capabilities
 * const capabilities = await ai.listCapabilities();
 * ```
 *
 * ## Architecture
 *
 * 1. **Software requests capabilities, not models**
 *    - ai.call('translation', ...) not ai.call('gpt-4o', ...)
 *
 * 2. **Router resolves to best available model**
 *    - User preferences
 *    - Admin configuration
 *    - Provider availability
 *    - Budget constraints
 *
 * 3. **Safety layer is immutable**
 *    - Cannot be disabled
 *    - Runs on every request
 *
 * 4. **Audit logging is always on**
 *    - All requests logged
 *    - All responses logged
 */

// ═══════════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════════

export type {
  // Provider types
  AIProviderType,
  AIProviderConfig,

  // Model class types
  BuiltInCapability,
  ModelClass,
  ModelPreference,
  ModelConditions,
  CostTier,
  SafetyLevel,
  OutputStrategy,

  // User profile types
  UserAIProfile,
  ClassOverride,
  WritingStyle,
  Verbosity,
  Formality,

  // Admin config types
  SystemAIConfig,
  SafetyConfig,
  AuditConfig,
  StorageConfig,
  SafetyRule,

  // Request/Response types
  AIRequest,
  AIResponse,
  AIStreamChunk,
  AIMultimodalInput,
  AIControlError,

  // Router types
  RouterDecision,
  RouterReason,
  BudgetStatus,

  // Event types
  AIControlEvent,

  // Service interface
  AIControlService as IAIControlService,
} from './types';

// ═══════════════════════════════════════════════════════════════════
// MODEL CLASSES
// ═══════════════════════════════════════════════════════════════════

export {
  DEFAULT_MODEL_CLASSES,
  TRANSLATION_CLASS,
  CODING_CLASS,
  CREATIVE_CLASS,
  ANALYSIS_CLASS,
  SUMMARIZATION_CLASS,
  OCR_CLASS,
  VISION_CLASS,
  EMBEDDING_CLASS,
  HUMANIZER_CLASS,
  DETECTION_CLASS,
  CHAT_CLASS,
  REASONING_CLASS,
  EXTRACTION_CLASS,
  CLASSIFICATION_CLASS,
  getModelClass,
  listBuiltInCapabilities,
  createCustomClass,
} from './model-classes';

// ═══════════════════════════════════════════════════════════════════
// USER PROFILE
// ═══════════════════════════════════════════════════════════════════

export {
  DEFAULT_USER_PROFILE,
  UserProfileManager,
  getProfileManager,
  injectProfileIntoPrompt,
} from './user-profile';

// ═══════════════════════════════════════════════════════════════════
// ADMIN CONFIG
// ═══════════════════════════════════════════════════════════════════

export {
  createDefaultConfig,
  AdminConfigManager,
  getAdminConfig,
} from './admin-config';

// ═══════════════════════════════════════════════════════════════════
// SAFETY
// ═══════════════════════════════════════════════════════════════════

export {
  IMMUTABLE_SAFETY,
  runSafetyChecks,
  checkOutputSafety,
  checkRateLimit,
  clearRateLimits,
  auditLog,
  flushAuditBuffer,
  getAuditBuffer,
} from './safety';

export type {
  SafetyCheckResult,
  SafetyViolation,
  PIIDetection,
  AuditEntry,
} from './safety';

// ═══════════════════════════════════════════════════════════════════
// ROUTER & SERVICE
// ═══════════════════════════════════════════════════════════════════

export {
  AIRouter,
  AIControlService,
  getAIControlService,
  callCapability,
  clearProviderCache,
} from './router';

// ═══════════════════════════════════════════════════════════════════
// STORAGE CONFIG
// ═══════════════════════════════════════════════════════════════════

export {
  EMBEDDING_MODELS,
  VECTOR_STORES,
  CHUNKING_STRATEGIES,
  StorageConfigManager,
  getStorageConfig,
} from './storage-config';

export type {
  EmbeddingModelProfile,
  VectorStoreProfile,
  ChunkingStrategy,
} from './storage-config';

// ═══════════════════════════════════════════════════════════════════
// SECURE STORAGE
// ═══════════════════════════════════════════════════════════════════

export {
  SecureAPIKeyStorage,
  getSecureStorage,
  initSecureStorage,
} from './secure-storage';

// ═══════════════════════════════════════════════════════════════════
// CONVENIENCE API
// ═══════════════════════════════════════════════════════════════════

import type { AIRequest, AIResponse, RouterDecision, ModelClass, BudgetStatus } from './types';
import { getAIControlService } from './router';
import { getAdminConfig } from './admin-config';
import { getProfileManager } from './user-profile';

/**
 * Simplified AI control interface
 */
export const ai = {
  /**
   * Call an AI capability
   *
   * @example
   * const result = await ai.call({
   *   capability: 'translation',
   *   input: 'Hello world',
   *   params: { targetLanguage: 'es' },
   * });
   */
  async call(request: AIRequest): Promise<AIResponse> {
    return getAIControlService().call(request);
  },

  /**
   * Stream an AI capability response
   */
  stream(request: AIRequest) {
    return getAIControlService().stream(request);
  },

  /**
   * Preview routing decision without execution
   */
  async preview(request: AIRequest): Promise<RouterDecision> {
    return getAIControlService().previewRouting(request);
  },

  /**
   * Check if a capability is available
   */
  async isAvailable(capability: string): Promise<boolean> {
    return getAIControlService().isCapabilityAvailable(capability);
  },

  /**
   * List all available capabilities
   */
  async listCapabilities(userId?: string): Promise<ModelClass[]> {
    return getAIControlService().listCapabilities(userId);
  },

  /**
   * Get user's budget status
   */
  async getBudget(userId: string): Promise<BudgetStatus> {
    return getAIControlService().getBudgetStatus(userId);
  },

  /**
   * Get admin config manager
   */
  get admin() {
    return getAdminConfig();
  },

  /**
   * Get user profile manager
   */
  get profiles() {
    return getProfileManager();
  },
};

// Default export for convenience
export default ai;

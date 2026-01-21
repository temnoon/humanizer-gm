/**
 * AI Request Router
 *
 * Routes capability requests to the best available model based on:
 * 1. User preferences (class overrides, model rankings)
 * 2. Admin configuration (allowed models, budgets)
 * 3. Provider availability
 * 4. Cost constraints
 * 5. Safety requirements
 *
 * Software calls capabilities: router.resolve('translation', request)
 * Router returns the best model to use.
 */

import type {
  AIRequest,
  AIResponse,
  AIProviderType,
  ModelClass,
  ModelPreference,
  UserAIProfile,
  SystemAIConfig,
  RouterDecision,
  RouterReason,
  AIControlEvent,
  AIStreamChunk,
  BudgetStatus,
} from './types';
import { getProfileManager } from './user-profile';
import { getAdminConfig } from './admin-config';
import { runSafetyChecks, checkRateLimit, auditLog } from './safety';
import {
  callProvider,
  streamProvider,
  type LLMMessage,
  type ProviderConfig,
} from './providers';

// ═══════════════════════════════════════════════════════════════════
// PROVIDER AVAILABILITY CACHE
// ═══════════════════════════════════════════════════════════════════

interface ProviderStatus {
  available: boolean;
  checkedAt: number;
  error?: string;
}

const providerStatusCache = new Map<AIProviderType, ProviderStatus>();
const STATUS_TTL = 60000; // 1 minute cache

/**
 * Check if a provider is available (with caching)
 */
async function isProviderAvailable(
  provider: AIProviderType,
  config: SystemAIConfig
): Promise<boolean> {
  const cached = providerStatusCache.get(provider);
  const now = Date.now();

  if (cached && now - cached.checkedAt < STATUS_TTL) {
    return cached.available;
  }

  // Check if provider is enabled
  const providerConfig = config.providers[provider];
  if (!providerConfig?.enabled) {
    providerStatusCache.set(provider, { available: false, checkedAt: now });
    return false;
  }

  // For API providers, check if API key is set
  if (['openai', 'anthropic', 'google', 'cohere', 'mistral', 'groq', 'together', 'deepseek'].includes(provider)) {
    const hasKey = !!providerConfig.apiKey;
    providerStatusCache.set(provider, { available: hasKey, checkedAt: now });
    return hasKey;
  }

  // For Ollama, try to connect
  if (provider === 'ollama') {
    try {
      const endpoint = providerConfig.endpoint || 'http://localhost:11434';
      const response = await fetch(`${endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      const available = response.ok;
      providerStatusCache.set(provider, { available, checkedAt: now });
      return available;
    } catch {
      providerStatusCache.set(provider, { available: false, checkedAt: now });
      return false;
    }
  }

  // For Cloudflare, check account ID and token
  if (provider === 'cloudflare') {
    const hasConfig = !!(providerConfig.apiKey && process.env.CLOUDFLARE_ACCOUNT_ID);
    providerStatusCache.set(provider, { available: hasConfig, checkedAt: now });
    return hasConfig;
  }

  // Default: assume available if enabled
  providerStatusCache.set(provider, { available: true, checkedAt: now });
  return true;
}

/**
 * Clear provider status cache
 */
export function clearProviderCache(): void {
  providerStatusCache.clear();
}

// ═══════════════════════════════════════════════════════════════════
// ROUTER CLASS
// ═══════════════════════════════════════════════════════════════════

/**
 * AI Request Router - resolves capability requests to specific models
 */
export class AIRouter {
  private profileManager = getProfileManager();
  private adminConfig = getAdminConfig();
  private eventListeners: Array<(event: AIControlEvent) => void> = [];

  /**
   * Resolve a capability request to a specific model
   */
  async resolve(
    request: AIRequest
  ): Promise<RouterDecision> {
    const config = await this.adminConfig.getConfig();
    // Use user profile if available, otherwise fall back to default profile
    // This ensures preferLocalModels and other defaults are respected
    // Cast defaultProfile since methods only use preference fields (not userId)
    const profile: UserAIProfile | null = request.userId
      ? await this.profileManager.getProfile(request.userId)
      : (config.defaultProfile as UserAIProfile);

    // Get the model class
    const modelClass = config.modelClasses[request.capability];
    if (!modelClass) {
      throw new Error(`Unknown capability: ${request.capability}`);
    }

    // Check if user has this capability disabled
    if (profile?.disabledClasses?.includes(request.capability)) {
      throw new Error(`Capability '${request.capability}' is disabled for this user`);
    }

    // Check for user/admin override
    if (request.modelOverride) {
      const decision = await this.tryModelOverride(
        request,
        config,
        profile,
        modelClass
      );
      if (decision) return decision;
    }

    // Check user class override
    const userOverride = profile?.classOverrides?.[request.capability];
    if (userOverride?.modelId) {
      const decision = await this.tryUserClassOverride(
        userOverride.modelId,
        userOverride.provider,
        config,
        profile
      );
      if (decision) return decision;
    }

    // Find best available model from class preferences
    return this.findBestModel(modelClass, config, profile);
  }

  /**
   * Try to use a model override
   */
  private async tryModelOverride(
    request: AIRequest,
    config: SystemAIConfig,
    profile: UserAIProfile | null,
    modelClass: ModelClass
  ): Promise<RouterDecision | null> {
    const modelId = request.modelOverride!;
    const provider = request.providerOverride || this.inferProvider(modelId);

    // Check if model is allowed
    if (!(await this.adminConfig.isModelAllowed(modelId))) {
      return null;  // Fall through to normal routing
    }

    // Check if provider is available
    if (!(await isProviderAvailable(provider, config))) {
      return null;
    }

    // Check budget
    const budgetOk = await this.checkBudget(profile, config);

    return {
      selectedModel: modelId,
      selectedProvider: provider,
      reason: 'user_override',
      constraints: {
        userBudgetOk: budgetOk.user,
        systemBudgetOk: budgetOk.system,
        providerAvailable: true,
        modelAllowed: true,
        safetyCleared: true,  // Will be checked separately
      },
    };
  }

  /**
   * Try user class override
   */
  private async tryUserClassOverride(
    modelId: string,
    provider: AIProviderType | undefined,
    config: SystemAIConfig,
    profile: UserAIProfile | null
  ): Promise<RouterDecision | null> {
    const inferredProvider = provider || this.inferProvider(modelId);

    // Check if model is allowed
    if (!(await this.adminConfig.isModelAllowed(modelId))) {
      return null;
    }

    // Check if provider is available
    if (!(await isProviderAvailable(inferredProvider, config))) {
      return null;
    }

    const budgetOk = await this.checkBudget(profile, config);

    return {
      selectedModel: modelId,
      selectedProvider: inferredProvider,
      reason: 'user_preference',
      constraints: {
        userBudgetOk: budgetOk.user,
        systemBudgetOk: budgetOk.system,
        providerAvailable: true,
        modelAllowed: true,
        safetyCleared: true,
      },
    };
  }

  /**
   * Find best available model from class preferences
   */
  private async findBestModel(
    modelClass: ModelClass,
    config: SystemAIConfig,
    profile: UserAIProfile | null
  ): Promise<RouterDecision> {
    const fallbacksAttempted: string[] = [];

    // Sort models by priority
    const sortedModels = [...modelClass.models].sort(
      (a, b) => a.priority - b.priority
    );

    // Apply user preferences to filter/reorder
    const filteredModels = this.applyUserPreferences(sortedModels, profile);

    for (const pref of filteredModels) {
      // Check conditions
      if (!this.checkConditions(pref, profile)) {
        fallbacksAttempted.push(pref.modelId);
        continue;
      }

      // Check if model is allowed
      if (!(await this.adminConfig.isModelAllowed(pref.modelId))) {
        fallbacksAttempted.push(pref.modelId);
        continue;
      }

      // Check if provider is available
      if (!(await isProviderAvailable(pref.provider, config))) {
        fallbacksAttempted.push(pref.modelId);
        continue;
      }

      const budgetOk = await this.checkBudget(profile, config);

      return {
        selectedModel: pref.modelId,
        selectedProvider: pref.provider,
        reason: fallbacksAttempted.length > 0 ? 'fallback' : 'user_preference',
        fallbacksAttempted: fallbacksAttempted.length > 0 ? fallbacksAttempted : undefined,
        constraints: {
          userBudgetOk: budgetOk.user,
          systemBudgetOk: budgetOk.system,
          providerAvailable: true,
          modelAllowed: true,
          safetyCleared: true,
        },
      };
    }

    // Try global fallback chain
    for (const modelId of config.globalFallbackChain) {
      const provider = this.inferProvider(modelId);

      if (!(await this.adminConfig.isModelAllowed(modelId))) {
        continue;
      }

      if (await isProviderAvailable(provider, config)) {
        const budgetOk = await this.checkBudget(profile, config);

        return {
          selectedModel: modelId,
          selectedProvider: provider,
          reason: 'fallback',
          fallbacksAttempted,
          constraints: {
            userBudgetOk: budgetOk.user,
            systemBudgetOk: budgetOk.system,
            providerAvailable: true,
            modelAllowed: true,
            safetyCleared: true,
          },
        };
      }
    }

    throw new Error(`No available model for capability: ${modelClass.id}`);
  }

  /**
   * Apply user preferences to model list
   */
  private applyUserPreferences(
    models: ModelPreference[],
    profile: UserAIProfile | null
  ): ModelPreference[] {
    if (!profile) return models;

    let filtered = [...models];

    // Filter for local-only if user prefers
    if (profile.preferLocalModels) {
      const localModels = filtered.filter(
        m => m.provider === 'ollama' || m.provider === 'local'
      );
      if (localModels.length > 0) {
        // Put local models first
        filtered = [
          ...localModels,
          ...filtered.filter(m => m.provider !== 'ollama' && m.provider !== 'local'),
        ];
      }
    }

    // If user prefers cheap models, deprioritize premium providers
    if (profile.preferCheapModels) {
      filtered.sort((a, b) => {
        const aCost = this.getModelCostTier(a);
        const bCost = this.getModelCostTier(b);
        return aCost - bCost;
      });
    }

    return filtered;
  }

  /**
   * Get cost tier for a model (lower = cheaper)
   */
  private getModelCostTier(pref: ModelPreference): number {
    if (pref.conditions?.costTier) {
      const tiers = { free: 0, low: 1, medium: 2, high: 3, premium: 4 };
      return tiers[pref.conditions.costTier];
    }

    // Infer from provider
    switch (pref.provider) {
      case 'ollama':
      case 'local':
        return 0;  // Free
      case 'cloudflare':
        return 1;  // Low
      case 'groq':
      case 'together':
        return 2;  // Medium
      case 'openai':
      case 'anthropic':
      case 'google':
        return 3;  // High
      default:
        return 2;
    }
  }

  /**
   * Check model conditions
   */
  private checkConditions(
    pref: ModelPreference,
    profile: UserAIProfile | null
  ): boolean {
    const conditions = pref.conditions;
    if (!conditions) return true;

    // Check local requirement
    if (conditions.requiresLocal) {
      if (pref.provider !== 'ollama' && pref.provider !== 'local') {
        return false;
      }
    }

    // Check privacy requirement
    if (conditions.requiresPrivate && profile?.preferLocalModels !== true) {
      // If user doesn't prefer local but model requires privacy, skip
      // unless user explicitly wants privacy
      return false;
    }

    // Time of day check
    if (conditions.timeOfDay) {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      if (currentTime < conditions.timeOfDay.start || currentTime > conditions.timeOfDay.end) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check budget constraints
   */
  private async checkBudget(
    profile: UserAIProfile | null,
    config: SystemAIConfig
  ): Promise<{ user: boolean; system: boolean }> {
    // User budget - only check if profile has userId (defaultProfile doesn't)
    let userOk = true;
    if (profile?.userId) {
      const status = await this.profileManager.isOverBudget(profile.userId);
      userOk = !status.overDaily && !status.overMonthly;
    }

    // System budget (TODO: implement global tracking)
    const systemOk = true;

    return { user: userOk, system: systemOk };
  }

  /**
   * Infer provider from model ID
   */
  private inferProvider(modelId: string): AIProviderType {
    if (modelId.startsWith('gpt-') || modelId.startsWith('o1-') || modelId.startsWith('text-embedding')) {
      return 'openai';
    }
    if (modelId.startsWith('claude-')) {
      return 'anthropic';
    }
    if (modelId.startsWith('gemini-')) {
      return 'google';
    }
    if (modelId.startsWith('@cf/')) {
      return 'cloudflare';
    }
    if (modelId.startsWith('mistral') || modelId.startsWith('mixtral')) {
      return 'mistral';
    }
    if (modelId.startsWith('deepseek')) {
      return 'deepseek';
    }
    if (modelId.includes(':')) {
      // Ollama models use : for tags (e.g., llama3:8b)
      return 'ollama';
    }
    // Default to ollama for local models
    return 'ollama';
  }

  /**
   * Add event listener
   */
  onEvent(listener: (event: AIControlEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove event listener
   */
  offEvent(listener: (event: AIControlEvent) => void): void {
    this.eventListeners = this.eventListeners.filter(l => l !== listener);
  }

  /**
   * Emit an event
   */
  private emit(event: AIControlEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Event listener error:', error);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// AI CONTROL SERVICE
// ═══════════════════════════════════════════════════════════════════

/**
 * Main AI Control service - wraps router with execution
 */
export class AIControlService {
  private router = new AIRouter();
  private profileManager = getProfileManager();
  private adminConfig = getAdminConfig();

  /**
   * Call an AI capability
   */
  async call(request: AIRequest): Promise<AIResponse> {
    const requestId = request.requestId || crypto.randomUUID();
    const startTime = Date.now();

    // 1. Run safety checks
    const safetyResult = runSafetyChecks(request);
    if (safetyResult.blocked) {
      auditLog({
        type: 'safety_violation',
        userId: request.userId,
        requestId,
        capability: request.capability,
        safetyResult,
      });
      throw new Error(`Request blocked: ${safetyResult.violations.map(v => v.message).join(', ')}`);
    }

    // 2. Check rate limits
    if (request.userId) {
      const config = await this.adminConfig.getConfig();
      const limit = config.perUserRateLimitRPM || 100;
      const rateCheck = checkRateLimit(`user:${request.userId}`, limit);

      if (!rateCheck.allowed) {
        auditLog({
          type: 'rate_limit',
          userId: request.userId,
          requestId,
          capability: request.capability,
        });
        throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetIn / 1000)} seconds.`);
      }
    }

    // 3. Resolve to best model
    const decision = await this.router.resolve(request);
    const config = await this.adminConfig.getConfig();
    const providerConfig = config.providers[decision.selectedProvider];

    // 4. Log request
    auditLog({
      type: 'request',
      userId: request.userId,
      sessionId: request.sessionId,
      requestId,
      capability: request.capability,
      model: decision.selectedModel,
      provider: decision.selectedProvider,
    });

    // 5. Build messages array
    const messages = this.buildMessages(request);

    // 6. Build provider config
    const llmConfig: ProviderConfig = {
      endpoint: providerConfig.endpoint,
      apiKey: providerConfig.apiKey,
      model: decision.selectedModel,
      maxTokens: (request.params?.maxTokens as number) || 4096,
      temperature: (request.params?.temperature as number) ?? 0.7,
    };

    // 7. Execute provider call
    let providerResponse;
    try {
      providerResponse = await callProvider(
        decision.selectedProvider,
        messages,
        llmConfig
      );
    } catch (error) {
      auditLog({
        type: 'error',
        userId: request.userId,
        requestId,
        capability: request.capability,
        model: decision.selectedModel,
        provider: decision.selectedProvider,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }

    // 8. Build response
    const response: AIResponse = {
      output: providerResponse.content,
      modelUsed: providerResponse.model,
      providerUsed: decision.selectedProvider,
      capabilityUsed: request.capability,
      inputTokens: providerResponse.inputTokens,
      outputTokens: providerResponse.outputTokens,
      totalTokens: providerResponse.inputTokens + providerResponse.outputTokens,
      processingTimeMs: Date.now() - startTime,
      filtered: false,
      safetyTriggered: safetyResult.violations.length > 0,
      safetyWarnings: safetyResult.warnings,
      requestId,
      timestamp: new Date().toISOString(),
    };

    // 9. Log response
    auditLog({
      type: 'response',
      userId: request.userId,
      requestId,
      capability: request.capability,
      model: decision.selectedModel,
      provider: decision.selectedProvider,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      cost: response.cost,
    });

    return response;
  }

  /**
   * Build LLM messages from AIRequest
   */
  private buildMessages(request: AIRequest): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // Add system prompt if provided in params
    if (request.params?.systemPrompt) {
      messages.push({
        role: 'system',
        content: request.params.systemPrompt as string,
      });
    }

    // Add conversation history if provided
    if (request.params?.messages && Array.isArray(request.params.messages)) {
      for (const msg of request.params.messages as LLMMessage[]) {
        messages.push(msg);
      }
    }

    // Add current input as user message
    if (typeof request.input === 'string') {
      messages.push({
        role: 'user',
        content: request.input,
      });
    } else if (request.input.text) {
      // Multimodal input - just use text for now
      messages.push({
        role: 'user',
        content: request.input.text,
      });
    }

    return messages;
  }

  /**
   * Stream an AI capability response
   */
  async *stream(request: AIRequest): AsyncGenerator<AIStreamChunk> {
    const requestId = request.requestId || crypto.randomUUID();

    // 1. Run safety checks
    const safetyResult = runSafetyChecks(request);
    if (safetyResult.blocked) {
      throw new Error(`Request blocked: ${safetyResult.violations.map(v => v.message).join(', ')}`);
    }

    // 2. Resolve to best model
    const decision = await this.router.resolve(request);
    const config = await this.adminConfig.getConfig();
    const providerConfig = config.providers[decision.selectedProvider];

    // 3. Build messages
    const messages = this.buildMessages(request);

    // 4. Build provider config
    const llmConfig: ProviderConfig = {
      endpoint: providerConfig.endpoint,
      apiKey: providerConfig.apiKey,
      model: decision.selectedModel,
      maxTokens: (request.params?.maxTokens as number) || 4096,
      temperature: (request.params?.temperature as number) ?? 0.7,
    };

    // 5. Stream from provider
    yield* streamProvider(decision.selectedProvider, messages, llmConfig);
  }

  /**
   * Check if a capability is available
   */
  async isCapabilityAvailable(capability: string): Promise<boolean> {
    const config = await this.adminConfig.getConfig();
    const modelClass = config.modelClasses[capability];

    if (!modelClass) return false;

    // Check if any model in the class is available
    for (const pref of modelClass.models) {
      if (await isProviderAvailable(pref.provider, config)) {
        return true;
      }
    }

    return false;
  }

  /**
   * List available capabilities
   */
  async listCapabilities(userId?: string): Promise<ModelClass[]> {
    const config = await this.adminConfig.getConfig();
    const profile = userId ? await this.profileManager.getProfile(userId) : null;
    const classes = Object.values(config.modelClasses);

    // Filter out disabled classes for user
    if (profile?.disabledClasses) {
      return classes.filter(c => !profile.disabledClasses!.includes(c.id));
    }

    return classes;
  }

  /**
   * Preview routing decision without executing
   */
  async previewRouting(request: AIRequest): Promise<RouterDecision> {
    return this.router.resolve(request);
  }

  /**
   * Get user's budget status
   */
  async getBudgetStatus(userId: string): Promise<BudgetStatus> {
    const profile = await this.profileManager.getProfile(userId);
    const status = await this.profileManager.isOverBudget(userId);

    return {
      dailyLimit: profile.dailyBudget,
      dailyUsed: profile.currentDailySpend || 0,
      dailyRemaining: status.dailyRemaining,
      monthlyLimit: profile.monthlyBudget,
      monthlyUsed: profile.currentMonthlySpend || 0,
      monthlyRemaining: status.monthlyRemaining,
      isOverBudget: status.overDaily || status.overMonthly,
    };
  }

  /**
   * Subscribe to router events
   */
  onEvent(listener: (event: AIControlEvent) => void): void {
    this.router.onEvent(listener);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════

let _aiControlService: AIControlService | null = null;

/**
 * Get the singleton AI control service
 */
export function getAIControlService(): AIControlService {
  if (!_aiControlService) {
    _aiControlService = new AIControlService();
  }
  return _aiControlService;
}

/**
 * Convenience function to call a capability
 */
export async function callCapability(
  capability: string,
  input: string,
  options?: Partial<AIRequest>
): Promise<AIResponse> {
  return getAIControlService().call({
    capability,
    input,
    ...options,
  });
}

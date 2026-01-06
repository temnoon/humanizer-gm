/**
 * AgentMaster Service
 *
 * Unified LLM abstraction layer that:
 * - Auto-selects prompts based on device memory tier
 * - Routes capability requests through AIControlService
 * - Vets output based on model-specific profiles
 * - Provides teaching output for AUI
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  AgentMasterRequest,
  AgentMasterResponse,
  AgentMasterService,
  DeviceProfile,
  MemoryTier,
  PromptVariant,
  VettingProfile,
} from './types';
import type { AIRequest, AIResponse } from '../ai-control/types';

import {
  getDeviceProfile,
  setDeviceProfile as setDeviceProfileInternal,
  redetectDevice,
  getTierDescription,
} from './device-profile';

import {
  selectPrompt,
  getPromptVariant,
  listPromptCapabilities,
  getPromptTeaching,
} from './prompt-engine';

import { getVettingProfile, filterOutput } from './vetting-registry';

// Import AIControlService (will be lazily initialized)
import { getAIControlService } from '../ai-control';

// ═══════════════════════════════════════════════════════════════════
// SERVICE IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════

class AgentMasterServiceImpl implements AgentMasterService {
  private initialized = false;

  /**
   * Ensure service is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      // Import prompts to register them
      require('./prompts/chat');
      this.initialized = true;
      console.log('[AgentMaster] Initialized');
    }
  }

  /**
   * Execute a capability request
   */
  async execute(request: AgentMasterRequest): Promise<AgentMasterResponse> {
    this.ensureInitialized();
    const startTime = Date.now();
    const requestId = uuidv4();

    // 1. Select prompt based on tier
    const promptSelection = selectPrompt(request.capability, {
      forceTier: request.forceTier,
      variables: request.variables,
    });

    if (!promptSelection) {
      throw new Error(`Unknown capability: ${request.capability}`);
    }

    // 2. Build AI request
    const aiRequest: AIRequest = {
      capability: request.capability,
      input: request.input,
      params: request.params,
      userId: request.userId,
      sessionId: request.sessionId,
      requestId,
      stream: request.stream,
      onToken: request.onToken,
    };

    // Add model override if specified (for debugging)
    if (request.forceModel) {
      aiRequest.modelOverride = request.forceModel;
    }

    if (request.forceProvider) {
      aiRequest.providerOverride = request.forceProvider;
    }

    // 3. Get AIControlService and call
    const aiService = getAIControlService();

    // Inject the tiered system prompt and conversation history
    // The AIControlService will use these to build the messages array
    const aiRequestWithPrompt: AIRequest = {
      ...aiRequest,
      params: {
        ...aiRequest.params,
        systemPrompt: promptSelection.systemPrompt,
        maxTokens: promptSelection.prompt.maxTokens,
        temperature: promptSelection.prompt.temperature,
        // Pass conversation history if provided
        messages: request.messages,
      },
    };

    let aiResponse: AIResponse;
    try {
      aiResponse = await aiService.call(aiRequestWithPrompt);
    } catch (error) {
      throw new Error(
        `AIControlService error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // 4. Apply output vetting
    let output = aiResponse.output;
    let raw: string | undefined;
    let vetted = false;
    let vettingStripped: AgentMasterResponse['vettingStripped'];

    if (!request.skipVetting) {
      const vettingResult = filterOutput(aiResponse.output, aiResponse.modelUsed);
      output = vettingResult.content;
      raw = vettingResult.raw !== vettingResult.content ? vettingResult.raw : undefined;
      vetted = true;
      vettingStripped = vettingResult.stripped;
    }

    // 5. Build response
    const processingTimeMs = Date.now() - startTime;

    const response: AgentMasterResponse = {
      output,
      raw,
      modelUsed: aiResponse.modelUsed,
      providerUsed: aiResponse.providerUsed,
      tier: promptSelection.tier,
      vetted,
      vettingStrategy: vetted ? getVettingProfile(aiResponse.modelUsed)?.outputStrategy : undefined,
      vettingStripped,
      inputTokens: aiResponse.inputTokens,
      outputTokens: aiResponse.outputTokens,
      processingTimeMs,
      cost: aiResponse.cost,
      requestId,
      teaching: {
        whatHappened: `Executed ${request.capability} capability`,
        promptTierUsed: promptSelection.tier,
        modelSelected: `${aiResponse.modelUsed} via ${aiResponse.providerUsed}`,
        vettingApplied: vetted
          ? `${getVettingProfile(aiResponse.modelUsed)?.outputStrategy || 'generic'} strategy`
          : 'none',
      },
    };

    // Log summary
    console.log(
      `[AgentMaster] ${request.capability}: ${promptSelection.tier} tier, ` +
        `${aiResponse.modelUsed}, ${processingTimeMs}ms`
    );

    return response;
  }

  /**
   * Stream a capability request
   */
  async *stream(
    request: AgentMasterRequest
  ): AsyncGenerator<string, AgentMasterResponse> {
    this.ensureInitialized();
    const startTime = Date.now();
    const requestId = uuidv4();

    // 1. Select prompt based on tier
    const promptSelection = selectPrompt(request.capability, {
      forceTier: request.forceTier,
      variables: request.variables,
    });

    if (!promptSelection) {
      throw new Error(`Unknown capability: ${request.capability}`);
    }

    // 2. Build AI request with conversation history
    const aiRequest: AIRequest = {
      capability: request.capability,
      input: request.input,
      params: {
        ...request.params,
        systemPrompt: promptSelection.systemPrompt,
        maxTokens: promptSelection.prompt.maxTokens,
        temperature: promptSelection.prompt.temperature,
        // Pass conversation history if provided
        messages: request.messages,
      },
      userId: request.userId,
      sessionId: request.sessionId,
      requestId,
      stream: true,
    };

    if (request.forceModel) {
      aiRequest.modelOverride = request.forceModel;
    }

    if (request.forceProvider) {
      aiRequest.providerOverride = request.forceProvider;
    }

    // 3. Get AIControlService and stream
    const aiService = getAIControlService();
    const chunks: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let modelUsed = '';
    let providerUsed: AIResponse['providerUsed'] = 'ollama';

    const streamGenerator = aiService.stream(aiRequest);

    for await (const chunk of streamGenerator) {
      yield chunk.token;
      chunks.push(chunk.token);

      if (chunk.modelUsed) modelUsed = chunk.modelUsed;
      if (chunk.inputTokens) totalInputTokens = chunk.inputTokens;
      if (chunk.outputTokens) totalOutputTokens = chunk.outputTokens;
    }

    // 4. Apply vetting to complete output
    const rawOutput = chunks.join('');
    let output = rawOutput;
    let vetted = false;

    if (!request.skipVetting) {
      const vettingResult = filterOutput(rawOutput, modelUsed);
      output = vettingResult.content;
      vetted = true;
    }

    // 5. Return final response
    const processingTimeMs = Date.now() - startTime;

    return {
      output,
      raw: rawOutput !== output ? rawOutput : undefined,
      modelUsed,
      providerUsed,
      tier: promptSelection.tier,
      vetted,
      vettingStrategy: vetted
        ? getVettingProfile(modelUsed)?.outputStrategy
        : undefined,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      processingTimeMs,
      requestId,
      teaching: {
        whatHappened: `Streamed ${request.capability} capability`,
        promptTierUsed: promptSelection.tier,
        modelSelected: modelUsed,
        vettingApplied: vetted ? 'applied after streaming' : 'none',
      },
    };
  }

  /**
   * Get current device profile
   */
  getDeviceProfile(): DeviceProfile {
    return getDeviceProfile();
  }

  /**
   * Set device profile (user override)
   */
  setDeviceProfile(profile: Partial<DeviceProfile>): void {
    setDeviceProfileInternal(profile);
  }

  /**
   * Get prompt for a capability and tier
   */
  getPrompt(capability: string, tier?: MemoryTier): PromptVariant | undefined {
    this.ensureInitialized();
    return getPromptVariant(capability, tier);
  }

  /**
   * Get vetting profile for a model
   */
  getVettingProfile(modelId: string): VettingProfile | undefined {
    return getVettingProfile(modelId);
  }

  /**
   * List available capabilities
   */
  listCapabilities(): string[] {
    this.ensureInitialized();
    return listPromptCapabilities();
  }

  /**
   * Check if a capability is available
   */
  async isCapabilityAvailable(capability: string): Promise<boolean> {
    this.ensureInitialized();
    const aiService = getAIControlService();
    return aiService.isCapabilityAvailable(capability);
  }

  /**
   * Force re-detection of device profile
   */
  async redetectDevice(): Promise<DeviceProfile> {
    return redetectDevice();
  }
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════════

let serviceInstance: AgentMasterServiceImpl | null = null;

/**
 * Get the AgentMaster service singleton
 */
export function getAgentMasterService(): AgentMasterService {
  if (!serviceInstance) {
    serviceInstance = new AgentMasterServiceImpl();
  }
  return serviceInstance;
}

/**
 * Reset the service (for testing)
 */
export function resetAgentMasterService(): void {
  serviceInstance = null;
}

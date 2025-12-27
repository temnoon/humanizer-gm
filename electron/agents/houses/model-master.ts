/**
 * Model Master Agent
 *
 * The AI Master Control wrapped as a council agent.
 * Routes capability requests to the best available model.
 *
 * Capabilities:
 * - call-capability: Call an AI capability
 * - preview-routing: Preview which model would be used
 * - check-budget: Check user's budget status
 * - list-capabilities: List available capabilities
 * - list-models: List available models for a capability
 */

import { AgentBase } from '../runtime/agent-base';
import type { AgentMessage, HouseType } from '../runtime/types';
import {
  getAIControlService,
  getAdminConfig,
  getProfileManager,
  type AIRequest,
  type AIResponse,
  type RouterDecision,
  type BudgetStatus,
  type ModelClass,
  type AIProviderType,
} from '../../ai-control';

// ═══════════════════════════════════════════════════════════════════
// MODEL MASTER AGENT
// ═══════════════════════════════════════════════════════════════════

export class ModelMasterAgent extends AgentBase {
  readonly id = 'model-master';
  readonly name = 'Model Master';
  readonly house: HouseType = 'model-master';
  readonly capabilities = [
    'call-capability',
    'preview-routing',
    'check-budget',
    'list-capabilities',
    'list-models',
    'track-spend',
  ];

  private aiService = getAIControlService();
  private adminConfig = getAdminConfig();
  private profileManager = getProfileManager();

  // ─────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────────

  protected async onInitialize(): Promise<void> {
    this.log('info', 'Initializing with AI Control integration');

    // Subscribe to budget-related events
    this.subscribe('budget:check');
    this.subscribe('budget:exceeded');
  }

  protected async onShutdown(): Promise<void> {
    this.log('info', 'Shutting down');
  }

  // ─────────────────────────────────────────────────────────────────
  // MESSAGE HANDLING
  // ─────────────────────────────────────────────────────────────────

  protected async onMessage(message: AgentMessage): Promise<unknown> {
    switch (message.type) {
      case 'call-capability':
        return this.handleCallCapability(message.payload as CallCapabilityRequest);

      case 'preview-routing':
        return this.handlePreviewRouting(message.payload as PreviewRoutingRequest);

      case 'check-budget':
        return this.handleCheckBudget(message.payload as CheckBudgetRequest);

      case 'list-capabilities':
        return this.handleListCapabilities(message.payload as ListCapabilitiesRequest);

      case 'list-models':
        return this.handleListModels(message.payload as ListModelsRequest);

      case 'track-spend':
        return this.handleTrackSpend(message.payload as TrackSpendRequest);

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // HANDLERS
  // ─────────────────────────────────────────────────────────────────

  private async handleCallCapability(request: CallCapabilityRequest): Promise<AIResponse> {
    const { capability, input, params, userId, modelOverride, providerOverride } = request;

    // Build AI request
    const aiRequest: AIRequest = {
      capability,
      input,
      params,
      userId,
      modelOverride,
      providerOverride: providerOverride as AIProviderType | undefined,
      requestId: this.generateId('req'),
    };

    // Check budget before calling
    if (userId) {
      const budgetStatus = await this.aiService.getBudgetStatus(userId);
      if (budgetStatus.isOverBudget) {
        throw new Error('Budget exceeded. Cannot make AI call.');
      }
    }

    // Call the AI service
    const response = await this.aiService.call(aiRequest);

    // Emit event for tracking
    this.publish('ai:call-completed', {
      capability,
      modelUsed: response.modelUsed,
      providerUsed: response.providerUsed,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      cost: response.cost,
      userId,
    });

    return response;
  }

  private async handlePreviewRouting(request: PreviewRoutingRequest): Promise<RouterDecision> {
    const { capability, userId, modelOverride } = request;

    return this.aiService.previewRouting({
      capability,
      input: '', // Empty input for preview
      userId,
      modelOverride,
    });
  }

  private async handleCheckBudget(request: CheckBudgetRequest): Promise<BudgetStatus> {
    const { userId } = request;
    return this.aiService.getBudgetStatus(userId);
  }

  private async handleListCapabilities(request: ListCapabilitiesRequest): Promise<ModelClass[]> {
    const { userId } = request;
    return this.aiService.listCapabilities(userId);
  }

  private async handleListModels(request: ListModelsRequest): Promise<ModelInfo[]> {
    const { capability } = request;
    const config = await this.adminConfig.getConfig();
    const modelClass = config.modelClasses[capability];

    if (!modelClass) {
      throw new Error(`Unknown capability: ${capability}`);
    }

    return modelClass.models.map(pref => ({
      modelId: pref.modelId,
      provider: pref.provider,
      priority: pref.priority,
      conditions: pref.conditions,
    }));
  }

  private async handleTrackSpend(request: TrackSpendRequest): Promise<void> {
    const { userId, amount } = request;
    await this.profileManager.trackSpend(userId, amount);
  }

  // ─────────────────────────────────────────────────────────────────
  // PUBLIC API (For Other Agents)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Call an AI capability (convenience method for other agents)
   */
  async callCapability(
    capability: string,
    input: string,
    options?: {
      params?: Record<string, unknown>;
      userId?: string;
      modelOverride?: string;
    }
  ): Promise<AIResponse> {
    return this.handleCallCapability({
      capability,
      input,
      params: options?.params,
      userId: options?.userId,
      modelOverride: options?.modelOverride,
    });
  }

  /**
   * Quick call for common capabilities
   */
  async translate(text: string, targetLanguage: string, userId?: string): Promise<string> {
    const response = await this.callCapability('translation', text, {
      params: { targetLanguage },
      userId,
    });
    return response.output;
  }

  async analyze(text: string, userId?: string): Promise<unknown> {
    const response = await this.callCapability('analysis', text, { userId });
    return response.structured || response.output;
  }

  async summarize(text: string, userId?: string): Promise<string> {
    const response = await this.callCapability('summarization', text, { userId });
    return response.output;
  }

  async detectAI(text: string): Promise<unknown> {
    const response = await this.callCapability('detection', text);
    return response.structured || response.output;
  }

  async humanize(text: string, userId?: string): Promise<string> {
    const response = await this.callCapability('humanizer', text, { userId });
    return response.output;
  }

  async compose(prompt: string, userId?: string): Promise<string> {
    const response = await this.callCapability('creative', prompt, { userId });
    return response.output;
  }

  async reason(problem: string, userId?: string): Promise<string> {
    const response = await this.callCapability('reasoning', problem, { userId });
    return response.output;
  }
}

// ═══════════════════════════════════════════════════════════════════
// REQUEST TYPES
// ═══════════════════════════════════════════════════════════════════

interface CallCapabilityRequest {
  capability: string;
  input: string;
  params?: Record<string, unknown>;
  userId?: string;
  modelOverride?: string;
  providerOverride?: string;
}

interface PreviewRoutingRequest {
  capability: string;
  userId?: string;
  modelOverride?: string;
}

interface CheckBudgetRequest {
  userId: string;
}

interface ListCapabilitiesRequest {
  userId?: string;
}

interface ListModelsRequest {
  capability: string;
}

interface TrackSpendRequest {
  userId: string;
  amount: number;
}

interface ModelInfo {
  modelId: string;
  provider: string;
  priority: number;
  conditions?: unknown;
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════

let _modelMaster: ModelMasterAgent | null = null;

/**
 * Get the Model Master agent
 */
export function getModelMasterAgent(): ModelMasterAgent {
  if (!_modelMaster) {
    _modelMaster = new ModelMasterAgent();
  }
  return _modelMaster;
}

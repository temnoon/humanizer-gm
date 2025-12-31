/**
 * AgentMaster - Unified LLM Abstraction Layer
 *
 * All LLM calls should go through AgentMaster, which provides:
 * - Tiered prompts based on device memory (tiny/standard/full)
 * - Automatic output vetting (strips thinking tags, preambles)
 * - Model-agnostic capability routing
 * - Teaching output for AUI
 *
 * Usage:
 * ```typescript
 * import { getAgentMasterService } from './agent-master';
 *
 * const agentMaster = getAgentMasterService();
 * const result = await agentMaster.execute({
 *   capability: 'chat',
 *   input: 'Search for consciousness in my archive',
 * });
 * ```
 */

// Core types
export type {
  MemoryTier,
  DeviceProfile,
  PromptVariant,
  TieredPromptDefinition,
  VettingProfile,
  VettingResult,
  ConversationMessage,
  AgentMasterRequest,
  AgentMasterResponse,
  AgentMasterService,
  PromptEngineConfig,
  PromptSelection,
} from './types';

// Main service
export { getAgentMasterService, resetAgentMasterService } from './service';

// Device profile utilities
export {
  detectDeviceProfile,
  getDeviceProfile,
  setDeviceProfile,
  clearDeviceOverride,
  redetectDevice,
  getTierDescription,
  getRecommendedModels,
} from './device-profile';

// Prompt engine utilities
export {
  registerPrompt,
  getPromptDefinition,
  listPromptCapabilities,
  selectPrompt,
  getPromptVariant,
  configurePromptEngine,
  validatePromptDefinition,
  extractVariables,
  getPromptTeaching,
} from './prompt-engine';

// Vetting registry utilities
export {
  getVettingProfile,
  listVettingProfiles,
  registerVettingProfile,
  filterOutput,
} from './vetting-registry';

// Register default prompts on import
import './prompts/chat';

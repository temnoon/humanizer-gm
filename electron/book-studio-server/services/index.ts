/**
 * Book Studio Services Registry
 *
 * Central export point for all Book Studio services.
 * Each service follows the singleton pattern for resource efficiency.
 */

// ============================================================================
// Service Exports
// ============================================================================

// Harvest Service - Search, commit, and track content harvests
export {
  HarvestService,
  getHarvestService,
  type HarvestSearchParams,
  type HarvestSearchResult,
  type HarvestSearchResponse,
  type HarvestCommitParams,
  type HarvestCommitResponse,
  type HarvestHistoryEntry,
  type QuerySuggestion,
  type IterateHarvestParams,
} from './HarvestService';

// Draft Service - Generate and manage chapter drafts
export {
  DraftService,
  getDraftService,
  type DraftGenerationParams,
  type DraftGenerationResult,
  type DraftVersion,
  type DraftCompareResult,
  type DraftGenerationProgress,
} from './DraftService';

// Voice Service - Extract and apply author voices
export {
  VoiceService,
  getVoiceService,
  type VoiceProfile,
  type ExtractedVoiceFeatures,
  type VoiceExtractParams,
  type VoiceApplyParams,
  type VoiceApplyResult,
} from './VoiceService';

// Embedding Service - Generate and store embeddings
export {
  EmbeddingService,
  getEmbeddingService,
  type EmbeddingResult,
  type SimilarCard,
  type SectionMatch,
  type EmbeddingStats,
  type BatchEmbeddingResult,
} from './EmbeddingService';

// Existing Services
export { OutlineService, getOutlineService } from './OutlineService';
export { ClusteringService, getClusteringService } from './ClusteringService';
export { GradingService, getGradingService } from './GradingService';
export { GradingQueueService, getGradingQueueService } from './GradingQueueService';
export { configService } from './ConfigService';
export { MetricsService, getMetricsService } from './MetricsService';
export { AssignmentService, getAssignmentService } from './AssignmentService';

// ============================================================================
// Service Registry
// ============================================================================

// Import getters for initialization
import { getHarvestService as _getHarvestService } from './HarvestService';
import { getDraftService as _getDraftService } from './DraftService';
import { getVoiceService as _getVoiceService } from './VoiceService';
import { getEmbeddingService as _getEmbeddingService } from './EmbeddingService';
import { getOutlineService as _getOutlineService } from './OutlineService';
import { getClusteringService as _getClusteringService } from './ClusteringService';

/**
 * Initialize all services
 *
 * Call this during server startup to pre-warm services
 * and catch any initialization errors early.
 */
export async function initializeServices(): Promise<void> {
  console.log('[book-studio-services] Initializing services...');

  // Initialize singleton instances
  _getHarvestService();
  _getDraftService();
  _getVoiceService();
  _getEmbeddingService();
  _getOutlineService();
  _getClusteringService();

  // Check Ollama availability
  const embeddingService = _getEmbeddingService();
  const health = await embeddingService.checkOllamaHealth();

  if (health.available) {
    console.log(`[book-studio-services] Ollama available (${health.model})`);
  } else {
    console.warn(`[book-studio-services] Ollama not available: ${health.error}`);
    console.warn('[book-studio-services] Embedding and draft generation will be unavailable');
  }

  console.log('[book-studio-services] Services initialized');
}

/**
 * Get service health status
 */
export async function getServiceHealth(): Promise<{
  services: Record<string, boolean>;
  ollama: { available: boolean; model: string; error?: string };
}> {
  const embeddingService = _getEmbeddingService();
  const ollamaHealth = await embeddingService.checkOllamaHealth();

  return {
    services: {
      harvest: true,
      draft: true,
      voice: true,
      embedding: true,
      outline: true,
      clustering: true,
      grading: true,
      metrics: true,
    },
    ollama: ollamaHealth,
  };
}

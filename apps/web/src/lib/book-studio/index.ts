/**
 * Book Studio - Bookmaking Agents and Services
 *
 * Integrated from humanizer-sandbox on January 17, 2026.
 *
 * Core agents:
 * - Smart Harvest Agent: Intelligent filtering for quality content during harvesting
 * - Outline Agent: Multi-phase outline management and proposal generation
 * - Draft Generator: Generate first drafts from harvest cards using Ollama LLM
 * - Harvest Review Agent: Classifies stub types, grades cards
 *
 * API Dependencies:
 * - Archive Server (port 3002): unifiedSearch, getMessageContext
 * - Book Studio Server (port 3004): cards, chapters, outlines CRUD
 * - Ollama (port 11434): /api/generate for draft text
 */

// Types
export * from './types'

// Configuration
export { getConfig, useConfig, setUserConfig } from './config'
export type { BookStudioConfig } from './config'

// Agents
export { smartHarvest, type HarvestConfig, type HarvestResult, type HarvestProgress } from './smart-harvest-agent'
export {
  researchHarvest,
  reviewOutline,
  generateOutline,
  orderCardsForOutline,
  extractThemes,
  detectNarrativeArcs,
  type OutlineResearch,
  type ExtractedTheme,
  type NarrativeArc,
  type GeneratedOutline,
  type OutlineReview,
} from './outline-agent'
export {
  generateDraft,
  generateOutlineDraft,
  generateDraftWithOutline,
  getAvailableModels,
  checkOllamaAvailable,
  deduplicateCards,
} from './draft-generator'
export {
  classifyStub,
  quickGradeCard,
  gradeCardFull,
  requestFullGrade,
  processCardOnHarvest,
  gradingQueue,
} from './harvest-review-agent'

// Services
export {
  clusterCardsSemantically,
  quickClusterByContent,
  type SemanticCluster,
  type ClusteringConfig,
} from './clustering'
export {
  detectOutline,
  isLikelyOutline,
  extractOutlineTexts,
  countOutlineItems,
} from './outline-detector'
export {
  analyzeNecessity as chekhovAnalyze,
  analyzeNecessityBatch,
  quickNecessityScore,
  isSetup,
  isPayoff,
} from './chekhov-local'

// API Client (for direct server access)
export { apiClient, wsManager } from './api-client'

// React Hook
export { useBookStudioApi } from './useBookStudioApi'

// Persistence Adapter (abstracts localStorage vs API backend)
export {
  loadLibrary,
  loadBook,
  saveLibrary,
  setActiveBookId,
  createBook,
  updateBookTitle,
  deleteBook,
  createChapter,
  createChaptersBatch,
  harvestCard,
  harvestCardsBatch,
  updateCard,
  moveCardToChapter,
  deleteCard,
  onBookEvent,
  connectWebSocket,
  disconnectWebSocket,
  isApiAvailable,
  resetApiCheck,
} from './persistence-adapter'

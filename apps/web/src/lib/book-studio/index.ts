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
export { smartHarvest, type SmartHarvestConfig, type HarvestResult } from './smart-harvest-agent'
export { OutlineAgent } from './outline-agent'
export { generateDraft, generateOutlineDraft, listOllamaModels } from './draft-generator'
export { classifyStub, quickGradeCard, fullGradeCard } from './harvest-review-agent'

// Services
export { computeClusters, type ClusterResult } from './clustering'
export { detectOutline, extractOutlineStructure } from './outline-detector'
export { analyzeLocally as chekhovAnalyze } from './chekhov-local'

// API Client (for direct server access)
export { apiClient, wsManager } from './api-client'

// React Hook
export { useBookStudioApi } from './useBookStudioApi'

// Persistence
export { getPersistenceAdapter } from './persistence-adapter'

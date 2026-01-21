/**
 * Book Studio API Client
 *
 * Connects to the Book Studio server (port 3004) for persistent storage.
 * Provides the same interface as persistence.ts but backed by SQLite via REST API.
 * Includes JWT authentication for multi-tenant support.
 */

import type { Book, Chapter, HarvestCard } from './types'
import { getConfig } from './config'

// ============================================================================
// Auth Token Management
// ============================================================================

let authToken: string | null = null

/**
 * Set the auth token for API requests
 * Call this after user logs in
 */
export function setAuthToken(token: string | null): void {
  authToken = token
}

/**
 * Get the current auth token
 */
export function getAuthToken(): string | null {
  // Try to get from memory first
  if (authToken) return authToken

  // Fall back to localStorage (for persistence across page reloads)
  try {
    const stored = localStorage.getItem('humanizer-auth-token')
    if (stored) {
      authToken = stored
      return stored
    }
  } catch {
    // localStorage not available
  }

  return null
}

// ============================================================================
// Configuration
// ============================================================================

function getApiBase(): string {
  return getConfig().api.bookStudioBase
}

function getWsUrl(): string {
  return getConfig().api.bookStudioWs
}

// ============================================================================
// Types (API response shapes)
// ============================================================================

interface ApiBook {
  id: string
  title: string
  description: string | null
  author_id: string | null
  target_word_count: number | null
  created_at: number
  updated_at: number
  // Optional counts returned by list endpoint
  cardCount?: number
  chapterCount?: number
}

interface ApiChapter {
  id: string
  book_id: string
  title: string
  order: number
  content: string | null
  draft_instructions: string | null
  word_count: number
  created_at: number
  updated_at: number
}

interface ApiCard {
  id: string
  book_id: string
  chapter_id: string | null
  source_id: string
  source_type: string
  source: string
  content_origin: string
  content: string
  title: string | null
  author_name: string | null
  similarity: number | null
  source_created_at: number | null
  source_created_at_status: string
  harvested_at: number
  source_url: string | null
  conversation_id: string | null
  conversation_title: string | null
  user_notes: string
  ai_context: string | null
  ai_summary: string | null
  tags: string
  status: string
  metadata: string | null
  grade: string | null
  is_outline: number
  outline_structure: string | null
  canvas_x: number | null
  canvas_y: number | null
  created_at: number
  updated_at: number
}

// ============================================================================
// New API Types (Phase 3 Consolidation)
// ============================================================================

/** Harvest search result from archive-server */
export interface HarvestSearchResult {
  id: string
  source_id: string
  source_type: string
  source: string
  content: string
  title?: string
  author_name?: string
  similarity: number
  source_created_at?: number
  source_url?: string
  conversation_id?: string
  conversation_title?: string
  metadata?: Record<string, unknown>
}

/** Harvest history entry */
export interface HarvestHistoryEntry {
  id: string
  bookId: string
  chapterId?: string
  query: string
  resultCount: number
  acceptedCount: number
  rejectedCount: number
  status: 'pending' | 'completed' | 'abandoned'
  createdAt: number
  completedAt?: number
}

/** Harvest instruction */
export interface HarvestInstruction {
  id: string
  bookId: string
  chapterId?: string
  instructionType: 'include' | 'exclude' | 'prefer' | 'avoid'
  instructionText: string
  appliesToSources?: string[]
  priority: number
  isActive: boolean
  createdAt: number
}

/** Draft version */
export interface DraftVersion {
  id: string
  chapterId: string
  bookId: string
  versionNumber: number
  content: string
  wordCount: number
  voiceId?: string
  generatedBy: 'human' | 'llm'
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'needs_revision'
  reviewNotes?: string
  qualityScore?: number
  isAccepted: boolean
  createdAt: number
  createdBy: string
}

/** Draft comparison result */
export interface DraftComparison {
  version1: DraftVersion
  version2: DraftVersion
  additions: number
  deletions: number
  wordCountDiff: number
}

/** Voice profile */
export interface VoiceProfile {
  id: string
  bookId: string
  name: string
  description?: string
  sampleText?: string
  extractedFeatures?: {
    sentencePatterns?: string[]
    vocabularyLevel?: string
    toneDescriptors?: string[]
    punctuationStyle?: string
  }
  sourceCardIds?: string[]
  isPrimary: boolean
  createdAt: number
  updatedAt: number
}

/** Voice application result */
export interface VoiceApplicationResult {
  originalContent: string
  transformedContent: string
  voiceId: string
  strengthFactor: number
}

// ============================================================================
// Type Converters
// ============================================================================

/**
 * Safely convert a Unix timestamp (seconds) to ISO string
 * Returns current time if value is invalid
 */
function safeTimestampToIso(timestamp: number | null | undefined): string {
  if (timestamp != null && typeof timestamp === 'number' && !isNaN(timestamp)) {
    return new Date(timestamp * 1000).toISOString()
  }
  return new Date().toISOString()
}

function apiBookToBook(api: ApiBook, chapters: Chapter[] = [], cards: HarvestCard[] = []): Book {
  return {
    id: api.id,
    title: api.title,
    description: api.description || '',
    chapters,
    stagingCards: cards.filter(c => c.status === 'staging'),
    targetWordCount: api.target_word_count || undefined,
    createdAt: safeTimestampToIso(api.created_at),
    updatedAt: safeTimestampToIso(api.updated_at),
    // Pass through counts from list endpoint (computed by SQL)
    cardCount: api.cardCount,
    chapterCount: api.chapterCount,
  }
}

function apiChapterToChapter(api: ApiChapter, cardIds: string[] = []): Chapter {
  return {
    id: api.id,
    title: api.title,
    order: api.order,
    content: api.content || undefined,
    draftInstructions: api.draft_instructions || undefined,
    wordCount: api.word_count,
    cards: cardIds,
  }
}

function apiCardToHarvestCard(api: ApiCard): HarvestCard {
  return {
    id: api.id,
    sourceId: api.source_id,
    sourceType: api.source_type as HarvestCard['sourceType'],
    source: api.source,
    contentOrigin: api.content_origin as HarvestCard['contentOrigin'],
    content: api.content,
    title: api.title || undefined,
    authorName: api.author_name || undefined,
    similarity: api.similarity || undefined,
    sourceCreatedAt: api.source_created_at,
    sourceCreatedAtStatus: api.source_created_at_status as HarvestCard['sourceCreatedAtStatus'],
    harvestedAt: api.harvested_at,
    sourceUrl: api.source_url || undefined,
    conversationId: api.conversation_id || undefined,
    conversationTitle: api.conversation_title || undefined,
    userNotes: api.user_notes,
    aiContext: api.ai_context || undefined,
    aiSummary: api.ai_summary || undefined,
    suggestedChapterId: api.chapter_id || undefined,
    tags: api.tags
      ? (typeof api.tags === 'string' ? api.tags.split(',').filter(Boolean) : api.tags)
      : [],
    canvasPosition: api.canvas_x !== null ? { x: api.canvas_x!, y: api.canvas_y! } : undefined,
    status: api.status as HarvestCard['status'],
    metadata: api.metadata
      ? (typeof api.metadata === 'string' ? JSON.parse(api.metadata) : api.metadata)
      : undefined,
    grade: api.grade
      ? (typeof api.grade === 'string' ? JSON.parse(api.grade) : api.grade)
      : undefined,
    isOutline: api.is_outline === 1,
    outlineStructure: api.outline_structure
      ? (typeof api.outline_structure === 'string' ? JSON.parse(api.outline_structure) : api.outline_structure)
      : undefined,
  }
}

/**
 * Convert HarvestCard to API request format (camelCase for request body)
 * Note: API expects camelCase in requests, returns snake_case in responses
 */
function harvestCardToApiRequest(card: HarvestCard, bookId: string): Record<string, unknown> {
  return {
    id: card.id,
    bookId,
    chapterId: card.suggestedChapterId || null,
    sourceId: card.sourceId,
    sourceType: card.sourceType,
    source: card.source,
    contentOrigin: card.contentOrigin,
    content: card.content,
    title: card.title || null,
    authorName: card.authorName || null,
    similarity: card.similarity || null,
    sourceCreatedAt: card.sourceCreatedAt,
    sourceCreatedAtStatus: card.sourceCreatedAtStatus,
    harvestedAt: card.harvestedAt,
    sourceUrl: card.sourceUrl || null,
    conversationId: card.conversationId || null,
    conversationTitle: card.conversationTitle || null,
    userNotes: card.userNotes,
    aiContext: card.aiContext || null,
    aiSummary: card.aiSummary || null,
    tags: card.tags,
    canvasPosition: card.canvasPosition || null,
    metadata: card.metadata || null,
    grade: card.grade || null,
    isOutline: card.isOutline || false,
    outlineStructure: card.outlineStructure || null,
  }
}

// ============================================================================
// API Client
// ============================================================================

class BookStudioApiClient {
  private getBaseUrl(): string {
    return getApiBase()
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.getBaseUrl()}${path}`
    const token = getAuthToken()

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    }

    // Add auth header if token is available
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    // Handle 401 errors (unauthorized)
    if (response.status === 401) {
      const error = await response.json().catch(() => ({ error: 'Unauthorized' }))
      throw new Error(error.error || 'Unauthorized - please log in')
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `API error: ${response.status}`)
    }

    return response.json()
  }

  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------

  async checkHealth(): Promise<boolean> {
    try {
      await this.fetch<{ status: string }>('/health')
      return true
    } catch {
      return false
    }
  }

  // --------------------------------------------------------------------------
  // Books
  // --------------------------------------------------------------------------

  async listBooks(): Promise<Book[]> {
    const response = await this.fetch<{ books: ApiBook[] }>('/books')
    // For list, return books without full chapter/card data
    return response.books.map(b => apiBookToBook(b))
  }

  async getBook(bookId: string): Promise<Book | null> {
    try {
      // Fetch book and chapters
      const data = await this.fetch<{
        book: ApiBook
        chapters: ApiChapter[]
        cardCounts: { staging: number; placed: number; archived: number }
      }>(`/books/${bookId}`)

      // Fetch cards separately
      const cardsResponse = await this.fetch<{ cards: ApiCard[] }>(`/cards?bookId=${bookId}`)
      const cards = cardsResponse.cards.map(apiCardToHarvestCard)

      // Build cardsByChapter map
      const cardsByChapter: Record<string, string[]> = {}
      for (const card of cards) {
        if (card.suggestedChapterId) {
          if (!cardsByChapter[card.suggestedChapterId]) {
            cardsByChapter[card.suggestedChapterId] = []
          }
          cardsByChapter[card.suggestedChapterId].push(card.id)
        }
      }

      const chapters = data.chapters.map(ch =>
        apiChapterToChapter(ch, cardsByChapter[ch.id] || [])
      )

      return apiBookToBook(data.book, chapters, cards)
    } catch (err) {
      console.error('[api-client] getBook failed:', err)
      return null
    }
  }

  async createBook(title: string, description?: string): Promise<Book> {
    const response = await this.fetch<{ book: ApiBook }>('/books', {
      method: 'POST',
      body: JSON.stringify({ title, description }),
    })
    return apiBookToBook(response.book)
  }

  async updateBook(bookId: string, updates: Partial<Pick<Book, 'title' | 'description' | 'targetWordCount'>>): Promise<Book> {
    const response = await this.fetch<{ book: ApiBook }>(`/books/${bookId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: updates.title,
        description: updates.description,
        target_word_count: updates.targetWordCount,
      }),
    })
    return apiBookToBook(response.book)
  }

  async deleteBook(bookId: string): Promise<void> {
    await this.fetch(`/books/${bookId}`, { method: 'DELETE' })
  }

  // --------------------------------------------------------------------------
  // Chapters
  // --------------------------------------------------------------------------

  async listChapters(bookId: string): Promise<Chapter[]> {
    const response = await this.fetch<{ chapters: ApiChapter[] }>(`/chapters?bookId=${bookId}`)
    return response.chapters.map(ch => apiChapterToChapter(ch))
  }

  async createChapter(bookId: string, title: string, order?: number): Promise<Chapter> {
    const response = await this.fetch<{ chapter: ApiChapter }>('/chapters', {
      method: 'POST',
      body: JSON.stringify({ bookId, title, order }),
    })
    return apiChapterToChapter(response.chapter)
  }

  async createChaptersBatch(bookId: string, titles: string[]): Promise<Chapter[]> {
    // Server expects chapters as array of {title, order?} objects
    const chapters = titles.map(title => ({ title }))
    const response = await this.fetch<{ chapters: ApiChapter[] }>('/chapters/batch', {
      method: 'POST',
      body: JSON.stringify({ bookId, chapters }),
    })
    return response.chapters.map(ch => apiChapterToChapter(ch))
  }

  async updateChapter(chapterId: string, updates: Partial<Pick<Chapter, 'title' | 'content' | 'draftInstructions' | 'wordCount'>>): Promise<Chapter> {
    const response = await this.fetch<{ chapter: ApiChapter }>(`/chapters/${chapterId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: updates.title,
        content: updates.content,
        draft_instructions: updates.draftInstructions,
        word_count: updates.wordCount,
      }),
    })
    return apiChapterToChapter(response.chapter)
  }

  async deleteChapter(chapterId: string): Promise<void> {
    await this.fetch(`/chapters/${chapterId}`, { method: 'DELETE' })
  }

  async reorderChapters(bookId: string, chapterIds: string[]): Promise<void> {
    await this.fetch('/chapters/reorder', {
      method: 'POST',
      body: JSON.stringify({ bookId, chapterIds }),
    })
  }

  // --------------------------------------------------------------------------
  // Cards
  // --------------------------------------------------------------------------

  async listCards(bookId: string): Promise<HarvestCard[]> {
    const response = await this.fetch<{ cards: ApiCard[] }>(`/cards?bookId=${bookId}`)
    return response.cards.map(apiCardToHarvestCard)
  }

  async harvestCard(bookId: string, card: HarvestCard): Promise<HarvestCard> {
    const response = await this.fetch<{ card: ApiCard }>('/cards', {
      method: 'POST',
      body: JSON.stringify(harvestCardToApiRequest(card, bookId)),
    })
    return apiCardToHarvestCard(response.card)
  }

  async harvestCardsBatch(bookId: string, cards: HarvestCard[]): Promise<HarvestCard[]> {
    const response = await this.fetch<{ cards: ApiCard[] }>('/cards/batch', {
      method: 'POST',
      body: JSON.stringify({
        bookId,
        cards: cards.map(c => harvestCardToApiRequest(c, bookId)),
      }),
    })
    return response.cards.map(apiCardToHarvestCard)
  }

  async updateCard(cardId: string, updates: Partial<HarvestCard>): Promise<HarvestCard> {
    const response = await this.fetch<{ card: ApiCard }>(`/cards/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        chapterId: updates.suggestedChapterId,
        userNotes: updates.userNotes,
        aiContext: updates.aiContext,
        tags: updates.tags,
        status: updates.status,
        grade: updates.grade,
        isOutline: updates.isOutline,
        outlineStructure: updates.outlineStructure,
        canvasPosition: updates.canvasPosition,
      }),
    })
    return apiCardToHarvestCard(response.card)
  }

  async moveCardToChapter(cardId: string, chapterId: string): Promise<HarvestCard> {
    const response = await this.fetch<{ card: ApiCard }>(`/cards/${cardId}/move`, {
      method: 'POST',
      body: JSON.stringify({ chapterId }),
    })
    return apiCardToHarvestCard(response.card)
  }

  async deleteCard(cardId: string): Promise<void> {
    await this.fetch(`/cards/${cardId}`, { method: 'DELETE' })
  }

  /**
   * Batch update multiple cards at once
   */
  async batchUpdateCards(
    cardIds: string[],
    updates: Partial<Pick<HarvestCard, 'suggestedChapterId' | 'status' | 'grade' | 'tags'>>
  ): Promise<{ updatedCount: number; cards: HarvestCard[] }> {
    const response = await this.fetch<{ updatedCount: number; cards: ApiCard[] }>('/cards/batch-update', {
      method: 'POST',
      body: JSON.stringify({ cardIds, updates }),
    })
    return {
      updatedCount: response.updatedCount,
      cards: response.cards.map(apiCardToHarvestCard),
    }
  }

  // --------------------------------------------------------------------------
  // Harvest API (Phase 3 Consolidation)
  // --------------------------------------------------------------------------

  /**
   * Search archive for content matching the query
   */
  async harvestSearch(params: {
    bookId: string
    query: string
    chapterId?: string
    similarityThreshold?: number
    limit?: number
    sourceTypes?: string[]
    dateRangeStart?: number
    dateRangeEnd?: number
  }): Promise<{ results: HarvestSearchResult[]; harvestId: string; query: string }> {
    const response = await this.fetch<{
      success: boolean
      data: { results: HarvestSearchResult[]; harvestId: string; query: string }
    }>('/harvest/search', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return response.data
  }

  /**
   * Commit harvest results as cards
   */
  async harvestCommit(params: {
    harvestId: string
    acceptedIds: string[]
    rejectedIds?: string[]
    results?: HarvestSearchResult[]
  }): Promise<{ cards: HarvestCard[]; committed: number; harvestId: string }> {
    const response = await this.fetch<{
      success: boolean
      data: { cards: ApiCard[]; committed: number; harvestId: string }
    }>('/harvest/commit', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return {
      cards: response.data.cards.map(apiCardToHarvestCard),
      committed: response.data.committed,
      harvestId: response.data.harvestId,
    }
  }

  /**
   * Get harvest history for a book
   */
  async getHarvestHistory(
    bookId: string,
    options?: { page?: number; limit?: number; chapterId?: string }
  ): Promise<{ harvests: HarvestHistoryEntry[]; pagination: { page: number; total: number; hasMore: boolean } }> {
    const params = new URLSearchParams()
    if (options?.page) params.set('page', options.page.toString())
    if (options?.limit) params.set('limit', options.limit.toString())
    if (options?.chapterId) params.set('chapterId', options.chapterId)

    const response = await this.fetch<{
      success: boolean
      data: HarvestHistoryEntry[]
      pagination: { page: number; total: number; hasMore: boolean }
    }>(`/harvest/history/${bookId}?${params}`)
    return { harvests: response.data, pagination: response.pagination }
  }

  /**
   * Iterate on a previous harvest with adjustments
   */
  async harvestIterate(
    harvestId: string,
    adjustments: {
      query?: string
      similarityThreshold?: number
      limit?: number
      sourceTypes?: string[]
    },
    notes?: string
  ): Promise<{ results: HarvestSearchResult[]; harvestId: string; query: string }> {
    const response = await this.fetch<{
      success: boolean
      data: { results: HarvestSearchResult[]; harvestId: string; query: string }
    }>(`/harvest/iterate/${harvestId}`, {
      method: 'POST',
      body: JSON.stringify({ adjustments, notes }),
    })
    return response.data
  }

  /**
   * Get query suggestions based on harvest history
   */
  async getHarvestSuggestions(bookId: string): Promise<string[]> {
    const response = await this.fetch<{ success: boolean; data: string[] }>(`/harvest/suggestions/${bookId}`)
    return response.data
  }

  /**
   * Get harvest instructions for a book
   */
  async getHarvestInstructions(bookId: string, chapterId?: string): Promise<HarvestInstruction[]> {
    const params = chapterId ? `?chapterId=${chapterId}` : ''
    const response = await this.fetch<{ success: boolean; data: HarvestInstruction[] }>(
      `/harvest/instructions/${bookId}${params}`
    )
    return response.data
  }

  /**
   * Create a harvest instruction
   */
  async createHarvestInstruction(instruction: Omit<HarvestInstruction, 'id' | 'isActive' | 'createdAt'>): Promise<HarvestInstruction> {
    const response = await this.fetch<{ success: boolean; data: HarvestInstruction }>('/harvest/instructions', {
      method: 'POST',
      body: JSON.stringify(instruction),
    })
    return response.data
  }

  /**
   * Delete a harvest instruction
   */
  async deleteHarvestInstruction(instructionId: string): Promise<void> {
    await this.fetch(`/harvest/instructions/${instructionId}`, { method: 'DELETE' })
  }

  /**
   * Toggle harvest instruction active state
   */
  async toggleHarvestInstruction(instructionId: string, active: boolean): Promise<void> {
    await this.fetch(`/harvest/instructions/${instructionId}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    })
  }

  // --------------------------------------------------------------------------
  // Draft API (Phase 3 Consolidation)
  // --------------------------------------------------------------------------

  /**
   * Generate a new draft for a chapter via Ollama LLM
   */
  async generateDraft(params: {
    chapterId: string
    bookId: string
    cardIds?: string[]
    voiceId?: string
    model?: string
    temperature?: number
    maxTokens?: number
    prompt?: string
  }): Promise<{ draft: DraftVersion; generationTime: number }> {
    const response = await this.fetch<{
      success: boolean
      data: { draft: DraftVersion; generationTime: number }
    }>('/draft/generate', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return response.data
  }

  /**
   * Save a manually created draft version
   */
  async saveDraft(params: {
    chapterId: string
    bookId: string
    content: string
    voiceId?: string
  }): Promise<DraftVersion> {
    const response = await this.fetch<{ success: boolean; data: DraftVersion }>('/draft/save', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return response.data
  }

  /**
   * Get all draft versions for a chapter
   */
  async getDraftVersions(chapterId: string): Promise<DraftVersion[]> {
    const response = await this.fetch<{ success: boolean; data: DraftVersion[] }>(`/draft/versions/${chapterId}`)
    return response.data
  }

  /**
   * Get a specific draft version
   */
  async getDraftVersion(versionId: string): Promise<DraftVersion | null> {
    try {
      const response = await this.fetch<{ success: boolean; data: DraftVersion }>(`/draft/${versionId}`)
      return response.data
    } catch {
      return null
    }
  }

  /**
   * Get the latest draft version for a chapter
   */
  async getLatestDraft(chapterId: string): Promise<DraftVersion | null> {
    try {
      const response = await this.fetch<{ success: boolean; data: DraftVersion }>(`/draft/latest/${chapterId}`)
      return response.data
    } catch {
      return null
    }
  }

  /**
   * Compare two draft versions
   */
  async compareDrafts(v1: string, v2: string): Promise<DraftComparison | null> {
    try {
      const response = await this.fetch<{ success: boolean; data: DraftComparison }>(`/draft/compare?v1=${v1}&v2=${v2}`)
      return response.data
    } catch {
      return null
    }
  }

  /**
   * Update review status of a draft version
   */
  async reviewDraft(versionId: string, status: DraftVersion['reviewStatus'], notes?: string): Promise<void> {
    await this.fetch(`/draft/${versionId}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ status, notes }),
    })
  }

  /**
   * Set quality score for a draft version
   */
  async scoreDraft(versionId: string, score: number): Promise<void> {
    await this.fetch(`/draft/${versionId}/score`, {
      method: 'PATCH',
      body: JSON.stringify({ score }),
    })
  }

  /**
   * Accept a draft version and copy its content to the chapter
   */
  async acceptDraft(versionId: string): Promise<Chapter> {
    const response = await this.fetch<{ success: boolean; data: ApiChapter }>(`/draft/accept/${versionId}`, {
      method: 'POST',
    })
    return apiChapterToChapter(response.data)
  }

  /**
   * Delete a draft version
   */
  async deleteDraft(versionId: string): Promise<void> {
    await this.fetch(`/draft/${versionId}`, { method: 'DELETE' })
  }

  /**
   * Check if draft generation is available (Ollama health)
   */
  async checkDraftHealth(): Promise<{ available: boolean; model?: string; error?: string }> {
    const response = await this.fetch<{ success: boolean; data: { available: boolean; model?: string; error?: string } }>('/draft/health')
    return response.data
  }

  // --------------------------------------------------------------------------
  // Voice API (Phase 3 Consolidation)
  // --------------------------------------------------------------------------

  /**
   * Extract a voice profile from cards
   */
  async extractVoice(params: {
    bookId: string
    cardIds: string[]
    name?: string
    description?: string
  }): Promise<VoiceProfile> {
    const response = await this.fetch<{ success: boolean; data: VoiceProfile }>('/voice/extract', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return response.data
  }

  /**
   * List all voices for a book
   */
  async listVoices(bookId: string): Promise<VoiceProfile[]> {
    const response = await this.fetch<{ success: boolean; data: VoiceProfile[] }>(`/voice/${bookId}`)
    return response.data
  }

  /**
   * Get a specific voice profile
   */
  async getVoice(voiceId: string): Promise<VoiceProfile | null> {
    try {
      const response = await this.fetch<{ success: boolean; data: VoiceProfile }>(`/voice/detail/${voiceId}`)
      return response.data
    } catch {
      return null
    }
  }

  /**
   * Create a manual voice profile
   */
  async createVoice(params: {
    bookId: string
    name: string
    description?: string
    sampleText: string
  }): Promise<VoiceProfile> {
    const response = await this.fetch<{ success: boolean; data: VoiceProfile }>('/voice/create', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return response.data
  }

  /**
   * Update a voice profile
   */
  async updateVoice(voiceId: string, updates: { name?: string; description?: string; sampleText?: string }): Promise<VoiceProfile> {
    const response = await this.fetch<{ success: boolean; data: VoiceProfile }>(`/voice/${voiceId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
    return response.data
  }

  /**
   * Delete a voice profile
   */
  async deleteVoice(voiceId: string): Promise<void> {
    await this.fetch(`/voice/${voiceId}`, { method: 'DELETE' })
  }

  /**
   * Set a voice as primary for its book
   */
  async setPrimaryVoice(voiceId: string): Promise<void> {
    await this.fetch(`/voice/${voiceId}/primary`, { method: 'POST' })
  }

  /**
   * Apply a voice to transform content
   */
  async applyVoice(params: {
    voiceId: string
    content: string
    strengthFactor?: number
  }): Promise<VoiceApplicationResult> {
    const response = await this.fetch<{ success: boolean; data: VoiceApplicationResult }>('/voice/apply', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return response.data
  }

  /**
   * Get extracted features for a voice
   */
  async getVoiceFeatures(voiceId: string): Promise<VoiceProfile['extractedFeatures']> {
    const response = await this.fetch<{ success: boolean; data: VoiceProfile['extractedFeatures'] }>(`/voice/${voiceId}/features`)
    return response.data
  }
}

// ============================================================================
// WebSocket Manager
// ============================================================================

export interface BookEvent {
  type: string
  bookId: string
  entityType?: string
  entityId?: string
  payload?: unknown
  timestamp: number
}

type EventHandler = (event: BookEvent) => void

class WebSocketManager {
  private ws: WebSocket | null = null
  private subscriptions: Set<string> = new Set()
  private handlers: Set<EventHandler> = new Set()
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5

  private getUrl(): string {
    const baseUrl = getWsUrl()
    const token = getAuthToken()

    // Append token as query parameter for WebSocket auth
    if (token) {
      const separator = baseUrl.includes('?') ? '&' : '?'
      return `${baseUrl}${separator}token=${encodeURIComponent(token)}`
    }

    return baseUrl
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return

    try {
      this.ws = new WebSocket(this.getUrl())

      this.ws.onopen = () => {
        console.log('[book-studio-ws] Connected')
        this.reconnectAttempts = 0
        // Re-subscribe to any books we were watching
        for (const bookId of this.subscriptions) {
          this.send({ type: 'subscribe', bookId })
        }
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as BookEvent
          for (const handler of this.handlers) {
            handler(data)
          }
        } catch (err) {
          console.error('[book-studio-ws] Failed to parse message:', err)
        }
      }

      this.ws.onclose = () => {
        console.log('[book-studio-ws] Disconnected')
        this.ws = null
        this.scheduleReconnect()
      }

      this.ws.onerror = (err) => {
        console.error('[book-studio-ws] Error:', err)
      }
    } catch (err) {
      console.error('[book-studio-ws] Failed to connect:', err)
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[book-studio-ws] Max reconnect attempts reached')
      return
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    console.log(`[book-studio-ws] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      this.connect()
    }, delay)
  }

  private send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  subscribe(bookId: string): void {
    this.subscriptions.add(bookId)
    this.send({ type: 'subscribe', bookId })
  }

  unsubscribe(bookId: string): void {
    this.subscriptions.delete(bookId)
    this.send({ type: 'unsubscribe', bookId })
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.subscriptions.clear()
    this.handlers.clear()
  }
}

// ============================================================================
// Singleton Instances
// ============================================================================

export const apiClient = new BookStudioApiClient()
export const wsManager = new WebSocketManager()

// ============================================================================
// Convenience Functions (matching persistence.ts interface)
// ============================================================================

export async function loadLibraryFromApi(): Promise<{ books: Book[]; activeBookId: string | null }> {
  try {
    const books = await apiClient.listBooks()
    const activeBookId = localStorage.getItem('book-studio-active-book-id')
    return {
      books,
      activeBookId: activeBookId && books.some(b => b.id === activeBookId) ? activeBookId : null,
    }
  } catch (err) {
    console.error('[api-client] Failed to load library:', err)
    return { books: [], activeBookId: null }
  }
}

export async function loadBookWithDetails(bookId: string): Promise<Book | null> {
  return apiClient.getBook(bookId)
}

export { BookStudioApiClient, WebSocketManager }

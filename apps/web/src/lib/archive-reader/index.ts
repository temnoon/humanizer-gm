/**
 * Archive Reader - Read-only access to humanizer-gm archives
 *
 * This module provides a clean interface to the archive server running
 * on localhost:3002 (dynamic port in Electron).
 *
 * IMPORTANT: This is READ-ONLY. No modifications to the archive.
 */

import { getArchiveServerUrl } from '../platform'

// Cache the API base URL after first fetch
let _apiBase: string | null = null

async function getApiBase(): Promise<string> {
  if (_apiBase) return _apiBase
  const serverUrl = await getArchiveServerUrl()
  _apiBase = `${serverUrl}/api`
  return _apiBase
}

// ============================================================================
// Types
// ============================================================================

export type ContentType = 'message' | 'post' | 'comment' | 'document' | 'note' | 'image' | 'web'

// Distinguishes author's content from external reference material
export type SourceType = 'original' | 'reference'

export interface SearchResult {
  id: string
  type: ContentType
  source: string // 'conversation' | 'facebook' | 'web' | etc
  sourceType: SourceType // 'original' = author's content, 'reference' = external
  content: string
  title?: string
  similarity: number
  // Message-specific
  conversationId?: string
  conversationTitle?: string
  conversationFolder?: string
  messageRole?: 'user' | 'assistant'
  // Content-specific
  authorName?: string
  createdAt?: string | number // Unix timestamp (seconds or ms) or ISO string
  isOwnContent?: boolean
  // Extended metadata
  sourceUrl?: string // Link to original content (if available)
  metadata?: Record<string, unknown> // Full metadata including external_url
}

export interface UnifiedSearchResponse {
  query: string
  results: SearchResult[]
  total: number
  stats?: {
    messageCount: number
    contentCount: number
  }
}

export interface EmbeddingStats {
  totalEmbeddings: number
  totalConversations: number
  totalMessages: number
  totalChunks: number
  modelLoaded: boolean
}

export interface ArchiveHealth {
  ready: boolean
  stats?: EmbeddingStats
  issues?: string[]
  indexingProgress?: {
    isIndexing: boolean
    progress: number
    phase: string
  }
}

export interface ContentItem {
  id: string
  type: string
  source: string
  text: string
  title?: string
  created_at: string
  author_name?: string
  is_own_content: boolean
}

export interface Period {
  period: string // e.g., "Q1_2024"
  year: number
  quarter: number
  count: number
  start_date: string
  end_date: string
}

// ============================================================================
// Health & Status
// ============================================================================

// Cache health check result for 30 seconds
let _healthCache: { result: ArchiveHealth; timestamp: number } | null = null
const HEALTH_CACHE_TTL = 30 * 1000 // 30 seconds

/**
 * Check if the archive server is available and ready
 * Results are cached for 30 seconds to prevent rate limiting
 */
export async function checkHealth(): Promise<ArchiveHealth> {
  // Return cached result if still valid
  if (_healthCache && Date.now() - _healthCache.timestamp < HEALTH_CACHE_TTL) {
    return _healthCache.result
  }

  try {
    const response = await fetch(`${await getApiBase()}/embeddings/health`)
    if (!response.ok) {
      const result = { ready: false, issues: [`HTTP ${response.status}`] }
      _healthCache = { result, timestamp: Date.now() }
      return result
    }
    const result = await response.json()
    _healthCache = { result, timestamp: Date.now() }
    return result
  } catch (error) {
    const result = { ready: false, issues: [String(error)] }
    _healthCache = { result, timestamp: Date.now() }
    return result
  }
}

/**
 * Get embedding statistics
 */
export async function getStats(): Promise<EmbeddingStats | null> {
  try {
    const response = await fetch(`${await getApiBase()}/embeddings/stats`)
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}

// ============================================================================
// Search
// ============================================================================

export interface SearchOptions {
  limit?: number
  sources?: string[] // ['conversation', 'facebook']
  types?: ContentType[]
  includeMessages?: boolean
  includeContentItems?: boolean
  // Flexible metadata filters - key/value pairs matched against result metadata
  metadataFilters?: Record<string, string | number | boolean>
  // Role filter for messages
  role?: 'user' | 'assistant'
  // Date range filter (ISO strings or Unix timestamps)
  dateRange?: { start?: string | number; end?: string | number }
}

/**
 * Unified semantic search across all content
 * This is the primary search method for Book Studio
 *
 * Supports flexible metadata filtering via metadataFilters option.
 * Server-side filtering is used where available, with client-side
 * filtering as fallback for metadata fields.
 */
export async function unifiedSearch(
  query: string,
  options: SearchOptions = {}
): Promise<UnifiedSearchResponse> {
  const {
    limit = 20,
    sources,
    types,
    includeMessages = true,
    includeContentItems = true,
    metadataFilters,
    role,
    dateRange,
  } = options

  // Request more results if we're going to filter client-side
  const hasClientFilters = metadataFilters || role || dateRange
  const requestLimit = hasClientFilters ? Math.min(limit * 3, 100) : limit

  try {
    const response = await fetch(`${await getApiBase()}/embeddings/search/unified`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        limit: requestLimit,
        sources,
        types,
        includeMessages,
        includeContentItems,
        // Pass role to server if supported (messages endpoint)
        role,
      }),
    })

    if (!response.ok) {
      console.error('Unified search failed:', response.status)
      return { query, results: [], total: 0 }
    }

    let data: UnifiedSearchResponse = await response.json()

    // Apply client-side filters
    if (hasClientFilters && data.results.length > 0) {
      data.results = applyClientFilters(data.results, { metadataFilters, role, dateRange })
      data.results = data.results.slice(0, limit)
      data.total = data.results.length
    }

    return data
  } catch (error) {
    console.error('Unified search error:', error)
    return { query, results: [], total: 0 }
  }
}

/**
 * Apply client-side filters to search results
 * Used for metadata filtering when server doesn't support it natively
 */
function applyClientFilters(
  results: SearchResult[],
  filters: {
    metadataFilters?: Record<string, string | number | boolean>
    role?: 'user' | 'assistant'
    dateRange?: { start?: string | number; end?: string | number }
  }
): SearchResult[] {
  const { metadataFilters, role, dateRange } = filters

  return results.filter((result) => {
    // Role filter
    if (role && result.messageRole && result.messageRole !== role) {
      return false
    }

    // Date range filter
    if (dateRange) {
      const resultDate = result.createdAt
        ? typeof result.createdAt === 'number'
          ? result.createdAt
          : new Date(result.createdAt).getTime() / 1000
        : null

      if (resultDate) {
        if (dateRange.start) {
          const startTs = typeof dateRange.start === 'number'
            ? dateRange.start
            : new Date(dateRange.start).getTime() / 1000
          if (resultDate < startTs) return false
        }
        if (dateRange.end) {
          const endTs = typeof dateRange.end === 'number'
            ? dateRange.end
            : new Date(dateRange.end).getTime() / 1000
          if (resultDate > endTs) return false
        }
      }
    }

    // Metadata filters - check each key/value pair
    if (metadataFilters && result.metadata) {
      for (const [key, value] of Object.entries(metadataFilters)) {
        const metaValue = getNestedValue(result.metadata, key)
        if (metaValue !== value) {
          return false
        }
      }
    }

    return true
  })
}

/**
 * Get nested value from object using dot notation
 * e.g., getNestedValue(obj, 'a.b.c') returns obj.a.b.c
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((current, key) => {
    return current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined
  }, obj as unknown)
}

/**
 * Search only messages (conversations)
 */
export async function searchMessages(
  query: string,
  limit: number = 20
): Promise<SearchResult[]> {
  try {
    const response = await fetch(`${await getApiBase()}/embeddings/search/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit }),
    })

    if (!response.ok) return []
    const data = await response.json()
    return data.results || []
  } catch {
    return []
  }
}

/**
 * Find content similar to a given message or embedding
 */
export async function findSimilar(
  messageId: string,
  limit: number = 10
): Promise<SearchResult[]> {
  try {
    const response = await fetch(`${await getApiBase()}/embeddings/search/similar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, limit }),
    })

    if (!response.ok) return []
    const data = await response.json()
    return data.results || []
  } catch {
    return []
  }
}

// ============================================================================
// Content Items (Facebook, etc.)
// ============================================================================

export interface ContentListOptions {
  type?: string // 'post', 'comment', 'note'
  source?: string // 'facebook', etc
  ownOnly?: boolean
  period?: string // 'Q1_2024'
  search?: string // text search
  limit?: number
  offset?: number
}

/**
 * List content items with filters
 */
export async function listContent(
  options: ContentListOptions = {}
): Promise<{ items: ContentItem[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams()
  if (options.type) params.set('type', options.type)
  if (options.source) params.set('source', options.source)
  if (options.ownOnly) params.set('own_only', 'true')
  if (options.period) params.set('period', options.period)
  if (options.search) params.set('search', options.search)
  if (options.limit) params.set('limit', String(options.limit))
  if (options.offset) params.set('offset', String(options.offset))

  try {
    const response = await fetch(`${await getApiBase()}/content/items?${params}`)
    if (!response.ok) {
      return { items: [], total: 0, hasMore: false }
    }
    return response.json()
  } catch {
    return { items: [], total: 0, hasMore: false }
  }
}

/**
 * Get available time periods (for timeline browsing)
 */
export async function getPeriods(): Promise<Period[]> {
  try {
    const response = await fetch(`${await getApiBase()}/facebook/periods`)
    if (!response.ok) return []
    const data = await response.json()
    return data.periods || []
  } catch {
    return []
  }
}

// ============================================================================
// Images
// ============================================================================

export interface ImageAnalysis {
  id: string
  file_path: string
  description: string
  categories?: string[]
  objects?: string[]
  scene?: string
  mood?: string
}

/**
 * Semantic search through image descriptions
 */
export async function searchImages(
  query: string,
  limit: number = 20
): Promise<ImageAnalysis[]> {
  try {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    const response = await fetch(
      `${await getApiBase()}/gallery/analysis/semantic-search?${params}`
    )
    if (!response.ok) return []
    const data = await response.json()
    return data.results || []
  } catch {
    return []
  }
}

// ============================================================================
// Archives
// ============================================================================

export interface Archive {
  name: string
  path: string
  conversationCount?: number
  indexExists?: boolean
}

/**
 * List available archives
 */
export async function listArchives(): Promise<{
  current: string
  archives: Archive[]
}> {
  try {
    const response = await fetch(`${await getApiBase()}/archives`)
    if (!response.ok) {
      return { current: '', archives: [] }
    }
    return response.json()
  } catch {
    return { current: '', archives: [] }
  }
}

// ============================================================================
// Web Search (Reference Material)
// ============================================================================

export interface WebSearchOptions {
  limit?: number
  freshness?: 'day' | 'week' | 'month' | 'year' // How recent
}

export interface WebSearchResult {
  title: string
  url: string
  description: string
  publishedDate?: string
  siteName?: string
}

/**
 * Search the web for reference material
 *
 * IMPORTANT: Web results are REFERENCE material, not the author's content.
 * They should inform the writing but not be treated as the author's voice.
 *
 * Uses Brave Search API via the archive server.
 */
export async function webSearch(
  query: string,
  options: WebSearchOptions = {}
): Promise<{ results: SearchResult[]; raw: WebSearchResult[] }> {
  const { limit = 10, freshness } = options

  try {
    const response = await fetch(`${await getApiBase()}/web/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit, freshness }),
    })

    if (!response.ok) {
      console.error('Web search failed:', response.status)
      return { results: [], raw: [] }
    }

    const data = await response.json()
    const raw: WebSearchResult[] = data.results || []

    // Transform to SearchResult format with sourceType: 'reference'
    const results: SearchResult[] = raw.map((item, idx) => ({
      id: `web-${Date.now()}-${idx}`,
      type: 'web' as ContentType,
      source: 'web',
      sourceType: 'reference' as SourceType, // IMPORTANT: Web content is reference, not original
      content: item.description,
      title: item.title,
      similarity: 1 - (idx * 0.05), // Rank-based pseudo-similarity
      sourceUrl: item.url,
      authorName: item.siteName,
      createdAt: item.publishedDate,
      metadata: {
        url: item.url,
        siteName: item.siteName,
        isReference: true, // Flag for draft generator
      },
    }))

    return { results, raw }
  } catch (error) {
    console.error('Web search error:', error)
    return { results: [], raw: [] }
  }
}

/**
 * Check if web search is configured and available
 */
export async function checkWebSearchAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${await getApiBase()}/web/status`)
    if (!response.ok) return false
    const data = await response.json()
    return data.available === true
  } catch {
    return false
  }
}

// ============================================================================
// URL Content Fetching
// ============================================================================

export interface FetchedContent {
  url: string
  title: string
  content: string
  wordCount: number
  siteName: string
}

/**
 * Fetch and extract full article content from a URL
 *
 * Use this to get full article text instead of just snippets from search results.
 * Returns extracted main content (reader-mode style).
 */
export async function fetchUrlContent(url: string): Promise<FetchedContent | null> {
  try {
    const response = await fetch(`${await getApiBase()}/web/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })

    if (!response.ok) {
      console.error('URL fetch failed:', response.status)
      return null
    }

    return response.json()
  } catch (error) {
    console.error('URL fetch error:', error)
    return null
  }
}

/**
 * Fetch full content for a web search result
 * Replaces the snippet with full article text
 */
export async function enrichWebResult(result: SearchResult): Promise<SearchResult> {
  if (!result.sourceUrl) {
    return result
  }

  const content = await fetchUrlContent(result.sourceUrl)
  if (!content) {
    return result
  }

  return {
    ...result,
    content: content.content,
    title: content.title || result.title,
    metadata: {
      ...result.metadata,
      wordCount: content.wordCount,
      enriched: true,
    },
  }
}

// ============================================================================
// Conversation Context (for viewing full messages and conversations)
// ============================================================================

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt: number
  parentId?: string
}

export interface Conversation {
  id: string
  folder: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  messages?: Message[]
  metadata?: Record<string, unknown>
}

/**
 * Get a conversation by folder name or ID
 */
export async function getConversation(folderOrId: string): Promise<Conversation | null> {
  try {
    const response = await fetch(`${await getApiBase()}/conversations/${encodeURIComponent(folderOrId)}`)
    if (!response.ok) {
      console.error('Failed to get conversation:', response.status)
      return null
    }
    return response.json()
  } catch (error) {
    console.error('Error fetching conversation:', error)
    return null
  }
}

/**
 * Find a specific message within a conversation and return context
 * Returns the message, plus surrounding messages for context
 */
export async function getMessageContext(
  conversationFolderOrId: string,
  messageContent: string,
  contextSize: number = 3
): Promise<{
  message: Message | null
  previousMessages: Message[]
  nextMessages: Message[]
  conversation: Conversation | null
} | null> {
  const conversation = await getConversation(conversationFolderOrId)
  if (!conversation || !conversation.messages) {
    return null
  }

  // Find the message by matching content (partial match for chunks)
  const normalizedSearch = messageContent.toLowerCase().trim()
  const messageIndex = conversation.messages.findIndex(
    m => m.content.toLowerCase().includes(normalizedSearch.slice(0, 100))
  )

  if (messageIndex === -1) {
    return {
      message: null,
      previousMessages: [],
      nextMessages: [],
      conversation,
    }
  }

  const message = conversation.messages[messageIndex]
  const previousMessages = conversation.messages.slice(
    Math.max(0, messageIndex - contextSize),
    messageIndex
  )
  const nextMessages = conversation.messages.slice(
    messageIndex + 1,
    messageIndex + 1 + contextSize
  )

  return {
    message,
    previousMessages,
    nextMessages,
    conversation,
  }
}

/**
 * Get the next message in a conversation (useful for "show response" feature)
 */
export async function getNextMessage(
  conversationFolderOrId: string,
  messageContent: string
): Promise<Message | null> {
  const context = await getMessageContext(conversationFolderOrId, messageContent, 1)
  if (!context || context.nextMessages.length === 0) {
    return null
  }
  return context.nextMessages[0]
}

/**
 * List conversations with optional filtering
 */
export async function listConversations(options: {
  search?: string
  limit?: number
  offset?: number
  sortBy?: 'created_at' | 'updated_at' | 'title'
  sortOrder?: 'asc' | 'desc'
} = {}): Promise<{ conversations: Conversation[]; total: number }> {
  const params = new URLSearchParams()
  if (options.search) params.set('search', options.search)
  if (options.limit) params.set('limit', String(options.limit))
  if (options.offset) params.set('offset', String(options.offset))
  if (options.sortBy) params.set('sort_by', options.sortBy)
  if (options.sortOrder) params.set('sort_order', options.sortOrder)

  try {
    const response = await fetch(`${await getApiBase()}/conversations?${params}`)
    if (!response.ok) {
      return { conversations: [], total: 0 }
    }
    return response.json()
  } catch {
    return { conversations: [], total: 0 }
  }
}

// ============================================================================
// Metadata-based Filtering
// ============================================================================

export interface MetadataValueInfo {
  value: string | number | boolean
  count: number
  sampleTitles: string[]
  firstSeen?: number
  lastSeen?: number
}

/**
 * Group conversations by a specific metadata field
 * Generic function - works with any metadata field (gizmo_id, model, etc.)
 *
 * @param fieldPath - Dot-notation path to metadata field (e.g., 'gizmo_id', 'settings.model')
 * @param limit - Max conversations to scan
 */
export async function groupConversationsByMetadata(
  fieldPath: string,
  limit: number = 1000
): Promise<MetadataValueInfo[]> {
  try {
    const { conversations } = await listConversations({ limit, sortBy: 'updated_at', sortOrder: 'desc' })

    const valueMap = new Map<string | number | boolean, {
      count: number
      titles: string[]
      firstSeen: number
      lastSeen: number
    }>()

    for (const conv of conversations) {
      if (!conv.metadata) continue

      const value = getNestedValue(conv.metadata, fieldPath)
      if (value === undefined || value === null) continue
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue

      const existing = valueMap.get(value)
      if (existing) {
        existing.count++
        if (existing.titles.length < 5) existing.titles.push(conv.title)
        existing.firstSeen = Math.min(existing.firstSeen, conv.createdAt)
        existing.lastSeen = Math.max(existing.lastSeen, conv.updatedAt)
      } else {
        valueMap.set(value, {
          count: 1,
          titles: [conv.title],
          firstSeen: conv.createdAt,
          lastSeen: conv.updatedAt,
        })
      }
    }

    return Array.from(valueMap.entries())
      .map(([value, data]) => ({
        value,
        count: data.count,
        sampleTitles: data.titles,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
      }))
      .sort((a, b) => b.count - a.count)
  } catch (error) {
    console.error('Error grouping by metadata:', error)
    return []
  }
}

/**
 * Get conversations matching a specific metadata value
 * Generic function - works with any metadata field
 *
 * @param fieldPath - Dot-notation path to metadata field
 * @param value - Value to match
 * @param limit - Max results
 */
export async function getConversationsByMetadata(
  fieldPath: string,
  value: string | number | boolean,
  limit: number = 50
): Promise<Conversation[]> {
  try {
    const { conversations } = await listConversations({ limit: 1000 })

    return conversations
      .filter(c => {
        if (!c.metadata) return false
        const metaValue = getNestedValue(c.metadata, fieldPath)
        return metaValue === value
      })
      .slice(0, limit)
  } catch {
    return []
  }
}

// ============================================================================
// Metadata Discovery
// ============================================================================

export interface MetadataFieldInfo {
  field: string
  values: Array<{ value: string | number | boolean; count: number }>
  type: 'string' | 'number' | 'boolean' | 'mixed'
}

/**
 * Discover available metadata fields and their values from conversations
 * Useful for building dynamic filter UIs
 *
 * @param sampleSize - Number of conversations to sample (default 500)
 * @param fields - Specific fields to analyze (or all if not specified)
 */
export async function discoverMetadataFields(
  sampleSize: number = 500,
  fields?: string[]
): Promise<MetadataFieldInfo[]> {
  try {
    const { conversations } = await listConversations({
      limit: sampleSize,
      sortBy: 'updated_at',
      sortOrder: 'desc',
    })

    // Collect field values
    const fieldMap = new Map<string, Map<string | number | boolean, number>>()
    const fieldTypes = new Map<string, Set<string>>()

    for (const conv of conversations) {
      if (!conv.metadata) continue

      const processField = (key: string, value: unknown, prefix = '') => {
        const fullKey = prefix ? `${prefix}.${key}` : key

        if (fields && !fields.some(f => fullKey.startsWith(f))) {
          return // Skip if not in requested fields
        }

        if (value === null || value === undefined) return

        if (typeof value === 'object' && !Array.isArray(value)) {
          // Recurse into nested objects
          for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
            processField(nestedKey, nestedValue, fullKey)
          }
        } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          // Track field values
          if (!fieldMap.has(fullKey)) {
            fieldMap.set(fullKey, new Map())
            fieldTypes.set(fullKey, new Set())
          }
          const valueMap = fieldMap.get(fullKey)!
          valueMap.set(value, (valueMap.get(value) || 0) + 1)
          fieldTypes.get(fullKey)!.add(typeof value)
        }
      }

      for (const [key, value] of Object.entries(conv.metadata)) {
        processField(key, value)
      }
    }

    // Convert to output format
    const result: MetadataFieldInfo[] = []
    for (const [field, valueMap] of fieldMap) {
      // Only include fields with reasonable number of unique values (< 100)
      if (valueMap.size > 100) continue

      const types = fieldTypes.get(field)!
      const type = types.size === 1 ? [...types][0] as 'string' | 'number' | 'boolean' : 'mixed'

      const values = [...valueMap.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20) // Top 20 values

      result.push({ field, values, type })
    }

    // Sort by number of occurrences
    return result.sort((a, b) => {
      const totalA = a.values.reduce((sum, v) => sum + v.count, 0)
      const totalB = b.values.reduce((sum, v) => sum + v.count, 0)
      return totalB - totalA
    })
  } catch (error) {
    console.error('Error discovering metadata fields:', error)
    return []
  }
}


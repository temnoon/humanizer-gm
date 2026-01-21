/**
 * Semantic Clustering Service
 *
 * Clusters harvest cards by semantic similarity using the archive's
 * embedding infrastructure. Uses a greedy seed-based approach:
 * 1. Pick first unclustered card as seed
 * 2. Find all similar cards above threshold
 * 3. Form a cluster
 * 4. Repeat until all cards clustered
 *
 * NOTE: As of Jan 2026, business logic has moved to server-side.
 * Use clusterCardsViaApi when bookId is available.
 * Local clusterCardsSemantically is kept as fallback.
 */

import { unifiedSearch } from '../archive-reader'
import { getConfig } from './config'
import type { HarvestCard } from './types'
import { computeClusters as apiComputeClusters, type ClusteringResult } from './clustering-api'

export interface SemanticCluster {
  id: string
  name: string
  theme?: string // AI-generated theme label
  cards: HarvestCard[]
  seedCard: HarvestCard
  avgSimilarity: number
}

export interface ClusteringConfig {
  similarityThreshold: number // 0.0-1.0, default 0.55
  minClusterSize: number // Minimum cards to form cluster, default 2
  maxClusters: number // Maximum clusters to create, default 10
}

/**
 * Get clustering config from centralized config system
 */
function getClusteringConfig(): ClusteringConfig {
  const config = getConfig()
  return {
    similarityThreshold: config.clustering.similarityThreshold,
    minClusterSize: config.clustering.minClusterSize,
    maxClusters: config.clustering.maxClusters,
  }
}

/**
 * Cluster cards by semantic similarity
 */
export async function clusterCardsSemantically(
  cards: HarvestCard[],
  config: Partial<ClusteringConfig> = {},
  onProgress?: (progress: { phase: string; current: number; total: number }) => void
): Promise<SemanticCluster[]> {
  const defaults = getClusteringConfig()
  const cfg = { ...defaults, ...config }
  const clusters: SemanticCluster[] = []
  const clustered = new Set<string>()

  if (cards.length === 0) return []

  // Build a similarity matrix by querying each card
  onProgress?.({ phase: 'Computing similarities', current: 0, total: cards.length })

  const similarityMap = new Map<string, Map<string, number>>()

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    onProgress?.({ phase: 'Computing similarities', current: i + 1, total: cards.length })

    // Use the card's content as a semantic search query
    // This finds other content semantically similar to this card
    const searchQuery = card.content.slice(0, 500) // Limit query length

    try {
      const fullConfig = getConfig()
      const results = await unifiedSearch(searchQuery, {
        limit: fullConfig.clustering.searchLimit,
        includeMessages: true,
        includeContentItems: true,
      })

      // Map results back to our cards by sourceId
      const cardSimilarities = new Map<string, number>()

      for (const result of results.results) {
        // Find matching card by sourceId
        const matchingCard = cards.find(c => c.sourceId === result.id)
        if (matchingCard && matchingCard.id !== card.id) {
          cardSimilarities.set(matchingCard.id, result.similarity)
        }
      }

      similarityMap.set(card.id, cardSimilarities)
    } catch (error) {
      console.error('Similarity search failed for card:', card.id, error)
      similarityMap.set(card.id, new Map())
    }

    // Small delay to avoid overwhelming the server
    if (i < cards.length - 1) {
      const delay = getConfig().clustering.searchDelayMs
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  // Greedy clustering
  onProgress?.({ phase: 'Forming clusters', current: 0, total: cards.length })

  const remainingCards = [...cards]
  let clusterIndex = 0

  while (remainingCards.length > 0 && clusters.length < cfg.maxClusters) {
    // Pick the first unclustered card as seed
    const seed = remainingCards[0]
    const clusterCards: HarvestCard[] = [seed]
    const similarities: number[] = []

    clustered.add(seed.id)
    remainingCards.splice(0, 1)

    // Find all cards similar to the seed
    const seedSimilarities = similarityMap.get(seed.id) || new Map()

    for (let i = remainingCards.length - 1; i >= 0; i--) {
      const candidate = remainingCards[i]
      const similarity = seedSimilarities.get(candidate.id) || 0

      if (similarity >= cfg.similarityThreshold) {
        clusterCards.push(candidate)
        similarities.push(similarity)
        clustered.add(candidate.id)
        remainingCards.splice(i, 1)
      }
    }

    // Also check if any remaining cards are similar to cards we've added
    // This creates more cohesive clusters
    let changed = true
    while (changed && remainingCards.length > 0) {
      changed = false
      for (let i = remainingCards.length - 1; i >= 0; i--) {
        const candidate = remainingCards[i]

        // Check similarity to any card in the cluster
        for (const clusterCard of clusterCards) {
          const cardSims = similarityMap.get(clusterCard.id)
          const similarity = cardSims?.get(candidate.id) || 0

          if (similarity >= cfg.similarityThreshold) {
            clusterCards.push(candidate)
            similarities.push(similarity)
            clustered.add(candidate.id)
            remainingCards.splice(i, 1)
            changed = true
            break
          }
        }
      }
    }

    // Only create cluster if it meets minimum size
    if (clusterCards.length >= cfg.minClusterSize) {
      const avgSim = similarities.length > 0
        ? similarities.reduce((a, b) => a + b, 0) / similarities.length
        : 1.0

      clusters.push({
        id: `semantic-${clusterIndex}`,
        name: `Theme ${clusterIndex + 1}`,
        cards: clusterCards,
        seedCard: seed,
        avgSimilarity: avgSim,
      })

      clusterIndex++
    } else {
      // Put lone cards back for the "unclustered" group
      for (const card of clusterCards) {
        if (card.id !== seed.id) {
          remainingCards.push(card)
          clustered.delete(card.id)
        }
      }
    }

    onProgress?.({
      phase: 'Forming clusters',
      current: cards.length - remainingCards.length,
      total: cards.length
    })
  }

  // Add unclustered cards as their own "cluster"
  if (remainingCards.length > 0) {
    clusters.push({
      id: 'unclustered',
      name: 'Unclustered',
      cards: remainingCards,
      seedCard: remainingCards[0],
      avgSimilarity: 0,
    })
  }

  // Generate theme labels for clusters
  onProgress?.({ phase: 'Analyzing themes', current: 0, total: clusters.length })

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i]
    if (cluster.id !== 'unclustered') {
      cluster.theme = generateThemeLabel(cluster.cards)
      cluster.name = cluster.theme
    }
    onProgress?.({ phase: 'Analyzing themes', current: i + 1, total: clusters.length })
  }

  return clusters
}

/**
 * Generate a theme label from cluster cards
 * This is a simple heuristic - could be enhanced with LLM
 */
function generateThemeLabel(cards: HarvestCard[]): string {
  // Extract common words from card content
  const wordFreq = new Map<string, number>()
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
    'she', 'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where',
    'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
    'same', 'so', 'than', 'too', 'very', 'just', 'about', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again',
    'there', 'here', 'then', 'once', 'my', 'your', 'his', 'her', 'our', 'their',
    'me', 'him', 'us', 'them', 'am', 'if', 'because', 'while', 'although',
  ])

  for (const card of cards) {
    const words = card.content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w))

    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1)
    }
  }

  // Get top words
  const sorted = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word)

  if (sorted.length === 0) {
    return 'Unnamed Theme'
  }

  // Capitalize and join
  const label = sorted
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' & ')

  return label
}

/**
 * Quick clustering for small sets (under 10 cards)
 * Uses pairwise content comparison without API calls
 */
export function quickClusterByContent(cards: HarvestCard[]): SemanticCluster[] {
  if (cards.length === 0) return []
  if (cards.length < 3) {
    return [{
      id: 'all',
      name: generateThemeLabel(cards),
      cards,
      seedCard: cards[0],
      avgSimilarity: 1,
    }]
  }

  // Simple word overlap clustering
  const clusters: SemanticCluster[] = []
  const clustered = new Set<string>()

  for (const card of cards) {
    if (clustered.has(card.id)) continue

    const cardWords = new Set(
      card.content.toLowerCase().split(/\s+/).filter(w => w.length > 4)
    )

    const clusterCards = [card]
    clustered.add(card.id)

    for (const other of cards) {
      if (clustered.has(other.id)) continue

      const otherWords = new Set(
        other.content.toLowerCase().split(/\s+/).filter(w => w.length > 4)
      )

      // Calculate Jaccard similarity
      const intersection = new Set([...cardWords].filter(w => otherWords.has(w)))
      const union = new Set([...cardWords, ...otherWords])
      const similarity = intersection.size / union.size

      const jaccardThreshold = getConfig().clustering.jaccardThreshold
      if (similarity > jaccardThreshold) {
        clusterCards.push(other)
        clustered.add(other.id)
      }
    }

    if (clusterCards.length >= 2) {
      clusters.push({
        id: `quick-${clusters.length}`,
        name: generateThemeLabel(clusterCards),
        cards: clusterCards,
        seedCard: card,
        avgSimilarity: 0.5,
      })
    }
  }

  // Add unclustered
  const unclustered = cards.filter(c => !clustered.has(c.id))
  if (unclustered.length > 0) {
    clusters.push({
      id: 'unclustered',
      name: 'Unclustered',
      cards: unclustered,
      seedCard: unclustered[0],
      avgSimilarity: 0,
    })
  }

  return clusters
}

// ============================================================================
// API-Aware Functions (Server-Side Delegation)
// ============================================================================

/**
 * Cluster cards via server API.
 * This is the preferred method when bookId is available.
 *
 * @param bookId - The book ID to cluster cards for
 * @param options - Clustering options
 * @returns Clustering result with clusters and stats
 */
export async function clusterCardsViaApi(
  bookId: string,
  options: Partial<ClusteringConfig> = {}
): Promise<ClusteringResult> {
  try {
    const result = await apiComputeClusters(bookId, {
      similarityThreshold: options.similarityThreshold,
      minClusterSize: options.minClusterSize,
      maxClusters: options.maxClusters,
      save: true, // Save clusters to database
    })
    return result
  } catch (error) {
    console.error('[clustering] API clustering failed:', error)
    throw error
  }
}

/**
 * Convert API ClusteringResult to local SemanticCluster format.
 * Useful when you need HarvestCard objects in the clusters.
 */
export function convertApiResultToLocalClusters(
  result: ClusteringResult,
  cards: HarvestCard[]
): SemanticCluster[] {
  const cardMap = new Map(cards.map(c => [c.id, c]))

  return result.clusters.map(apiCluster => {
    const clusterCards = apiCluster.cardIds
      .map(id => cardMap.get(id))
      .filter((c): c is HarvestCard => c !== undefined)

    return {
      id: apiCluster.id,
      name: apiCluster.name,
      theme: apiCluster.theme,
      cards: clusterCards,
      seedCard: cardMap.get(apiCluster.seedCardId) || clusterCards[0],
      avgSimilarity: apiCluster.avgSimilarity,
    }
  })
}

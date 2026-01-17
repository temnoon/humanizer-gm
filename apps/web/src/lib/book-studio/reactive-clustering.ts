/**
 * Reactive Clustering Service
 *
 * Manages clusters with incremental updates:
 * - Adds new cards to best-matching cluster
 * - Removes cards and checks cluster viability
 * - Supports manual merge/split/lock operations
 * - Persists manual edits to localStorage
 */

import { jaccardSimilarity } from './types'
import type { HarvestCard } from './types'
import { getConfig } from './config'

// ============================================================================
// Types
// ============================================================================

export interface ReactiveCluster {
  id: string
  name: string
  cards: HarvestCard[]
  seedCard?: HarvestCard
  avgSimilarity: number
  theme?: string
  locked: boolean // Prevent auto-modification
  manuallyCreated: boolean
  color?: string
}

interface ClusterEdit {
  type: 'merge' | 'split' | 'lock' | 'rename' | 'move'
  timestamp: number
  details: Record<string, unknown>
}

interface PersistedClusterState {
  manualAssignments: Record<string, string> // cardId -> clusterId
  lockedClusters: string[]
  renamedClusters: Record<string, string> // clusterId -> customName
  editHistory: ClusterEdit[]
}

// ============================================================================
// Service Implementation
// ============================================================================

export class ReactiveClusteringService {
  private clusters: ReactiveCluster[] = []
  private listeners: Set<() => void> = new Set()
  private persistedState: PersistedClusterState
  private storageKey: string
  private changeCount = 0

  constructor(bookId: string) {
    this.storageKey = `bookstudio-clusters-${bookId}`
    this.persistedState = this.loadPersistedState()
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize clustering with a set of cards
   * Uses quick Jaccard similarity for initial grouping
   */
  async initialize(cards: HarvestCard[]): Promise<void> {
    const config = getConfig()
    const { similarityThreshold, minClusterSize, maxClusters } = config.clustering

    // Reset state
    this.clusters = []
    this.changeCount = 0

    if (cards.length === 0) {
      this.notifyListeners()
      return
    }

    // Apply any persisted manual assignments first
    const manuallyAssigned = new Set<string>()
    const manualClusters: Record<string, HarvestCard[]> = {}

    for (const card of cards) {
      const assignedClusterId = this.persistedState.manualAssignments[card.id]
      if (assignedClusterId) {
        manuallyAssigned.add(card.id)
        if (!manualClusters[assignedClusterId]) {
          manualClusters[assignedClusterId] = []
        }
        manualClusters[assignedClusterId].push(card)
      }
    }

    // Create manual clusters
    for (const [clusterId, clusterCards] of Object.entries(manualClusters)) {
      this.clusters.push({
        id: clusterId,
        name: this.persistedState.renamedClusters[clusterId] || `Manual ${this.clusters.length + 1}`,
        cards: clusterCards,
        avgSimilarity: 1,
        locked: this.persistedState.lockedClusters.includes(clusterId),
        manuallyCreated: true,
      })
    }

    // Cluster remaining cards automatically
    const remainingCards = cards.filter(c => !manuallyAssigned.has(c.id))
    const autoClusteredIds = new Set<string>()

    // Greedy clustering using Jaccard similarity
    for (const seed of remainingCards) {
      if (autoClusteredIds.has(seed.id)) continue
      if (this.clusters.length >= maxClusters) break

      const cluster: HarvestCard[] = [seed]
      autoClusteredIds.add(seed.id)

      // Find similar cards
      for (const candidate of remainingCards) {
        if (autoClusteredIds.has(candidate.id)) continue

        const similarity = jaccardSimilarity(seed.content, candidate.content)
        if (similarity >= similarityThreshold) {
          cluster.push(candidate)
          autoClusteredIds.add(candidate.id)
        }
      }

      // Only create cluster if meets minimum size
      if (cluster.length >= minClusterSize) {
        const theme = this.generateTheme(cluster)
        this.clusters.push({
          id: `auto-${this.clusters.length}`,
          name: theme,
          cards: cluster,
          seedCard: seed,
          avgSimilarity: this.calculateAvgSimilarity(cluster),
          theme,
          locked: false,
          manuallyCreated: false,
        })
      } else {
        // Remove from clustered set if didn't form valid cluster
        cluster.forEach(c => autoClusteredIds.delete(c.id))
      }
    }

    // Add unclustered cards
    const unclustered = remainingCards.filter(c => !autoClusteredIds.has(c.id))
    if (unclustered.length > 0) {
      this.clusters.push({
        id: 'unclustered',
        name: 'Unclustered',
        cards: unclustered,
        avgSimilarity: 0,
        locked: false,
        manuallyCreated: false,
      })
    }

    this.notifyListeners()
  }

  // ===========================================================================
  // Incremental Updates
  // ===========================================================================

  /**
   * Add a card to the best-matching cluster
   */
  async addCard(card: HarvestCard): Promise<void> {
    const config = getConfig()

    // Check for manual assignment
    const manualClusterId = this.persistedState.manualAssignments[card.id]
    if (manualClusterId) {
      const cluster = this.clusters.find(c => c.id === manualClusterId)
      if (cluster) {
        cluster.cards.push(card)
        this.notifyListeners()
        return
      }
    }

    // Find best matching unlocked cluster
    let bestCluster: ReactiveCluster | null = null
    let bestSimilarity = 0

    for (const cluster of this.clusters) {
      if (cluster.locked || cluster.id === 'unclustered') continue

      // Calculate similarity to cluster (average with all cards)
      const similarities = cluster.cards.map(c => jaccardSimilarity(card.content, c.content))
      const avgSim = similarities.reduce((a, b) => a + b, 0) / similarities.length

      if (avgSim >= config.clustering.similarityThreshold && avgSim > bestSimilarity) {
        bestCluster = cluster
        bestSimilarity = avgSim
      }
    }

    if (bestCluster) {
      bestCluster.cards.push(card)
      bestCluster.avgSimilarity = this.calculateAvgSimilarity(bestCluster.cards)
    } else {
      // Add to unclustered
      let unclustered = this.clusters.find(c => c.id === 'unclustered')
      if (!unclustered) {
        unclustered = {
          id: 'unclustered',
          name: 'Unclustered',
          cards: [],
          avgSimilarity: 0,
          locked: false,
          manuallyCreated: false,
        }
        this.clusters.push(unclustered)
      }
      unclustered.cards.push(card)
    }

    this.changeCount++
    this.checkRecomputeThreshold()
    this.notifyListeners()
  }

  /**
   * Remove a card from its cluster
   */
  removeCard(cardId: string): void {
    for (const cluster of this.clusters) {
      const index = cluster.cards.findIndex(c => c.id === cardId)
      if (index !== -1) {
        cluster.cards.splice(index, 1)

        // Check if cluster is now too small
        if (!cluster.locked && !cluster.manuallyCreated && cluster.cards.length < 2) {
          // Move remaining cards to unclustered
          if (cluster.id !== 'unclustered' && cluster.cards.length > 0) {
            const unclustered = this.clusters.find(c => c.id === 'unclustered')
            if (unclustered) {
              unclustered.cards.push(...cluster.cards)
            }
          }
          // Remove empty cluster
          this.clusters = this.clusters.filter(c => c.id !== cluster.id || c.cards.length > 0)
        }

        break
      }
    }

    // Remove from manual assignments
    delete this.persistedState.manualAssignments[cardId]
    this.savePersistedState()

    this.changeCount++
    this.notifyListeners()
  }

  // ===========================================================================
  // Manual Operations
  // ===========================================================================

  /**
   * Merge two clusters into one
   */
  mergeClusters(sourceId: string, targetId: string): void {
    const source = this.clusters.find(c => c.id === sourceId)
    const target = this.clusters.find(c => c.id === targetId)

    if (!source || !target || source === target) return

    // Move all cards from source to target
    target.cards.push(...source.cards)
    target.avgSimilarity = this.calculateAvgSimilarity(target.cards)
    target.manuallyCreated = true

    // Update manual assignments
    for (const card of source.cards) {
      this.persistedState.manualAssignments[card.id] = targetId
    }

    // Remove source cluster
    this.clusters = this.clusters.filter(c => c.id !== sourceId)

    // Record edit
    this.recordEdit('merge', { sourceId, targetId })
    this.savePersistedState()
    this.notifyListeners()
  }

  /**
   * Split cards from a cluster into a new cluster
   */
  splitCluster(sourceClusterId: string, cardIds: string[]): string {
    const source = this.clusters.find(c => c.id === sourceClusterId)
    if (!source || cardIds.length === 0) return sourceClusterId

    // Extract cards
    const cardsToMove = source.cards.filter(c => cardIds.includes(c.id))
    source.cards = source.cards.filter(c => !cardIds.includes(c.id))

    // Create new cluster
    const newId = `manual-${Date.now()}`
    const theme = this.generateTheme(cardsToMove)
    const newCluster: ReactiveCluster = {
      id: newId,
      name: theme,
      cards: cardsToMove,
      avgSimilarity: this.calculateAvgSimilarity(cardsToMove),
      theme,
      locked: false,
      manuallyCreated: true,
    }

    this.clusters.push(newCluster)

    // Update manual assignments
    for (const cardId of cardIds) {
      this.persistedState.manualAssignments[cardId] = newId
    }

    // Record edit
    this.recordEdit('split', { sourceClusterId, cardIds, newClusterId: newId })
    this.savePersistedState()
    this.notifyListeners()

    return newId
  }

  /**
   * Move a card to a different cluster
   */
  moveCard(cardId: string, targetClusterId: string): void {
    // Remove from current cluster
    for (const cluster of this.clusters) {
      const index = cluster.cards.findIndex(c => c.id === cardId)
      if (index !== -1) {
        const [card] = cluster.cards.splice(index, 1)

        // Add to target cluster
        const target = this.clusters.find(c => c.id === targetClusterId)
        if (target) {
          target.cards.push(card)
          target.avgSimilarity = this.calculateAvgSimilarity(target.cards)
        }

        // Update manual assignment
        this.persistedState.manualAssignments[cardId] = targetClusterId

        break
      }
    }

    this.recordEdit('move', { cardId, targetClusterId })
    this.savePersistedState()
    this.notifyListeners()
  }

  /**
   * Lock/unlock a cluster to prevent auto-modification
   */
  lockCluster(clusterId: string, locked: boolean): void {
    const cluster = this.clusters.find(c => c.id === clusterId)
    if (!cluster) return

    cluster.locked = locked

    if (locked) {
      if (!this.persistedState.lockedClusters.includes(clusterId)) {
        this.persistedState.lockedClusters.push(clusterId)
      }
    } else {
      this.persistedState.lockedClusters = this.persistedState.lockedClusters.filter(
        id => id !== clusterId
      )
    }

    this.recordEdit('lock', { clusterId, locked })
    this.savePersistedState()
    this.notifyListeners()
  }

  /**
   * Rename a cluster
   */
  renameCluster(clusterId: string, name: string): void {
    const cluster = this.clusters.find(c => c.id === clusterId)
    if (!cluster) return

    cluster.name = name
    this.persistedState.renamedClusters[clusterId] = name

    this.recordEdit('rename', { clusterId, name })
    this.savePersistedState()
    this.notifyListeners()
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  getClusters(): ReactiveCluster[] {
    return [...this.clusters]
  }

  getCluster(id: string): ReactiveCluster | undefined {
    return this.clusters.find(c => c.id === id)
  }

  getChangeCount(): number {
    return this.changeCount
  }

  shouldRecompute(): boolean {
    const config = getConfig()
    return this.changeCount >= config.clustering.autoRecomputeThreshold
  }

  // ===========================================================================
  // Subscription
  // ===========================================================================

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener())
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private generateTheme(cards: HarvestCard[]): string {
    // Extract common words
    const wordFreq = new Map<string, number>()
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
      'we', 'they', 'what', 'which', 'who', 'where', 'when', 'why', 'how',
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

    const sorted = Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1))

    return sorted.length > 0 ? sorted.join(' & ') : 'Unnamed Theme'
  }

  private calculateAvgSimilarity(cards: HarvestCard[]): number {
    if (cards.length < 2) return 1

    let totalSim = 0
    let count = 0

    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        totalSim += jaccardSimilarity(cards[i].content, cards[j].content)
        count++
      }
    }

    return count > 0 ? totalSim / count : 1
  }

  private checkRecomputeThreshold(): void {
    const config = getConfig()
    if (this.changeCount >= config.clustering.autoRecomputeThreshold) {
      // Emit event that recompute might be needed
      // (UI can prompt user)
    }
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  private loadPersistedState(): PersistedClusterState {
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (e) {
      console.warn('Failed to load cluster state:', e)
    }

    return {
      manualAssignments: {},
      lockedClusters: [],
      renamedClusters: {},
      editHistory: [],
    }
  }

  private savePersistedState(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.persistedState))
    } catch (e) {
      console.warn('Failed to save cluster state:', e)
    }
  }

  private recordEdit(type: ClusterEdit['type'], details: Record<string, unknown>): void {
    this.persistedState.editHistory.push({
      type,
      timestamp: Date.now(),
      details,
    })

    // Keep only last 50 edits
    if (this.persistedState.editHistory.length > 50) {
      this.persistedState.editHistory = this.persistedState.editHistory.slice(-50)
    }
  }

  /**
   * Clear all manual assignments and reset to auto-clustering
   */
  resetToAuto(): void {
    this.persistedState = {
      manualAssignments: {},
      lockedClusters: [],
      renamedClusters: {},
      editHistory: [],
    }
    this.savePersistedState()
    this.changeCount = 0
  }
}

// ============================================================================
// React Hook
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'

export function useReactiveClustering(bookId: string, cards: HarvestCard[]) {
  const serviceRef = useRef<ReactiveClusteringService | null>(null)
  const [clusters, setClusters] = useState<ReactiveCluster[]>([])
  const [isInitialized, setIsInitialized] = useState(false)

  // Initialize service
  useEffect(() => {
    if (!bookId) return

    const service = new ReactiveClusteringService(bookId)
    serviceRef.current = service

    const unsubscribe = service.subscribe(() => {
      setClusters(service.getClusters())
    })

    return () => {
      unsubscribe()
    }
  }, [bookId])

  // Initialize with cards
  useEffect(() => {
    const service = serviceRef.current
    if (!service || !cards.length) return

    service.initialize(cards).then(() => {
      setIsInitialized(true)
    })
  }, [cards])

  // Action handlers
  const mergeClusters = useCallback((sourceId: string, targetId: string) => {
    serviceRef.current?.mergeClusters(sourceId, targetId)
  }, [])

  const splitCluster = useCallback((clusterId: string, cardIds: string[]) => {
    return serviceRef.current?.splitCluster(clusterId, cardIds) || clusterId
  }, [])

  const moveCard = useCallback((cardId: string, targetClusterId: string) => {
    serviceRef.current?.moveCard(cardId, targetClusterId)
  }, [])

  const lockCluster = useCallback((clusterId: string, locked: boolean) => {
    serviceRef.current?.lockCluster(clusterId, locked)
  }, [])

  const renameCluster = useCallback((clusterId: string, name: string) => {
    serviceRef.current?.renameCluster(clusterId, name)
  }, [])

  const addCard = useCallback(async (card: HarvestCard) => {
    await serviceRef.current?.addCard(card)
  }, [])

  const removeCard = useCallback((cardId: string) => {
    serviceRef.current?.removeCard(cardId)
  }, [])

  const recompute = useCallback(async () => {
    const service = serviceRef.current
    if (service && cards.length) {
      service.resetToAuto()
      await service.initialize(cards)
    }
  }, [cards])

  return {
    clusters,
    isInitialized,
    shouldRecompute: serviceRef.current?.shouldRecompute() ?? false,
    changeCount: serviceRef.current?.getChangeCount() ?? 0,
    mergeClusters,
    splitCluster,
    moveCard,
    lockCluster,
    renameCluster,
    addCard,
    removeCard,
    recompute,
  }
}

/**
 * Clustering API Client
 *
 * Client-side wrapper for server-side clustering computation.
 * Business logic now runs on the server.
 */

import { getConfig } from './config'

// ============================================================================
// Types
// ============================================================================

export interface SemanticCluster {
  id: string
  name: string
  theme?: string
  cardIds: string[]
  seedCardId: string
  avgSimilarity: number
}

export interface ClusteringResult {
  clusters: SemanticCluster[]
  unclusteredCardIds: string[]
  stats: {
    totalCards: number
    clusteredCards: number
    clusterCount: number
    avgClusterSize: number
  }
  computedAt: string
}

export interface ClusteringOptions {
  similarityThreshold?: number
  minClusterSize?: number
  maxClusters?: number
  jaccardThreshold?: number
  save?: boolean
}

// ============================================================================
// API Client
// ============================================================================

function getBaseUrl(): string {
  return getConfig().api.bookStudioBase
}

/**
 * Compute semantic clusters for a book's staging cards
 */
export async function computeClusters(
  bookId: string,
  options: ClusteringOptions = {}
): Promise<ClusteringResult> {
  const response = await fetch(`${getBaseUrl()}/clusters/compute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bookId, options }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Clustering failed' }))
    throw new Error(error.error || error.details || 'Clustering failed')
  }

  const data = await response.json()
  return data.result
}

/**
 * Get saved clusters for a book
 */
export async function getSavedClusters(bookId: string): Promise<SemanticCluster[]> {
  const response = await fetch(`${getBaseUrl()}/clusters?bookId=${encodeURIComponent(bookId)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get clusters' }))
    throw new Error(error.error || error.details || 'Failed to get clusters')
  }

  const data = await response.json()
  return data.clusters
}

/**
 * Create a cluster manually
 */
export async function createCluster(
  bookId: string,
  name: string,
  cardIds: string[],
  seedCardId?: string
): Promise<SemanticCluster> {
  const response = await fetch(`${getBaseUrl()}/clusters`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bookId,
      name,
      cardIds,
      seedCardId: seedCardId || cardIds[0],
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create cluster' }))
    throw new Error(error.error || error.details || 'Failed to create cluster')
  }

  const data = await response.json()
  return data.cluster
}

/**
 * Update a cluster
 */
export async function updateCluster(
  clusterId: string,
  updates: Partial<{ name: string; cardIds: string[]; locked: boolean }>
): Promise<SemanticCluster> {
  const response = await fetch(`${getBaseUrl()}/clusters/${clusterId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to update cluster' }))
    throw new Error(error.error || error.details || 'Failed to update cluster')
  }

  const data = await response.json()
  return data.cluster
}

/**
 * Delete a cluster
 */
export async function deleteCluster(clusterId: string): Promise<void> {
  const response = await fetch(`${getBaseUrl()}/clusters/${clusterId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to delete cluster' }))
    throw new Error(error.error || error.details || 'Failed to delete cluster')
  }
}

/**
 * Add a card to a cluster
 */
export async function addCardToCluster(
  clusterId: string,
  cardId: string
): Promise<SemanticCluster> {
  const response = await fetch(`${getBaseUrl()}/clusters/${clusterId}/add-card`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cardId }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to add card to cluster' }))
    throw new Error(error.error || error.details || 'Failed to add card to cluster')
  }

  const data = await response.json()
  return data.cluster
}

/**
 * Remove a card from a cluster
 */
export async function removeCardFromCluster(
  clusterId: string,
  cardId: string
): Promise<SemanticCluster> {
  const response = await fetch(`${getBaseUrl()}/clusters/${clusterId}/remove-card`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cardId }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to remove card from cluster' }))
    throw new Error(error.error || error.details || 'Failed to remove card from cluster')
  }

  const data = await response.json()
  return data.cluster
}

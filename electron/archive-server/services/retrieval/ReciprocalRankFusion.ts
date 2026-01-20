/**
 * ReciprocalRankFusion - Combines rankings from multiple retrieval systems
 *
 * RRF Formula: score = Σ 1/(k + rank_i) for each system i
 * k is a constant (typically 60) that dampens the impact of high ranks
 *
 * Part of the Multi-Resolution Hybrid Hierarchical embedding system.
 */

import type { RankedResult, FusedResult } from './types.js';

/**
 * Reciprocal Rank Fusion parameters
 */
export interface RRFOptions {
  /** Damping constant (default: 60) */
  k: number;

  /** Weight multiplier for dense results (default: 1.0) */
  denseWeight: number;

  /** Weight multiplier for sparse results (default: 1.0) */
  sparseWeight: number;
}

const DEFAULT_RRF_OPTIONS: RRFOptions = {
  k: 60,
  denseWeight: 1.0,
  sparseWeight: 1.0,
};

/**
 * Combine dense and sparse result rankings using Reciprocal Rank Fusion
 *
 * @param denseResults - Results from dense (vector) retrieval, sorted by score descending
 * @param sparseResults - Results from sparse (FTS) retrieval, sorted by score descending
 * @param options - RRF configuration options
 * @returns Fused results sorted by combined RRF score
 */
export function reciprocalRankFusion(
  denseResults: RankedResult[],
  sparseResults: RankedResult[],
  options: Partial<RRFOptions> = {}
): FusedResult[] {
  const opts = { ...DEFAULT_RRF_OPTIONS, ...options };
  const fusedMap = new Map<string, FusedResult>();

  // Process dense results
  denseResults.forEach((result, index) => {
    const rank = index + 1;
    const rrfScore = (opts.denseWeight * 1) / (opts.k + rank);

    const existing = fusedMap.get(result.id);
    if (existing) {
      existing.denseScore = result.score;
      existing.denseRank = rank;
      existing.fusedScore += rrfScore;
    } else {
      fusedMap.set(result.id, {
        id: result.id,
        denseScore: result.score,
        denseRank: rank,
        sparseScore: null,
        sparseRank: null,
        fusedScore: rrfScore,
      });
    }
  });

  // Process sparse results
  sparseResults.forEach((result, index) => {
    const rank = index + 1;
    const rrfScore = (opts.sparseWeight * 1) / (opts.k + rank);

    const existing = fusedMap.get(result.id);
    if (existing) {
      existing.sparseScore = result.score;
      existing.sparseRank = rank;
      existing.fusedScore += rrfScore;
    } else {
      fusedMap.set(result.id, {
        id: result.id,
        denseScore: null,
        denseRank: null,
        sparseScore: result.score,
        sparseRank: rank,
        fusedScore: rrfScore,
      });
    }
  });

  // Sort by fused score (descending)
  return Array.from(fusedMap.values()).sort((a, b) => b.fusedScore - a.fusedScore);
}

/**
 * Compute RRF score for a single result at a given rank
 *
 * @param rank - 1-based rank position
 * @param k - Damping constant
 * @returns RRF score contribution
 */
export function rrfScore(rank: number, k: number = 60): number {
  return 1 / (k + rank);
}

/**
 * Combine multiple result sets using RRF
 *
 * @param resultSets - Array of result sets, each sorted by score descending
 * @param weights - Optional weights for each result set
 * @param k - Damping constant
 * @returns Fused results sorted by combined score
 */
export function multiWayRRF(
  resultSets: RankedResult[][],
  weights?: number[],
  k: number = 60
): Array<{ id: string; fusedScore: number; sources: Map<string, { rank: number; score: number }> }> {
  const effectiveWeights = weights || resultSets.map(() => 1.0);
  const fusedMap = new Map<string, {
    id: string;
    fusedScore: number;
    sources: Map<string, { rank: number; score: number }>;
  }>();

  // Process each result set
  resultSets.forEach((results, setIndex) => {
    const weight = effectiveWeights[setIndex] || 1.0;
    const sourceKey = `set_${setIndex}`;

    results.forEach((result, rankIndex) => {
      const rank = rankIndex + 1;
      const contribution = (weight * 1) / (k + rank);

      const existing = fusedMap.get(result.id);
      if (existing) {
        existing.fusedScore += contribution;
        existing.sources.set(sourceKey, { rank, score: result.score });
      } else {
        const sources = new Map<string, { rank: number; score: number }>();
        sources.set(sourceKey, { rank, score: result.score });
        fusedMap.set(result.id, {
          id: result.id,
          fusedScore: contribution,
          sources,
        });
      }
    });
  });

  // Sort by fused score
  return Array.from(fusedMap.values()).sort((a, b) => b.fusedScore - a.fusedScore);
}

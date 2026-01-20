/**
 * BoundaryDetector - Embedding-based semantic boundary detection
 *
 * Uses cosine distance between adjacent text units to detect topic shifts.
 * Part of the Multi-Resolution Hybrid Hierarchical embedding system.
 */

import { embedBatch } from '../embeddings/EmbeddingGenerator.js';

/**
 * Score for a potential boundary between text units
 */
export interface BoundaryScore {
  /** Index of the boundary (between units[index] and units[index+1]) */
  index: number;

  /** Semantic distance between adjacent units (0-1, higher = more different) */
  distance: number;

  /** Whether this boundary exceeds the significance threshold */
  isSignificant: boolean;

  /** Confidence in the boundary detection (based on unit length) */
  confidence: number;
}

/**
 * Options for boundary detection
 */
export interface BoundaryDetectionOptions {
  /** Distance threshold for significant boundaries (default: 0.35) */
  threshold: number;

  /** Minimum unit length in characters for reliable detection */
  minUnitLength: number;

  /** Batch size for embedding generation */
  batchSize: number;
}

const DEFAULT_OPTIONS: BoundaryDetectionOptions = {
  threshold: 0.35,
  minUnitLength: 50,
  batchSize: 32,
};

/**
 * BoundaryDetector - Detects semantic boundaries using embedding distance
 */
export class BoundaryDetector {
  private options: BoundaryDetectionOptions;
  private embeddingCache: Map<string, Float32Array>;
  private embeddingEnabled: boolean;

  constructor(
    options: Partial<BoundaryDetectionOptions> = {},
    embeddingEnabled: boolean = true
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.embeddingCache = new Map();
    this.embeddingEnabled = embeddingEnabled;
  }

  /**
   * Detect semantic boundaries between text units
   *
   * @param units - Array of text units (sentences, paragraphs, or turns)
   * @returns Array of boundary scores between adjacent units
   */
  async detectBoundaries(units: string[]): Promise<BoundaryScore[]> {
    if (units.length < 2) return [];

    // Filter out very short units for embedding (but keep indices)
    const validUnits = units.map((u, i) => ({
      text: u,
      index: i,
      isValid: u.length >= this.options.minUnitLength,
    }));

    // Batch embed all valid units
    const embeddings = await this.batchEmbed(
      validUnits.filter((u) => u.isValid).map((u) => u.text)
    );

    // Map embeddings back to original indices
    const embeddingMap = new Map<number, Float32Array>();
    let embIdx = 0;
    for (const unit of validUnits) {
      if (unit.isValid) {
        embeddingMap.set(unit.index, embeddings[embIdx++]);
      }
    }

    // Compute pairwise distances
    const scores: BoundaryScore[] = [];

    for (let i = 0; i < units.length - 1; i++) {
      const embA = embeddingMap.get(i);
      const embB = embeddingMap.get(i + 1);

      let distance: number;
      let confidence: number;

      if (embA && embB) {
        // Both units have embeddings - compute cosine distance
        distance = 1 - this.cosineSimilarity(embA, embB);
        confidence = 1.0;
      } else if (embA || embB) {
        // One unit is too short - use moderate distance with low confidence
        distance = this.options.threshold;
        confidence = 0.5;
      } else {
        // Both units too short - assume no boundary
        distance = 0;
        confidence = 0.3;
      }

      scores.push({
        index: i,
        distance,
        isSignificant: distance > this.options.threshold,
        confidence,
      });
    }

    return scores;
  }

  /**
   * Find optimal split points respecting min/max token constraints
   *
   * @param boundaries - Boundary scores from detectBoundaries()
   * @param unitLengths - Token count for each unit
   * @param options - Min/max token constraints
   * @returns Array of split point indices
   */
  findSplitPoints(
    boundaries: BoundaryScore[],
    unitLengths: number[],
    options: { minTokens: number; maxTokens: number; targetTokens: number }
  ): number[] {
    const splits: number[] = [];
    let currentLength = 0;
    let lastSplit = 0;

    for (let i = 0; i < boundaries.length; i++) {
      currentLength += unitLengths[i];

      // Force split if approaching max (90% threshold)
      if (currentLength >= options.maxTokens * 0.9) {
        // Find best boundary since last split
        const bestBoundary = this.findBestBoundary(
          boundaries,
          lastSplit,
          i,
          options.minTokens,
          unitLengths
        );

        if (bestBoundary !== null) {
          splits.push(bestBoundary + 1);
          currentLength = this.sumTokens(unitLengths, bestBoundary + 1, i + 1);
          lastSplit = bestBoundary + 1;
        } else {
          // No good boundary - force split here
          splits.push(i + 1);
          currentLength = 0;
          lastSplit = i + 1;
        }
        continue;
      }

      // Split at significant semantic boundary if above min and close to target
      if (
        boundaries[i].isSignificant &&
        currentLength >= options.minTokens &&
        currentLength >= options.targetTokens * 0.7
      ) {
        splits.push(i + 1);
        currentLength = 0;
        lastSplit = i + 1;
      }
    }

    return splits;
  }

  /**
   * Find the best boundary in a range
   */
  private findBestBoundary(
    boundaries: BoundaryScore[],
    start: number,
    end: number,
    minTokens: number,
    unitLengths: number[]
  ): number | null {
    let bestIndex = -1;
    let bestScore = -1;

    let cumulative = 0;
    for (let i = start; i <= end && i < boundaries.length; i++) {
      cumulative += unitLengths[i];

      // Only consider boundaries that respect min token constraint
      if (cumulative >= minTokens && boundaries[i].isSignificant) {
        // Prefer higher distance boundaries (stronger topic shifts)
        const score = boundaries[i].distance * boundaries[i].confidence;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
    }

    return bestIndex >= 0 ? bestIndex : null;
  }

  /**
   * Sum token lengths in a range
   */
  private sumTokens(lengths: number[], start: number, end: number): number {
    let sum = 0;
    for (let i = start; i < end && i < lengths.length; i++) {
      sum += lengths[i];
    }
    return sum;
  }

  /**
   * Batch embed texts using the embedding generator
   */
  private async batchEmbed(texts: string[]): Promise<Float32Array[]> {
    if (!this.embeddingEnabled) {
      // Fallback: return zero vectors if embeddings disabled
      console.warn('[BoundaryDetector] Embeddings disabled - using zero vectors');
      return texts.map(() => new Float32Array(768));
    }

    const results: Float32Array[] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.options.batchSize) {
      const batch = texts.slice(i, i + this.options.batchSize);

      // Check cache first
      const uncached: Array<{ text: string; idx: number }> = [];
      const batchResults: Array<Float32Array | null> = new Array(batch.length).fill(null);

      for (let j = 0; j < batch.length; j++) {
        const cacheKey = this.getCacheKey(batch[j]);
        const cached = this.embeddingCache.get(cacheKey);
        if (cached) {
          batchResults[j] = cached;
        } else {
          uncached.push({ text: batch[j], idx: j });
        }
      }

      // Generate embeddings for uncached texts
      if (uncached.length > 0) {
        try {
          const embeddings = await embedBatch(
            uncached.map((u) => u.text)
          );

          for (let k = 0; k < uncached.length; k++) {
            // Convert number[] to Float32Array
            const embArray = embeddings[k];
            const embedding = embArray && embArray.length > 0
              ? new Float32Array(embArray)
              : new Float32Array(768); // Zero-filled fallback
            batchResults[uncached[k].idx] = embedding;

            // Cache the result
            const cacheKey = this.getCacheKey(uncached[k].text);
            this.embeddingCache.set(cacheKey, embedding);
          }
        } catch (err) {
          console.error('[BoundaryDetector] Embedding batch failed:', err);
          // Fill with zero vectors on error
          for (const u of uncached) {
            batchResults[u.idx] = new Float32Array(768);
          }
        }
      }

      results.push(...(batchResults as Float32Array[]));
    }

    return results;
  }

  /**
   * Generate cache key for a text
   */
  private getCacheKey(text: string): string {
    // Use first 100 chars + length as key (fast approximation)
    return `${text.length}:${text.slice(0, 100)}`;
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.embeddingCache.clear();
  }

  /**
   * Set the threshold for significant boundaries
   */
  setThreshold(threshold: number): void {
    this.options.threshold = threshold;
  }

  /**
   * Get current options
   */
  getOptions(): BoundaryDetectionOptions {
    return { ...this.options };
  }
}

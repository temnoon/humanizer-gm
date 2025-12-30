/**
 * ESM Module Loader
 *
 * Workaround for loading ESM modules from CommonJS context.
 * Uses eval to prevent TypeScript from transforming the import() call.
 */

// Force dynamic import to not be transformed by TypeScript
const dynamicImport = new Function('specifier', 'return import(specifier)');

let embeddingPipeline: any = null;
let initPromise: Promise<void> | null = null;

const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

/**
 * Initialize the embedding pipeline (downloads model on first use)
 */
export async function initializeEmbedding(): Promise<void> {
  if (embeddingPipeline) return;

  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    console.log(`[embeddings] Loading model: ${EMBEDDING_MODEL}...`);
    const startTime = Date.now();

    try {
      // Dynamic import of ESM module
      const { pipeline, env } = await dynamicImport('chromadb-default-embed');

      // Configure for Node.js
      env.allowLocalModels = true;
      env.useBrowserCache = false;

      const path = await dynamicImport('path');
      const os = await dynamicImport('os');
      const cacheDir = path.default.join(os.default.homedir(), '.cache', 'humanizer', 'models');
      env.cacheDir = cacheDir;
      env.localModelPath = cacheDir;

      embeddingPipeline = await pipeline('feature-extraction', EMBEDDING_MODEL, {
        quantized: true,
      });

      const elapsed = Date.now() - startTime;
      console.log(`[embeddings] Model loaded in ${elapsed}ms`);
    } catch (err) {
      console.error('[embeddings] Failed to load model:', err);
      throw err;
    }
  })();

  await initPromise;
}

/**
 * Generate embedding for a single text
 */
export async function embed(text: string): Promise<number[]> {
  await initializeEmbedding();

  if (!text || !text.trim()) {
    return new Array(EMBEDDING_DIM).fill(0);
  }

  const result = await embeddingPipeline(text, {
    pooling: 'mean',
    normalize: true,
  });

  const embedding = Array.from(result.data as Float32Array);

  if (embedding.length !== EMBEDDING_DIM) {
    console.warn(`[embeddings] Expected ${EMBEDDING_DIM} dimensions, got ${embedding.length}`);
  }

  return embedding;
}

/**
 * Generate embeddings for multiple texts in batch
 */
export async function embedBatch(
  texts: string[],
  options: {
    batchSize?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<number[][]> {
  await initializeEmbedding();

  const { batchSize = 32, onProgress } = options;
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchEmbeddings = await Promise.all(batch.map(text => embed(text)));
    embeddings.push(...batchEmbeddings);

    if (onProgress) {
      onProgress(Math.min(i + batchSize, texts.length), texts.length);
    }
  }

  return embeddings;
}

/**
 * Get the embedding dimension
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIM;
}

/**
 * Get the model name
 */
export function getModelName(): string {
  return EMBEDDING_MODEL;
}

/**
 * Check if the embedding pipeline is initialized
 */
export function isInitialized(): boolean {
  return embeddingPipeline !== null;
}

/**
 * Compute cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimensions');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Compute centroid (average) of multiple embeddings
 */
export function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) {
    return new Array(EMBEDDING_DIM).fill(0);
  }

  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);

  for (const embedding of embeddings) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += embedding[i];
    }
  }

  // Average
  for (let i = 0; i < dim; i++) {
    centroid[i] /= embeddings.length;
  }

  // Normalize to unit length
  const norm = Math.sqrt(centroid.reduce((sum, x) => sum + x * x, 0));
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      centroid[i] /= norm;
    }
  }

  return centroid;
}

/**
 * Find the embedding closest to the centroid (medoid)
 */
export function findMedoid(embeddings: number[][]): { index: number; embedding: number[] } {
  if (embeddings.length === 0) {
    throw new Error('Cannot find medoid of empty set');
  }

  const centroid = computeCentroid(embeddings);

  let bestIndex = 0;
  let bestSimilarity = -Infinity;

  for (let i = 0; i < embeddings.length; i++) {
    const similarity = cosineSimilarity(embeddings[i], centroid);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestIndex = i;
    }
  }

  return { index: bestIndex, embedding: embeddings[bestIndex] };
}

/**
 * Find embeddings furthest from a target (for anti-anchors)
 */
export function findFurthest(
  embeddings: number[][],
  target: number[],
  k: number = 10
): Array<{ index: number; distance: number }> {
  const distances = embeddings.map((emb, index) => ({
    index,
    distance: 1 - cosineSimilarity(emb, target),
  }));

  distances.sort((a, b) => b.distance - a.distance);

  return distances.slice(0, k);
}

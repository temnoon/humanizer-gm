/**
 * EmbeddingGenerator - Generate embeddings using Ollama
 *
 * Uses nomic-embed-text model (768 dimensions) for high-quality sentence embeddings.
 * Runs locally via Ollama - no external API calls needed.
 */

// Model configuration
const OLLAMA_ENDPOINT = 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';
const EMBEDDING_DIM = 768;

// Initialization state
let ollamaValidated = false;
let initPromise: Promise<void> | null = null;

/**
 * Validate Ollama is running with the required model
 */
export async function validateOllama(): Promise<void> {
  try {
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama not responding: ${response.status}`);
    }
    const data = await response.json();
    const hasModel = data.models?.some((m: { name: string }) =>
      m.name.includes('nomic-embed-text')
    );
    if (!hasModel) {
      throw new Error(
        'nomic-embed-text model not found.\n' +
        'Run: ollama pull nomic-embed-text'
      );
    }
    console.log(`[embeddings] Ollama validated with ${EMBEDDING_MODEL}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('nomic-embed-text')) {
      throw error;
    }
    throw new Error(
      'Ollama not running.\n' +
      'Start Ollama: ollama serve\n' +
      'Then pull model: ollama pull nomic-embed-text'
    );
  }
}

/**
 * Initialize the embedding system (validates Ollama on first use)
 */
export async function initializeEmbedding(): Promise<void> {
  if (ollamaValidated) return;

  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    console.log(`[embeddings] Initializing with ${EMBEDDING_MODEL}...`);
    const startTime = Date.now();

    await validateOllama();
    ollamaValidated = true;

    const elapsed = Date.now() - startTime;
    console.log(`[embeddings] Ready in ${elapsed}ms`);
  })();

  await initPromise;
}

/**
 * Generate embedding for a single text using Ollama API
 */
export async function embed(text: string): Promise<number[]> {
  await initializeEmbedding();

  if (!text || !text.trim()) {
    // Return zero vector for empty text
    return new Array(EMBEDDING_DIM).fill(0);
  }

  // Call Ollama embedding API
  const response = await fetch(`${OLLAMA_ENDPOINT}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding failed: ${response.status}`);
  }

  const data = await response.json();
  const embedding = data.embeddings?.[0];

  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Invalid embedding response from Ollama');
  }

  // Verify dimensions
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

    // Process batch
    const batchEmbeddings = await Promise.all(
      batch.map(text => embed(text))
    );

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
 * Check if the embedding system is initialized
 */
export function isInitialized(): boolean {
  return ollamaValidated;
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
    distance: 1 - cosineSimilarity(emb, target),  // Convert similarity to distance
  }));

  // Sort by distance descending
  distances.sort((a, b) => b.distance - a.distance);

  return distances.slice(0, k);
}

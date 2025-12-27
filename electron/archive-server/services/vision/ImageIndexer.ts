/**
 * Image Indexer - Orchestrates image analysis and indexing
 *
 * Coordinates:
 * - Visual model (descriptions, classifications)
 * - Database storage (analysis, embeddings, clusters)
 * - Batch processing with progress tracking
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EmbeddingDatabase } from '../embeddings/EmbeddingDatabase.js';
import * as VisualModel from './VisualModelService.js';

export interface IndexingResult {
  total: number;
  indexed: number;
  skipped: number;
  errors: Array<{ path: string; error: string }>;
  timeMs: number;
}

export interface ImageSearchResult {
  id: string;
  file_path: string;
  description: string | null;
  categories: string[];
  source: string;
  similarity?: number;
  rank?: number;
}

export interface ImageClusterInfo {
  id: string;
  cluster_index: number;
  name: string | null;
  description: string | null;
  image_count: number;
  representative: {
    id: string;
    file_path: string;
    description: string | null;
  } | null;
}

/**
 * Find all image files in a directory recursively
 */
async function findImages(dirPath: string): Promise<string[]> {
  const images: string[] = [];
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

  async function walk(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip hidden directories and common non-image directories
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (imageExtensions.includes(ext)) {
            images.push(fullPath);
          }
        }
      }
    } catch (err) {
      // Skip directories we can't access
      console.warn(`Cannot access ${dir}:`, err);
    }
  }

  await walk(dirPath);
  return images;
}

/**
 * Compute a simple hash of file content for deduplication
 */
async function hashFile(filePath: string): Promise<string> {
  const crypto = await import('crypto');
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Determine source type from file path
 */
function inferSource(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.includes('facebook')) return 'facebook';
  if (lower.includes('instagram')) return 'instagram';
  if (lower.includes('chatgpt') || lower.includes('openai')) return 'chatgpt';
  if (lower.includes('dalle') || lower.includes('dall-e')) return 'dalle';
  if (lower.includes('gallery')) return 'gallery';
  return 'imported';
}

export class ImageIndexer {
  private db: EmbeddingDatabase;
  private isProcessing = false;
  private currentProgress = { done: 0, total: 0 };

  constructor(db: EmbeddingDatabase) {
    this.db = db;
  }

  /**
   * Get current processing status
   */
  getStatus(): {
    isProcessing: boolean;
    progress: { done: number; total: number };
    stats: ReturnType<EmbeddingDatabase['getImageAnalysisStats']>;
  } {
    return {
      isProcessing: this.isProcessing,
      progress: this.currentProgress,
      stats: this.db.getImageAnalysisStats(),
    };
  }

  /**
   * Index all images in a directory
   */
  async indexDirectory(
    dirPath: string,
    options?: {
      source?: string;
      forceReindex?: boolean;
      batchSize?: number;
      onProgress?: (done: number, total: number) => void;
    }
  ): Promise<IndexingResult> {
    if (this.isProcessing) {
      throw new Error('Already processing. Wait for current indexing to complete.');
    }

    this.isProcessing = true;
    const startTime = Date.now();
    const errors: Array<{ path: string; error: string }> = [];
    let indexed = 0;
    let skipped = 0;

    try {
      // Check if vision model is available
      const visionHealth = await VisualModel.checkVisionHealth();
      if (!visionHealth.available) {
        throw new Error(`Vision model not available: ${visionHealth.error}`);
      }

      // Find all images
      const images = await findImages(dirPath);
      this.currentProgress = { done: 0, total: images.length };

      // Process in batches
      const batchSize = options?.batchSize ?? 5;

      for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (imagePath) => {
            try {
              // Check if already analyzed
              if (!options?.forceReindex) {
                const existing = this.db.getImageAnalysisByPath(imagePath);
                if (existing) {
                  skipped++;
                  this.currentProgress.done++;
                  options?.onProgress?.(this.currentProgress.done, this.currentProgress.total);
                  return;
                }
              }

              // Analyze with visual model
              const analysis = await VisualModel.analyzeImage(imagePath);
              const fileHash = await hashFile(imagePath);
              const source = options?.source || inferSource(imagePath);

              // Store in database
              const id = uuidv4();
              this.db.upsertImageAnalysis({
                id,
                file_path: imagePath,
                file_hash: fileHash,
                source,
                description: analysis.description,
                categories: analysis.categories,
                objects: analysis.objects,
                scene: analysis.scene,
                mood: analysis.mood,
                model_used: analysis.model,
                confidence: analysis.confidence,
                processing_time_ms: analysis.processingTimeMs,
              });

              indexed++;
            } catch (err) {
              errors.push({
                path: imagePath,
                error: err instanceof Error ? err.message : 'Unknown error',
              });
            } finally {
              this.currentProgress.done++;
              options?.onProgress?.(this.currentProgress.done, this.currentProgress.total);
            }
          })
        );
      }

      return {
        total: images.length,
        indexed,
        skipped,
        errors,
        timeMs: Date.now() - startTime,
      };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Analyze a single image
   */
  async analyzeImage(imagePath: string, options?: {
    source?: string;
    forceReindex?: boolean;
  }): Promise<{
    id: string;
    description: string;
    categories: string[];
    objects: string[];
    scene: string;
    mood: string;
    cached: boolean;
  }> {
    // Check cache first
    if (!options?.forceReindex) {
      const existing = this.db.getImageAnalysisByPath(imagePath);
      if (existing) {
        return {
          id: existing.id,
          description: existing.description || '',
          categories: existing.categories,
          objects: existing.objects,
          scene: existing.scene || 'unknown',
          mood: existing.mood || 'neutral',
          cached: true,
        };
      }
    }

    // Analyze with visual model
    const analysis = await VisualModel.analyzeImage(imagePath);
    const fileHash = await hashFile(imagePath);
    const source = options?.source || inferSource(imagePath);

    // Store in database
    const id = uuidv4();
    this.db.upsertImageAnalysis({
      id,
      file_path: imagePath,
      file_hash: fileHash,
      source,
      description: analysis.description,
      categories: analysis.categories,
      objects: analysis.objects,
      scene: analysis.scene,
      mood: analysis.mood,
      model_used: analysis.model,
      confidence: analysis.confidence,
      processing_time_ms: analysis.processingTimeMs,
    });

    return {
      id,
      description: analysis.description,
      categories: analysis.categories,
      objects: analysis.objects,
      scene: analysis.scene,
      mood: analysis.mood,
      cached: false,
    };
  }

  /**
   * Search images by text description (FTS)
   */
  searchByDescription(
    query: string,
    options?: { limit?: number; source?: string }
  ): ImageSearchResult[] {
    return this.db.searchImagesFTS(query, options);
  }

  /**
   * Search images by semantic similarity (requires embeddings)
   */
  searchBySemantic(
    queryEmbedding: Float32Array | number[],
    options?: { limit?: number; source?: string }
  ): ImageSearchResult[] {
    return this.db.searchImagesByVector(queryEmbedding, options);
  }

  /**
   * Hybrid search combining FTS and semantic
   */
  async searchHybrid(
    query: string,
    options?: {
      limit?: number;
      source?: string;
      textWeight?: number;
      semanticWeight?: number;
    }
  ): Promise<ImageSearchResult[]> {
    const limit = options?.limit || 20;
    const textWeight = options?.textWeight ?? 0.5;
    const semanticWeight = options?.semanticWeight ?? 0.5;

    // Get FTS results
    const ftsResults = this.db.searchImagesFTS(query, { limit: limit * 2, source: options?.source });

    // For now, just return FTS results (semantic requires CLIP embeddings)
    // TODO: Add CLIP text encoding and semantic search

    // Score and deduplicate
    const seen = new Set<string>();
    const results: ImageSearchResult[] = [];

    for (const r of ftsResults) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        results.push({
          ...r,
          similarity: Math.abs(r.rank || 0), // BM25 scores are negative, lower is better
        });
      }
    }

    return results.slice(0, limit);
  }

  /**
   * Find visually similar images
   */
  async findSimilar(
    imagePath: string,
    options?: { limit?: number }
  ): Promise<ImageSearchResult[]> {
    // First ensure the image is analyzed
    const analysis = await this.analyzeImage(imagePath);

    // TODO: Get CLIP embedding and search by vector
    // For now, search by categories/description
    const categories = analysis.categories.join(' ');
    if (categories) {
      return this.searchByDescription(categories, options);
    }

    return [];
  }

  /**
   * Get images that haven't been analyzed yet
   */
  getUnanalyzedImages(options?: { source?: string; limit?: number }): Array<{
    id: string;
    file_path: string;
    content_item_id: string | null;
  }> {
    return this.db.getUnanalyzedImages(options);
  }

  /**
   * Get analysis statistics
   */
  getStats(): ReturnType<EmbeddingDatabase['getImageAnalysisStats']> {
    return this.db.getImageAnalysisStats();
  }

  /**
   * Get all image clusters
   */
  getClusters(): ImageClusterInfo[] {
    return this.db.getImageClusters();
  }

  /**
   * Get images in a specific cluster
   */
  getClusterImages(clusterId: string): Array<{
    id: string;
    file_path: string;
    description: string | null;
    categories: string[];
    distance: number;
    is_representative: boolean;
  }> {
    return this.db.getClusterImages(clusterId);
  }

  /**
   * Simple category-based clustering (doesn't require embeddings)
   * Groups images by their primary category
   */
  async clusterByCategory(): Promise<ImageClusterInfo[]> {
    // Clear existing clusters
    this.db.clearImageClusters();

    // Get all analyzed images grouped by their first category
    const images = this.db.searchImagesFTS('*', { limit: 10000 });

    // Group by primary category
    const categoryGroups = new Map<string, typeof images>();

    for (const img of images) {
      const category = img.categories[0] || 'uncategorized';
      if (!categoryGroups.has(category)) {
        categoryGroups.set(category, []);
      }
      categoryGroups.get(category)!.push(img);
    }

    // Create clusters
    let clusterIndex = 0;
    for (const [category, categoryImages] of Array.from(categoryGroups.entries())) {
      if (categoryImages.length < 2) continue; // Skip tiny clusters

      const clusterId = uuidv4();
      const representativeImage = categoryImages[0];

      this.db.upsertImageCluster({
        id: clusterId,
        cluster_index: clusterIndex,
        name: category,
        description: `Images classified as "${category}"`,
        representative_image_id: representativeImage.id,
        image_count: categoryImages.length,
      });

      // Add members
      for (let i = 0; i < categoryImages.length; i++) {
        this.db.addImageToCluster(
          clusterId,
          categoryImages[i].id,
          i, // Use index as pseudo-distance
          i === 0 // First is representative
        );
      }

      clusterIndex++;
    }

    return this.db.getImageClusters();
  }
}

export default ImageIndexer;

/**
 * AUI Tools - Image Operations
 *
 * Handles image analysis and search:
 * - Describe images using AI vision
 * - Search images by description
 * - Classify images
 * - Find similar images
 * - Cluster images
 * - Add image passages to book
 */

import type { AUIContext, AUIToolResult } from './types';
import { getArchiveServerUrl } from '../../platform';

// ═══════════════════════════════════════════════════════════════════
// IMAGE TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Describe the current workspace image using AI vision
 */
export async function executeDescribeImage(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const ws = context.workspace;
  const { imagePath } = params as { imagePath?: string };

  // Use workspace image if no path provided
  const targetPath = imagePath || ws?.selectedMedia?.file_path;

  if (!targetPath) {
    return { success: false, error: 'No image selected in workspace' };
  }

  try {
    const archiveServer = await getArchiveServerUrl();
    const response = await fetch(`${archiveServer}/api/vision/describe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: targetPath }),
    });

    if (!response.ok) {
      throw new Error(`Vision API error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      success: true,
      message: 'Image described',
      data: {
        description: data.description,
        categories: data.categories,
        objects: data.objects,
        scene: data.scene,
        mood: data.mood,
        cached: data.cached,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to describe image',
    };
  }
}

/**
 * Search images by description
 */
export async function executeSearchImages(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const { query, mode = 'text', limit = 20, source } = params as {
    query?: string;
    mode?: 'text' | 'semantic' | 'hybrid';
    limit?: number;
    source?: string;
  };

  if (!query) {
    return { success: false, error: 'Missing query parameter' };
  }

  try {
    const archiveServer = await getArchiveServerUrl();
    const response = await fetch(`${archiveServer}/api/vision/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, mode, limit, source }),
    });

    if (!response.ok) {
      throw new Error(`Vision search error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      success: true,
      message: `Found ${data.count || 0} image(s) matching "${query}"`,
      data: {
        results: data.results?.slice(0, 10).map((r: any) => ({
          file_path: r.file_path,
          description: r.description?.slice(0, 100),
          categories: r.categories,
          source: r.source,
        })),
        total: data.count,
        mode,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Image search failed',
    };
  }
}

/**
 * Get category tags for the workspace image
 */
export async function executeClassifyImage(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const ws = context.workspace;
  const { imagePath } = params as { imagePath?: string };

  const targetPath = imagePath || ws?.selectedMedia?.file_path;

  if (!targetPath) {
    return { success: false, error: 'No image selected in workspace' };
  }

  try {
    const archiveServer = await getArchiveServerUrl();
    const response = await fetch(`${archiveServer}/api/vision/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: targetPath }),
    });

    if (!response.ok) {
      throw new Error(`Vision classify error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      success: true,
      message: `Image classified: ${data.categories?.join(', ') || 'no categories'}`,
      data: {
        categories: data.categories,
        confidence: data.confidence,
        model: data.model,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to classify image',
    };
  }
}

/**
 * Find visually similar images
 */
export async function executeFindSimilarImages(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const ws = context.workspace;
  const { imagePath, limit = 10 } = params as {
    imagePath?: string;
    limit?: number;
  };

  const targetPath = imagePath || ws?.selectedMedia?.file_path;

  if (!targetPath) {
    return { success: false, error: 'No image selected or specified' };
  }

  try {
    const archiveServer = await getArchiveServerUrl();
    const response = await fetch(`${archiveServer}/api/vision/similar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: targetPath, limit }),
    });

    if (!response.ok) {
      throw new Error(`Similarity search error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      success: true,
      message: `Found ${data.count || 0} similar image(s)`,
      data: {
        results: data.results?.map((r: any) => ({
          file_path: r.file_path,
          description: r.description?.slice(0, 80),
          categories: r.categories,
          similarity: r.similarity,
        })),
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Similarity search failed',
    };
  }
}

/**
 * Cluster all archive images by visual similarity
 */
export async function executeClusterImages(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const { method = 'category', source } = params as {
    method?: 'category' | 'visual';
    source?: string;
  };

  try {
    const archiveServer = await getArchiveServerUrl();
    const response = await fetch(`${archiveServer}/api/vision/cluster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, source }),
    });

    if (!response.ok) {
      throw new Error(`Clustering error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      success: true,
      message: `Created ${data.count || 0} image cluster(s)`,
      data: {
        clusters: data.clusters?.map((c: any) => ({
          id: c.id,
          name: c.name,
          image_count: c.image_count,
          description: c.description,
        })),
        method: data.method,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Clustering failed',
    };
  }
}

/**
 * Save image + description as a passage to the book
 */
export async function executeAddImagePassage(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  if (!context.addPassage) {
    return { success: false, error: 'Passage management not available' };
  }

  const ws = context.workspace;
  const { title, tags } = params as {
    title?: string;
    tags?: string[];
  };

  if (!ws?.selectedMedia) {
    return { success: false, error: 'No image selected in workspace' };
  }

  try {
    // Get image description from vision API
    const archiveServer = await getArchiveServerUrl();
    const descResponse = await fetch(`${archiveServer}/api/vision/describe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: ws.selectedMedia.file_path }),
    });

    if (!descResponse.ok) {
      throw new Error('Failed to describe image');
    }

    const { description, categories } = await descResponse.json();

    // Create passage with image markdown and description
    const content = `![${ws.selectedMedia.filename || 'Image'}](${ws.selectedMedia.file_path})

${description || 'No description available.'}

**Categories**: ${categories?.join(', ') || 'uncategorized'}`;

    const passage = context.addPassage({
      content,
      conversationTitle: title || ws.selectedMedia.filename || 'Image',
      tags: tags || categories || ['image'],
    });

    if (!passage) {
      return { success: false, error: 'Failed to add passage' };
    }

    return {
      success: true,
      message: `Added image passage "${passage.conversationTitle}"`,
      data: {
        passageId: passage.id,
        description,
        categories,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to add image passage',
    };
  }
}

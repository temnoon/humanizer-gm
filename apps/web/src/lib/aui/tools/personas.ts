/**
 * AUI Tools - Persona and Style Operations
 *
 * Handles persona and style management:
 * - List available personas and styles
 * - Apply persona/style transformations to text
 * - Extract personas and styles from sample text
 * - Discover voices from writing samples
 * - Create custom personas and styles
 */

import type { AUIContext, AUIToolResult } from './types';
import {
  transformPersona,
  transformStyle,
  getPersonas,
  getStyles,
} from '../../transform/service';
import { getStoredToken } from '../../auth';
import {
  extractPersona as extractPersonaAPI,
  extractStyle as extractStyleAPI,
  discoverVoices as discoverVoicesAPI,
  toUnifiedPersona,
  toUnifiedStyle,
} from '../../profile';

// NPE API base URL
const NPE_API_BASE = import.meta.env.VITE_API_URL || 'https://npe-api.tem-527.workers.dev';

// ═══════════════════════════════════════════════════════════════════
// PERSONA/STYLE TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * List available personas
 */
export async function executeListPersonas(): Promise<AUIToolResult> {
  try {
    const personas = await getPersonas();

    return {
      success: true,
      message: `Found ${personas.length} persona(s)`,
      data: {
        personas: personas.map(p => ({
          name: p.name,
          description: p.description,
          icon: p.icon,
        })),
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to fetch personas',
    };
  }
}

/**
 * List available styles
 */
export async function executeListStyles(): Promise<AUIToolResult> {
  try {
    const styles = await getStyles();

    return {
      success: true,
      message: `Found ${styles.length} style(s)`,
      data: {
        styles: styles.map(s => ({
          name: s.name,
          description: s.description,
          icon: s.icon,
        })),
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to fetch styles',
    };
  }
}

/**
 * Apply a persona transformation to text
 */
export async function executeApplyPersona(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { persona, text } = params as { persona?: string; text?: string };

  if (!persona) {
    return { success: false, error: 'Missing persona parameter' };
  }

  // Use provided text or workspace content
  let targetText = text;
  if (!targetText && context.workspace) {
    if (context.workspace.selectedContent) {
      targetText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      targetText = context.workspace.bufferContent;
    }
  }

  if (!targetText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  try {
    const result = await transformPersona(targetText, persona);

    return {
      success: true,
      message: `Transformed with persona "${persona}"`,
      content: result.transformed,
      data: {
        original: targetText.slice(0, 100) + '...',
        transformed: result.transformed,
        modelUsed: result.metadata?.modelUsed,
        improvement: result.metadata?.improvement,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Persona transformation failed',
    };
  }
}

/**
 * Apply a style transformation to text
 */
export async function executeApplyStyle(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { style, text } = params as { style?: string; text?: string };

  if (!style) {
    return { success: false, error: 'Missing style parameter' };
  }

  // Use provided text or workspace content
  let targetText = text;
  if (!targetText && context.workspace) {
    if (context.workspace.selectedContent) {
      targetText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      targetText = context.workspace.bufferContent;
    }
  }

  if (!targetText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  try {
    const result = await transformStyle(targetText, style);

    return {
      success: true,
      message: `Transformed with style "${style}"`,
      content: result.transformed,
      data: {
        original: targetText.slice(0, 100) + '...',
        transformed: result.transformed,
        modelUsed: result.metadata?.modelUsed,
        improvement: result.metadata?.improvement,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Style transformation failed',
    };
  }
}

/**
 * Extract a persona from sample text using Profile Factory
 */
export async function executeExtractPersona(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, name, bookTitle, author } = params as {
    text?: string;
    name?: string;
    bookTitle?: string;
    author?: string;
  };

  // Use provided text or workspace content
  let sampleText = text;
  if (!sampleText && context.workspace) {
    if (context.workspace.selectedContent) {
      sampleText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      sampleText = context.workspace.bufferContent;
    }
  }

  if (!sampleText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  // Validate text length
  if (sampleText.length < 200) {
    return { success: false, error: 'Text must be at least 200 characters for meaningful extraction' };
  }

  try {
    // Use the new ProfileExtractionService
    const response = await extractPersonaAPI(sampleText, {
      customName: name,
      bookTitle: bookTitle || context.activeProject?.name,
      author: author || context.activeProject?.author,
    });

    // Convert to unified type for storage
    const unifiedPersona = toUnifiedPersona(response, author || 'user');

    return {
      success: true,
      message: `Extracted persona "${response.name}"`,
      data: {
        name: response.name,
        description: response.description,
        attributes: response.attributes,
        system_prompt: response.system_prompt?.slice(0, 200) + '...',
        example_patterns: response.example_patterns?.slice(0, 3),
        unified: unifiedPersona,
      },
      teaching: {
        whatHappened: `Analyzed ${sampleText.split(/\s+/).length} words and extracted a persona profile with voice characteristics, perspective, and tone.`,
        guiPath: ['Studio', 'Transform Panel', 'Extract', 'Persona'],
        why: 'Personas capture WHO is speaking - their perspective, vocabulary, and emotional register. Use this persona to transform other text to sound like this voice.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Persona extraction failed',
    };
  }
}

/**
 * Extract a style from sample text using ProfileExtractionService
 */
export async function executeExtractStyle(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, name, bookTitle, author } = params as {
    text?: string;
    name?: string;
    bookTitle?: string;
    author?: string;
  };

  // Use provided text or workspace content
  let sampleText = text;
  if (!sampleText && context.workspace) {
    if (context.workspace.selectedContent) {
      sampleText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      sampleText = context.workspace.bufferContent;
    }
  }

  if (!sampleText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  // Validate text length
  if (sampleText.length < 200) {
    return { success: false, error: 'Text must be at least 200 characters for meaningful extraction' };
  }

  try {
    // Use the new ProfileExtractionService
    const response = await extractStyleAPI(sampleText, {
      customName: name,
      bookTitle: bookTitle || context.activeProject?.name,
      author: author || context.activeProject?.author,
    });

    // Convert to unified type for storage
    const unifiedStyle = toUnifiedStyle(response, author || 'user');

    return {
      success: true,
      message: `Extracted style "${response.name}"`,
      data: {
        name: response.name,
        attributes: response.attributes,
        style_prompt: response.style_prompt?.slice(0, 200) + '...',
        example_sentences: response.example_sentences?.slice(0, 3),
        unified: unifiedStyle,
      },
      teaching: {
        whatHappened: `Analyzed ${sampleText.split(/\s+/).length} words and extracted a style profile with sentence structure, vocabulary, and rhythm patterns.`,
        guiPath: ['Studio', 'Transform Panel', 'Extract', 'Style'],
        why: 'Styles capture HOW text is written - sentence patterns, vocabulary complexity, and rhetorical devices. Use this style to give any text a consistent feel.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Style extraction failed',
    };
  }
}

/**
 * Auto-discover personas and styles from writing samples using ProfileExtractionService
 */
export async function executeDiscoverVoices(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const { min_clusters, max_clusters } = params as {
    min_clusters?: number;
    max_clusters?: number;
  };

  try {
    const token = getStoredToken();
    if (!token) {
      return { success: false, error: 'Authentication required for voice discovery' };
    }

    // Use the new ProfileExtractionService
    const data = await discoverVoicesAPI({
      min_clusters: min_clusters || 3,
      max_clusters: max_clusters || 7,
    });

    return {
      success: true,
      message: `Discovered ${data.personas_discovered} persona(s) and ${data.styles_discovered} style(s)`,
      data: {
        personas_discovered: data.personas_discovered,
        styles_discovered: data.styles_discovered,
        total_words_analyzed: data.total_words_analyzed,
        personas: data.personas?.slice(0, 5).map((p) => ({
          name: p.name,
          description: p.description,
        })),
        styles: data.styles?.slice(0, 5).map((s) => ({
          name: s.name,
          description: s.description,
        })),
      },
      teaching: {
        whatHappened: `Analyzed ${data.total_words_analyzed.toLocaleString()} words across your writing samples and clustered them into ${data.personas_discovered} distinct voices.`,
        guiPath: ['Studio', 'Profile', 'Discover Voices'],
        why: 'Voice discovery uses K-means clustering on text embeddings to find patterns in how you write differently in different contexts.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Voice discovery failed',
    };
  }
}

/**
 * Create a custom persona
 */
export async function executeCreatePersona(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const { name, description, example_texts } = params as {
    name?: string;
    description?: string;
    example_texts?: string[];
  };

  if (!name) {
    return { success: false, error: 'Missing name parameter' };
  }

  try {
    const token = getStoredToken();
    if (!token) {
      return { success: false, error: 'Authentication required to create personas' };
    }

    const response = await fetch(`${NPE_API_BASE}/personal/personas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        description: description || `Custom persona: ${name}`,
        example_texts: example_texts || [],
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Creation failed: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      success: true,
      message: `Created persona "${name}"`,
      data: {
        id: data.id,
        name: data.name,
        description: data.description,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Persona creation failed',
    };
  }
}

/**
 * Create a custom style
 */
export async function executeCreateStyle(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const { name, description, formality_score, complexity_score, tone_markers, example_texts } = params as {
    name?: string;
    description?: string;
    formality_score?: number;
    complexity_score?: number;
    tone_markers?: string[];
    example_texts?: string[];
  };

  if (!name) {
    return { success: false, error: 'Missing name parameter' };
  }

  try {
    const token = getStoredToken();
    if (!token) {
      return { success: false, error: 'Authentication required to create styles' };
    }

    const response = await fetch(`${NPE_API_BASE}/personal/styles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        description: description || `Custom style: ${name}`,
        formality_score: formality_score ?? 0.5,
        complexity_score: complexity_score ?? 0.5,
        tone_markers: tone_markers || [],
        example_texts: example_texts || [],
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Creation failed: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      success: true,
      message: `Created style "${name}"`,
      data: {
        id: data.id,
        name: data.name,
        description: data.description,
        formality_score: data.formality_score,
        complexity_score: data.complexity_score,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Style creation failed',
    };
  }
}

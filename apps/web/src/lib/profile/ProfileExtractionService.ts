/**
 * Profile Extraction Service
 *
 * Client for NPE-API persona/style extraction endpoints.
 * Integrates with the unified type system in @humanizer/core.
 */

import { getStoredToken } from '../auth';
import type { Persona, Style, BookProfile } from '@humanizer/core';
import type {
  ExtractPersonaRequest,
  ExtractPersonaResponse,
  ExtractStyleRequest,
  ExtractStyleResponse,
  DiscoverVoicesRequest,
  DiscoverVoicesResponse,
  BookProfileExtractionResult,
} from './types';

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const API_BASE = import.meta.env.VITE_API_URL || 'https://npe-api.tem-527.workers.dev';
const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const LONG_TIMEOUT = 300_000;    // 5 minutes for complex extractions

// ═══════════════════════════════════════════════════════════════════
// HTTP CLIENT
// ═══════════════════════════════════════════════════════════════════

interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
}

async function apiFetch<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { method = 'POST', body, timeout = DEFAULT_TIMEOUT, signal } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const combinedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error((errorData as { error?: string }).error || `Request failed: ${response.statusText}`);
    }

    return await response.json() as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    }

    throw new Error('Unknown error occurred');
  }
}

// ═══════════════════════════════════════════════════════════════════
// PERSONA EXTRACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract a persona from text using NPE-API
 *
 * @param text - Text to analyze (50-20000 characters)
 * @param options - Optional context (bookTitle, author, chapter, customName)
 * @returns ExtractPersonaResponse with attributes and system prompt
 */
export async function extractPersona(
  text: string,
  options: Omit<ExtractPersonaRequest, 'text'> = {},
  signal?: AbortSignal
): Promise<ExtractPersonaResponse> {
  const request: ExtractPersonaRequest = {
    text,
    ...options,
  };

  return apiFetch<ExtractPersonaResponse>(
    '/transformations/extract-persona',
    { body: request, timeout: LONG_TIMEOUT, signal }
  );
}

/**
 * Convert NPE-API extraction response to unified Persona type
 */
export function toUnifiedPersona(
  response: ExtractPersonaResponse,
  authorSlug: string = 'user'
): Partial<Persona> {
  const slug = response.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return {
    type: 'persona',
    uri: `persona://${authorSlug}/${slug}`,
    name: response.name,
    description: response.description,
    author: authorSlug,
    voice: {
      selfDescription: response.description,
      styleNotes: response.example_patterns,
      register: mapRegister(response.attributes.register),
      emotionalRange: 'neutral',
    },
    extracted: {
      perspective: response.attributes.perspective,
      tone: response.attributes.tone,
      rhetoricalMode: response.attributes.rhetoricalMode,
      characteristicPatterns: response.attributes.characteristicPatterns,
      extractedAt: Date.now(),
    },
    vocabulary: {
      preferred: [],
      avoided: [],
    },
    influences: [],
    exemplars: response.example_patterns.map(text => ({
      text,
      notes: 'Auto-extracted from source',
    })),
    derivedFrom: response.source_info.bookTitle ? [{
      uri: `source://book/${slug}`,
      sourceType: 'import',
      label: response.source_info.bookTitle,
    }] : [],
    systemPrompt: response.system_prompt,
    tags: ['extracted'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function mapRegister(
  register?: string
): 'formal' | 'casual' | 'academic' | 'poetic' | 'conversational' {
  if (!register) return 'conversational';
  const lower = register.toLowerCase();
  if (lower.includes('formal')) return 'formal';
  if (lower.includes('academic')) return 'academic';
  if (lower.includes('poetic')) return 'poetic';
  if (lower.includes('casual')) return 'casual';
  return 'conversational';
}

// ═══════════════════════════════════════════════════════════════════
// STYLE EXTRACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract a style from text using NPE-API
 *
 * @param text - Text to analyze (50-20000 characters)
 * @param options - Optional context (bookTitle, author, chapter, customName)
 * @returns ExtractStyleResponse with attributes and style prompt
 */
export async function extractStyle(
  text: string,
  options: Omit<ExtractStyleRequest, 'text'> = {},
  signal?: AbortSignal
): Promise<ExtractStyleResponse> {
  const request: ExtractStyleRequest = {
    text,
    ...options,
  };

  return apiFetch<ExtractStyleResponse>(
    '/transformations/extract-style',
    { body: request, timeout: LONG_TIMEOUT, signal }
  );
}

/**
 * Convert NPE-API extraction response to unified Style type
 */
export function toUnifiedStyle(
  response: ExtractStyleResponse,
  authorSlug: string = 'user'
): Partial<Style> {
  const slug = response.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return {
    type: 'style',
    uri: `style://${authorSlug}/${slug}`,
    name: response.name,
    author: authorSlug,
    characteristics: {
      formality: response.attributes.formalityScore || 5,
      abstractionLevel: 'mixed',
      complexity: mapComplexity(response.attributes.complexityScore),
      metaphorDensity: 'moderate',
    },
    structure: {
      paragraphLength: 'varied',
      usesLists: false,
      usesHeaders: false,
      usesEpigraphs: false,
    },
    extracted: {
      sentenceStructure: response.attributes.sentenceStructure,
      vocabulary: response.attributes.vocabulary,
      rhythm: response.attributes.rhythm,
      punctuationStyle: response.attributes.punctuationStyle,
      rhetoricalDevices: response.attributes.rhetoricalDevices,
      extractedAt: Date.now(),
    },
    stylePrompt: response.style_prompt,
    exampleSentences: response.example_sentences,
    derivedFrom: response.source_info.bookTitle ? [{
      uri: `source://book/${slug}`,
      sourceType: 'import',
      label: response.source_info.bookTitle,
    }] : [],
    tags: ['extracted'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function mapComplexity(
  score?: number
): 'simple' | 'moderate' | 'complex' | 'varied' {
  if (!score) return 'moderate';
  if (score <= 3) return 'simple';
  if (score <= 6) return 'moderate';
  if (score <= 8) return 'complex';
  return 'varied';
}

// ═══════════════════════════════════════════════════════════════════
// VOICE DISCOVERY
// ═══════════════════════════════════════════════════════════════════

/**
 * Discover voices from user's writing samples
 * Uses K-means clustering on embeddings
 * Requires authentication
 *
 * @param options - Clustering parameters (min/max clusters)
 * @returns DiscoverVoicesResponse with discovered personas and styles
 */
export async function discoverVoices(
  options: DiscoverVoicesRequest = {},
  signal?: AbortSignal
): Promise<DiscoverVoicesResponse> {
  return apiFetch<DiscoverVoicesResponse>(
    '/personal/personas/discover-voices',
    { body: options, timeout: LONG_TIMEOUT, signal }
  );
}

// ═══════════════════════════════════════════════════════════════════
// BOOK PROFILE EXTRACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract a complete book profile (persona + style + themes)
 * This is a composite operation that calls multiple endpoints.
 *
 * @param text - Book content to analyze
 * @param options - What to extract
 * @returns Combined extraction results
 */
export async function extractBookProfile(
  text: string,
  options: {
    bookTitle: string;
    author?: string;
    extractPersona?: boolean;
    extractStyle?: boolean;
    extractThemes?: boolean;
  },
  signal?: AbortSignal
): Promise<BookProfileExtractionResult> {
  const startTime = Date.now();
  const results: BookProfileExtractionResult = {
    totalProcessingTimeMs: 0,
  };

  // Run extractions in parallel where possible
  const promises: Promise<void>[] = [];

  if (options.extractPersona !== false) {
    promises.push(
      extractPersona(text, {
        bookTitle: options.bookTitle,
        author: options.author,
      }, signal).then(persona => {
        results.persona = persona;
      }).catch(err => {
        console.warn('Persona extraction failed:', err);
      })
    );
  }

  if (options.extractStyle !== false) {
    promises.push(
      extractStyle(text, {
        bookTitle: options.bookTitle,
        author: options.author,
      }, signal).then(style => {
        results.style = style;
      }).catch(err => {
        console.warn('Style extraction failed:', err);
      })
    );
  }

  // Theme extraction would use a different endpoint (TBD)
  // For now, we can synthesize from persona/style
  if (options.extractThemes !== false) {
    // Themes will be populated from the pyramid summarization phase
    // This is a placeholder for future implementation
    results.themes = undefined;
  }

  await Promise.all(promises);
  results.totalProcessingTimeMs = Date.now() - startTime;

  return results;
}

/**
 * Convert extraction result to unified BookProfile type
 */
export function toBookProfile(
  result: BookProfileExtractionResult,
  existingProfile?: Partial<BookProfile>
): Partial<BookProfile> {
  return {
    ...existingProfile,
    tone: {
      overall: result.persona?.attributes.tone || existingProfile?.tone?.overall || 'neutral',
      register: result.persona?.attributes.register || existingProfile?.tone?.register || 'neutral',
      emotionalArc: existingProfile?.tone?.emotionalArc,
    },
    stats: {
      pyramidDepth: existingProfile?.stats?.pyramidDepth || 0,
      totalChunks: existingProfile?.stats?.totalChunks || 0,
      compressionRatio: existingProfile?.stats?.compressionRatio || 0,
      lastUpdated: Date.now(),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

export type {
  ExtractPersonaRequest,
  ExtractPersonaResponse,
  ExtractStyleRequest,
  ExtractStyleResponse,
  DiscoverVoicesRequest,
  DiscoverVoicesResponse,
  BookProfileExtractionResult,
  ExtractedThemes,
} from './types';

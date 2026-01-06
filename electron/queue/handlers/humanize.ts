/**
 * Batch Humanization Handler
 *
 * Humanizes text files through the NPE API.
 * Supports plain text, markdown, and other text formats.
 */

import * as fs from 'fs';
import type { HumanizationResult } from '../types';

// NPE API configuration
const NPE_LOCAL_URL = 'http://localhost:3003';
const NPE_CLOUD_URL = process.env.NPE_API_URL || 'https://npe-api.tem-527.workers.dev';

// Supported text formats
const SUPPORTED_FORMATS = ['.txt', '.md', '.markdown', '.text'];

// Cached availability check
let npeLocalAvailable: boolean | null = null;
let lastCheck = 0;
const CHECK_INTERVAL = 30000; // 30 seconds

/**
 * Check if NPE-Local is available
 */
async function checkNpeLocalAvailable(): Promise<boolean> {
  const now = Date.now();
  if (npeLocalAvailable !== null && now - lastCheck < CHECK_INTERVAL) {
    return npeLocalAvailable;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${NPE_LOCAL_URL}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    npeLocalAvailable = response.ok;
    lastCheck = now;
    return npeLocalAvailable;
  } catch {
    npeLocalAvailable = false;
    lastCheck = now;
    return false;
  }
}

/**
 * Get the best API base URL (local or cloud)
 */
async function getApiBase(): Promise<string> {
  const localAvailable = await checkNpeLocalAvailable();
  return localAvailable ? NPE_LOCAL_URL : NPE_CLOUD_URL;
}

/**
 * Check if a file is a supported text format
 */
export function isSupportedTextFormat(filePath: string): boolean {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  return SUPPORTED_FORMATS.includes(ext);
}

/**
 * Humanize a text file
 */
export async function humanizeText(
  filePath: string,
  options?: {
    intensity?: 'light' | 'moderate' | 'aggressive';
    model?: string;
    voiceSamples?: string[];
  }
): Promise<HumanizationResult> {
  // Verify file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`Text file not found: ${filePath}`);
  }

  // Check format
  if (!isSupportedTextFormat(filePath)) {
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    throw new Error(
      `Unsupported text format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(', ')}`
    );
  }

  // Read the text file
  const text = await fs.promises.readFile(filePath, 'utf-8');

  if (!text.trim()) {
    throw new Error('File is empty');
  }

  // Get API base
  const apiBase = await getApiBase();

  // Build request
  const request = {
    text,
    intensity: options?.intensity || 'moderate',
    voiceSamples: options?.voiceSamples,
    enableLLMPolish: true,
    model: options?.model,
  };

  // Call humanization API
  const startTime = Date.now();
  const response = await fetch(`${apiBase}/transformations/computer-humanizer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error || `Humanization failed: ${response.statusText}`);
  }

  const result = await response.json() as {
    humanizedText: string;
    model_used?: string;
    baseline?: number;
    final?: number;
    improvement?: number;
  };

  return {
    original: text,
    humanized: result.humanizedText,
    model: result.model_used || options?.model || 'unknown',
    processingTimeMs: Date.now() - startTime,
    improvement: result.baseline !== undefined && result.final !== undefined ? {
      baseline: result.baseline,
      final: result.final,
      delta: result.improvement,
    } : undefined,
  };
}

/**
 * Check if humanization is available
 */
export async function isHumanizationAvailable(): Promise<boolean> {
  // Try local first, then cloud
  const localAvailable = await checkNpeLocalAvailable();
  if (localAvailable) return true;

  // Check cloud availability
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${NPE_CLOUD_URL}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

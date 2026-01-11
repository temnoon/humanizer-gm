/**
 * AUI Tools - Text Transformation Operations
 *
 * Handles text transformation and analysis:
 * - Humanize AI-generated text
 * - Detect AI-generated content
 * - Translate text to other languages
 * - Analyze text for linguistic features
 * - Quantum reading (tetralemma analysis)
 */

import type { AUIContext, AUIToolResult } from './types';
import {
  humanize,
  detectAI,
  detectAILite,
  analyzeSentences,
  type DetectionResponse,
} from '../../transform/service';
import { getStoredToken } from '../../auth';

// NPE API base URL
const NPE_API_BASE = import.meta.env.VITE_API_URL || 'https://npe-api.tem-527.workers.dev';

// ═══════════════════════════════════════════════════════════════════
// TEXT TRANSFORMATION TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Humanize AI-generated text
 */
export async function executeHumanize(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, intensity, voiceSamples } = params as {
    text?: string;
    intensity?: 'light' | 'moderate' | 'aggressive';
    voiceSamples?: string[];
  };

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
    const result = await humanize(targetText, {
      intensity: intensity || 'moderate',
      voiceSamples,
      enableLLMPolish: true,
    });

    return {
      success: true,
      message: `Humanized with ${intensity || 'moderate'} intensity`,
      content: result.transformed,
      data: {
        original: targetText.slice(0, 100) + '...',
        transformed: result.transformed,
        modelUsed: result.metadata?.modelUsed,
        baseline: result.metadata?.baseline,
        final: result.metadata?.final,
        improvement: result.metadata?.improvement,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Humanization failed',
    };
  }
}

/**
 * Detect if text is AI-generated
 */
export async function executeDetectAI(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, lite } = params as { text?: string; lite?: boolean };

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
    const result: DetectionResponse = lite
      ? await detectAILite(targetText)
      : await detectAI(targetText);

    const verdictText = result.confidence > 0.7
      ? 'Likely AI-generated'
      : result.confidence > 0.4
        ? 'Mixed/uncertain'
        : 'Likely human-written';

    return {
      success: true,
      message: `${verdictText} (${Math.round(result.confidence * 100)}% AI confidence)`,
      data: {
        confidence: result.confidence,
        verdict: result.verdict,
        verdictText,
        method: result.method,
        explanation: result.explanation,
        details: result.details,
        processingTimeMs: result.processingTimeMs,
        textLength: targetText.length,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'AI detection failed',
    };
  }
}

/**
 * Translate text to another language
 */
export async function executeTranslate(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, targetLanguage, sourceLanguage } = params as {
    text?: string;
    targetLanguage?: string;
    sourceLanguage?: string;
  };

  if (!targetLanguage) {
    return { success: false, error: 'Missing targetLanguage parameter (e.g., "Spanish", "French", "Japanese")' };
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
    const token = getStoredToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${NPE_API_BASE}/transformations/translate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: targetText,
        target_language: targetLanguage,
        source_language: sourceLanguage,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Translation failed: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      success: true,
      message: `Translated to ${targetLanguage}`,
      content: data.translated_text,
      data: {
        original: targetText.slice(0, 100) + '...',
        translated: data.translated_text,
        sourceLanguage: data.source_language || sourceLanguage || 'auto-detected',
        targetLanguage: data.target_language || targetLanguage,
        confidence: data.confidence,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Translation failed',
    };
  }
}

/**
 * Analyze text for linguistic features
 */
export async function executeAnalyzeText(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text } = params as { text?: string };

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
    const token = getStoredToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${NPE_API_BASE}/ai-detection/detect-v2/features`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: targetText }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Analysis failed: ${response.statusText}`);
    }

    const data = await response.json();

    // Summarize key findings
    const highlights: string[] = [];
    if (data.burstiness !== undefined) {
      highlights.push(`Burstiness: ${data.burstiness.toFixed(2)} (${data.burstiness > 0.5 ? 'varied' : 'uniform'} sentence lengths)`);
    }
    if (data.vocabulary_diversity !== undefined) {
      highlights.push(`Vocabulary diversity: ${data.vocabulary_diversity.toFixed(2)}`);
    }
    if (data.tell_phrase_count !== undefined && data.tell_phrase_count > 0) {
      highlights.push(`AI tell-phrases detected: ${data.tell_phrase_count}`);
    }

    return {
      success: true,
      message: `Analyzed ${targetText.split(/\s+/).length} words`,
      data: {
        wordCount: targetText.split(/\s+/).filter(w => w).length,
        sentenceCount: targetText.split(/[.!?]+/).filter(s => s.trim()).length,
        burstiness: data.burstiness,
        vocabularyDiversity: data.vocabulary_diversity,
        avgSentenceLength: data.avg_sentence_length,
        tellPhraseCount: data.tell_phrase_count,
        tellPhrases: data.tell_phrases?.slice(0, 5),
        punctuationDensity: data.punctuation_density,
        highlights,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Text analysis failed',
    };
  }
}

/**
 * Quantum reading - sentence-by-sentence tetralemma analysis
 */
export async function executeQuantumRead(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, detailed } = params as { text?: string; detailed?: boolean };

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
    const result = await analyzeSentences(targetText);

    // Summarize the quantum reading
    const stanceEmoji: Record<string, string> = {
      literal: '📐',
      metaphorical: '🌀',
      both: '⚛️',
      neither: '○',
    };

    const dominantStance = result.overall.dominantStance as keyof typeof stanceEmoji;
    const summary = `${stanceEmoji[dominantStance] || '?'} Dominant: ${dominantStance} | Entropy: ${result.overall.avgEntropy.toFixed(2)} | Purity: ${result.overall.avgPurity.toFixed(2)}`;

    // Create sentence breakdown if detailed
    const sentenceBreakdown = detailed
      ? result.sentences.map(s => ({
          text: s.text.slice(0, 60) + (s.text.length > 60 ? '...' : ''),
          stance: s.dominant,
          emoji: stanceEmoji[s.dominant] || '?',
          tetralemma: {
            L: Math.round(s.tetralemma.literal * 100),
            M: Math.round(s.tetralemma.metaphorical * 100),
            B: Math.round(s.tetralemma.both * 100),
            N: Math.round(s.tetralemma.neither * 100),
          },
        }))
      : undefined;

    return {
      success: true,
      message: summary,
      data: {
        totalSentences: result.overall.totalSentences,
        dominantStance: result.overall.dominantStance,
        avgEntropy: result.overall.avgEntropy,
        avgPurity: result.overall.avgPurity,
        stanceCounts: {
          literal: result.sentences.filter(s => s.dominant === 'literal').length,
          metaphorical: result.sentences.filter(s => s.dominant === 'metaphorical').length,
          both: result.sentences.filter(s => s.dominant === 'both').length,
          neither: result.sentences.filter(s => s.dominant === 'neither').length,
        },
        sentences: sentenceBreakdown,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Quantum reading failed',
    };
  }
}

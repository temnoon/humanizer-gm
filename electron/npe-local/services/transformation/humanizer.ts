/**
 * Computer Humanizer Service (Local)
 *
 * Simplified humanization pipeline for local/Electron use.
 * Uses Ollama for LLM operations.
 */

import { createLLMProvider, type LLMProvider } from '../llm';
import { detect, type DetectionResult } from '../detection';

export interface HumanizationOptions {
  intensity?: 'light' | 'moderate' | 'aggressive';
  preserveFormatting?: boolean;
  model?: string;
}

export interface HumanizationResult {
  humanizedText: string;
  baseline: { detection: DetectionResult };
  final: { detection: DetectionResult };
  improvement: {
    aiConfidenceDrop: number;
    burstinessIncrease: number;
    tellWordsRemoved: number;
  };
  modelUsed?: string;
  processing: {
    totalDurationMs: number;
  };
}

/**
 * System prompt for humanization
 */
const HUMANIZATION_PROMPT = `You are an expert editor who makes AI-generated text sound more naturally human.

Your task: Transform the given text to reduce AI detection while preserving the original meaning and information.

Guidelines:
1. VARY SENTENCE LENGTHS - Mix very short sentences (3-5 words) with longer, complex ones (25+ words)
2. USE SEMICOLONS - Replace some commas or periods with semicolons where grammatically appropriate
3. REMOVE AI TELL-PHRASES - Avoid words like: delve, myriad, tapestry, paradigm, holistic, moreover, furthermore
4. ADD NATURAL HEDGES - Use phrases like "kind of", "sort of", "I think", "probably" where appropriate
5. VARY PUNCTUATION - Use occasional dashes, parenthetical asides, or rhetorical questions
6. PRESERVE MEANING - Keep all facts and key information intact

Intensity levels:
- light: Make minimal changes, focus on obvious AI tells
- moderate: Make noticeable changes while preserving voice
- aggressive: Significantly rephrase while keeping meaning

Return ONLY the transformed text, no explanations or meta-commentary.`;

/**
 * Humanize text using LLM
 */
export async function humanizeText(
  text: string,
  options: HumanizationOptions = {}
): Promise<HumanizationResult> {
  const startTime = Date.now();

  // Validate input
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  const trimmedText = text.trim();
  const wordCount = trimmedText.split(/\s+/).length;

  if (wordCount < 20) {
    throw new Error('Text must be at least 20 words for humanization');
  }

  // Get baseline detection
  const baselineDetection = detect(trimmedText);

  // If already human-like, return early
  if (baselineDetection.verdict === 'human' && baselineDetection.aiLikelihood < 25) {
    return {
      humanizedText: trimmedText,
      baseline: { detection: baselineDetection },
      final: { detection: baselineDetection },
      improvement: {
        aiConfidenceDrop: 0,
        burstinessIncrease: 0,
        tellWordsRemoved: 0,
      },
      processing: {
        totalDurationMs: Date.now() - startTime,
      },
    };
  }

  // Create LLM provider
  let provider: LLMProvider;
  try {
    provider = await createLLMProvider(options.model);
  } catch (error) {
    throw new Error(`Failed to create LLM provider: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Check availability
  if (!(await provider.isAvailable())) {
    throw new Error('LLM provider is not available. Please ensure Ollama is running.');
  }

  const intensity = options.intensity || 'moderate';

  // Build the prompt
  const userPrompt = `Intensity: ${intensity}

Original text:
${trimmedText}

Transform this text to sound more naturally human while preserving all meaning and information.`;

  // Call LLM
  const response = await provider.call({
    messages: [
      { role: 'system', content: HUMANIZATION_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: Math.max(1000, wordCount * 3),
    temperature: intensity === 'aggressive' ? 0.8 : intensity === 'moderate' ? 0.6 : 0.4,
  });

  const humanizedText = response.response.trim();

  // Get final detection
  const finalDetection = detect(humanizedText);

  // Calculate improvement
  const improvement = {
    aiConfidenceDrop: baselineDetection.aiLikelihood - finalDetection.aiLikelihood,
    burstinessIncrease: finalDetection.features.burstiness - baselineDetection.features.burstiness,
    tellWordsRemoved: baselineDetection.tellPhrases.aiTellWeight - finalDetection.tellPhrases.aiTellWeight,
  };

  return {
    humanizedText,
    baseline: { detection: baselineDetection },
    final: { detection: finalDetection },
    improvement,
    modelUsed: response.model,
    processing: {
      totalDurationMs: Date.now() - startTime,
    },
  };
}

/**
 * Analyze text for humanization potential
 */
export async function analyzeForHumanization(text: string): Promise<{
  detection: DetectionResult;
  recommendedIntensity: 'light' | 'moderate' | 'aggressive';
  estimatedImprovement: string;
}> {
  const detection = detect(text, {
    returnHumanizationRecommendations: true,
  });

  let recommendedIntensity: 'light' | 'moderate' | 'aggressive';
  let estimatedImprovement: string;

  if (detection.aiLikelihood > 75) {
    recommendedIntensity = 'aggressive';
    estimatedImprovement = 'Significant changes needed. Expect 30-50% reduction in AI likelihood.';
  } else if (detection.aiLikelihood > 50) {
    recommendedIntensity = 'moderate';
    estimatedImprovement = 'Moderate changes needed. Expect 20-35% reduction in AI likelihood.';
  } else {
    recommendedIntensity = 'light';
    estimatedImprovement = 'Minor tweaks needed. Expect 10-20% reduction in AI likelihood.';
  }

  return {
    detection,
    recommendedIntensity,
    estimatedImprovement,
  };
}

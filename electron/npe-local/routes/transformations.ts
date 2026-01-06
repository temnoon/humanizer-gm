/**
 * Transformation Routes
 *
 * Local API endpoints for text transformations.
 */

import { Router, Request, Response } from 'express';
import { humanizeText, analyzeForHumanization } from '../services/transformation/humanizer';
import { createLLMProvider, isOllamaAvailable, listOllamaModels } from '../services/llm';

export function createTransformationsRouter(): Router {
  const router = Router();

  /**
   * GET /transformations/health
   * Health check
   */
  router.get('/health', async (_req: Request, res: Response) => {
    const ollamaAvailable = await isOllamaAvailable();
    const models = ollamaAvailable ? await listOllamaModels() : [];

    res.json({
      status: ollamaAvailable ? 'ok' : 'degraded',
      service: 'transformations',
      ollama: {
        available: ollamaAvailable,
        models,
      },
    });
  });

  /**
   * POST /transformations/humanize
   * POST /transformations/computer-humanizer (alias for cloud API compatibility)
   * Humanize AI-generated text
   *
   * Request:
   * {
   *   text: string,
   *   options?: {
   *     intensity?: 'light' | 'moderate' | 'aggressive',
   *     preserveFormatting?: boolean,
   *     model?: string,
   *   }
   * }
   */
  const humanizeHandler = async (req: Request, res: Response) => {
    try {
      const { text, intensity, voiceSamples, enableLLMPolish, model } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      const trimmedText = text.trim();
      // Relaxed validation for quick testing (was 50 chars, 20 words)
      if (trimmedText.length < 10) {
        return res.status(400).json({
          error: 'Text must be at least 10 characters',
        });
      }

      const words = trimmedText.split(/\s+/).filter(w => w.length > 0);
      if (words.length < 3) {
        return res.status(400).json({
          error: 'Text must be at least 3 words',
        });
      }

      const options = {
        intensity: intensity || 'moderate',
        voiceSamples,
        enableLLMPolish,
        model,
      };

      const result = await humanizeText(trimmedText, options);

      // Transform to cloud API response format
      res.json({
        transformation_id: `local-${Date.now()}`,
        humanizedText: result.humanizedText,
        model_used: result.modelUsed || 'local',
        processing: {
          totalTimeMs: result.processing?.totalDurationMs || 0,
        },
        baseline: result.baseline,
        final: result.final,
        improvement: result.improvement,
      });
    } catch (error) {
      console.error('[Humanize] Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Humanization failed',
      });
    }
  };

  router.post('/humanize', humanizeHandler);
  router.post('/computer-humanizer', humanizeHandler);

  /**
   * POST /transformations/analyze
   * POST /transformations/computer-humanizer/analyze (alias for cloud API compatibility)
   * Analyze text for humanization potential
   */
  const analyzeHandler = async (req: Request, res: Response) => {
    try {
      const { text } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      const result = await analyzeForHumanization(text.trim());

      res.json(result);
    } catch (error) {
      console.error('[Analyze] Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Analysis failed',
      });
    }
  };

  router.post('/analyze', analyzeHandler);
  router.post('/computer-humanizer/analyze', analyzeHandler);

  /**
   * POST /transformations/chat
   * Simple LLM chat endpoint
   *
   * Request:
   * {
   *   messages: Array<{ role: 'system' | 'user' | 'assistant', content: string }>,
   *   model?: string,
   *   temperature?: number,
   *   max_tokens?: number,
   * }
   */
  router.post('/chat', async (req: Request, res: Response) => {
    try {
      const { messages, model, temperature, max_tokens } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Messages array is required' });
      }

      const provider = await createLLMProvider(model);

      if (!(await provider.isAvailable())) {
        return res.status(503).json({
          error: 'LLM provider is not available. Please ensure Ollama is running.',
        });
      }

      const response = await provider.call({
        messages,
        max_tokens: max_tokens || 2000,
        temperature: temperature ?? 0.7,
      });

      res.json({
        response: response.response,
        model: response.model,
        provider: response.provider,
      });
    } catch (error) {
      console.error('[Chat] Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Chat failed',
      });
    }
  });

  /**
   * GET /transformations/models
   * List available models
   */
  router.get('/models', async (_req: Request, res: Response) => {
    try {
      const ollamaAvailable = await isOllamaAvailable();

      if (!ollamaAvailable) {
        return res.json({
          available: false,
          models: [],
          message: 'Ollama is not running',
        });
      }

      const models = await listOllamaModels();

      res.json({
        available: true,
        models,
        default: 'llama3.2:3b',
      });
    } catch (error) {
      console.error('[Models] Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to list models',
      });
    }
  });

  /**
   * POST /transformations/persona
   * Transform text using a persona
   */
  router.post('/persona', async (req: Request, res: Response) => {
    try {
      const { text, persona, preserveLength, model } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      if (!persona || typeof persona !== 'string') {
        return res.status(400).json({ error: 'Persona is required' });
      }

      const trimmedText = text.trim();
      if (trimmedText.length < 20) {
        return res.status(400).json({ error: 'Text must be at least 20 characters' });
      }

      const provider = await createLLMProvider(model);
      if (!(await provider.isAvailable())) {
        return res.status(503).json({ error: 'LLM provider not available' });
      }

      // Build persona prompt
      const systemPrompt = `You are a text transformation assistant. Transform the following text to match this persona: "${persona}".
${preserveLength ? 'Maintain approximately the same length as the original.' : ''}
Preserve the core meaning and information while adapting the voice and style.
Return ONLY the transformed text, no explanations.`;

      const response = await provider.call({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: trimmedText },
        ],
        max_tokens: Math.max(2000, trimmedText.length * 2),
        temperature: 0.7,
      });

      res.json({
        transformation_id: `local-persona-${Date.now()}`,
        transformed_text: response.response,
        model_used: response.model,
        processing: { totalTimeMs: 0 },
      });
    } catch (error) {
      console.error('[Persona] Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Persona transformation failed',
      });
    }
  });

  /**
   * POST /transformations/style
   * Transform text using a style
   */
  router.post('/style', async (req: Request, res: Response) => {
    try {
      const { text, style, preserveLength, model } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      if (!style || typeof style !== 'string') {
        return res.status(400).json({ error: 'Style is required' });
      }

      const trimmedText = text.trim();
      if (trimmedText.length < 20) {
        return res.status(400).json({ error: 'Text must be at least 20 characters' });
      }

      const provider = await createLLMProvider(model);
      if (!(await provider.isAvailable())) {
        return res.status(503).json({ error: 'LLM provider not available' });
      }

      // Build style prompt
      const systemPrompt = `You are a text transformation assistant. Transform the following text to match this style: "${style}".
${preserveLength ? 'Maintain approximately the same length as the original.' : ''}
Preserve the core meaning and information while adapting the writing style.
Return ONLY the transformed text, no explanations.`;

      const response = await provider.call({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: trimmedText },
        ],
        max_tokens: Math.max(2000, trimmedText.length * 2),
        temperature: 0.7,
      });

      res.json({
        transformation_id: `local-style-${Date.now()}`,
        transformed_text: response.response,
        model_used: response.model,
        processing: { totalTimeMs: 0 },
      });
    } catch (error) {
      console.error('[Style] Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Style transformation failed',
      });
    }
  });

  return router;
}

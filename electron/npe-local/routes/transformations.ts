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
  router.post('/humanize', async (req: Request, res: Response) => {
    try {
      const { text, options } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      const trimmedText = text.trim();
      if (trimmedText.length < 50) {
        return res.status(400).json({
          error: 'Text must be at least 50 characters',
        });
      }

      const words = trimmedText.split(/\s+/).filter(w => w.length > 0);
      if (words.length < 20) {
        return res.status(400).json({
          error: 'Text must be at least 20 words',
        });
      }

      const result = await humanizeText(trimmedText, options || {});

      res.json(result);
    } catch (error) {
      console.error('[Humanize] Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Humanization failed',
      });
    }
  });

  /**
   * POST /transformations/analyze
   * Analyze text for humanization potential
   */
  router.post('/analyze', async (req: Request, res: Response) => {
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
  });

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

  return router;
}

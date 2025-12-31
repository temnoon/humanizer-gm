/**
 * AI Detection Routes
 *
 * Local API endpoints for AI detection.
 */

import { Router, Request, Response } from 'express';
import {
  detect,
  detectQuick,
  extractFeatures,
  scoreTellPhrases,
  featureSummary,
  DETECTOR_VERSION,
} from '../services/detection';

export function createDetectionRouter(): Router {
  const router = Router();

  /**
   * GET /ai-detection/health
   * Health check
   */
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'ai-detection',
      version: DETECTOR_VERSION,
      mode: 'local',
    });
  });

  /**
   * POST /ai-detection/detect
   * Full AI detection with all features
   *
   * Request:
   * {
   *   text: string,
   *   options?: {
   *     returnSentenceAnalysis?: boolean,
   *     returnHumanizationRecommendations?: boolean,
   *   }
   * }
   */
  router.post('/detect', async (req: Request, res: Response) => {
    try {
      const { text, options } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      const trimmedText = text.trim();
      // Relaxed validation for quick testing (was 100 chars, 20 words)
      if (trimmedText.length < 20) {
        return res.status(400).json({
          error: 'Text must be at least 20 characters for detection',
        });
      }

      const words = trimmedText.split(/\s+/).filter(w => w.length > 0);
      if (words.length < 5) {
        return res.status(400).json({
          error: 'Text must be at least 5 words for detection',
        });
      }

      const result = detect(trimmedText, {
        returnSentenceAnalysis: options?.returnSentenceAnalysis ?? false,
        returnHumanizationRecommendations: options?.returnHumanizationRecommendations ?? true,
      });

      res.json({
        ...result,
        method: 'local-statistical',
      });
    } catch (error) {
      console.error('[AI Detection] Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Detection failed',
      });
    }
  });

  /**
   * POST /ai-detection/detect-quick
   * POST /ai-detection/lite (alias for cloud API compatibility)
   * Quick detection for simple responses
   */
  const quickHandler = async (req: Request, res: Response) => {
    try {
      const { text } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      const trimmedText = text.trim();
      if (trimmedText.length < 50) {
        return res.status(400).json({
          error: 'Text must be at least 50 characters',
        });
      }

      const result = detectQuick(trimmedText);

      res.json(result);
    } catch (error) {
      console.error('[AI Detection Quick] Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Detection failed',
      });
    }
  };

  router.post('/detect-quick', quickHandler);
  router.post('/lite', quickHandler);

  /**
   * POST /ai-detection/features
   * Extract features without scoring
   */
  router.post('/features', async (req: Request, res: Response) => {
    try {
      const { text } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      const features = extractFeatures(text.trim());
      const summary = featureSummary(features);

      res.json({
        features,
        summary,
      });
    } catch (error) {
      console.error('[AI Detection Features] Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Feature extraction failed',
      });
    }
  });

  /**
   * POST /ai-detection/tell-phrases
   * Score tell-phrases in text
   */
  router.post('/tell-phrases', async (req: Request, res: Response) => {
    try {
      const { text } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      const result = scoreTellPhrases(text.trim());

      res.json(result);
    } catch (error) {
      console.error('[AI Detection Tell-Phrases] Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Tell-phrase scoring failed',
      });
    }
  });

  return router;
}

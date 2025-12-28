/**
 * Config Routes
 *
 * Local API endpoints for configuration (personas, styles).
 */

import { Router, Request, Response } from 'express';

export function createConfigRouter(): Router {
  const router = Router();

  /**
   * GET /config/personas
   * List available personas
   */
  router.get('/personas', (_req: Request, res: Response) => {
    // Return built-in personas for local mode
    const personas = [
      {
        id: 1,
        name: 'Academic',
        description: 'Scholarly, precise, citation-aware',
        system_prompt: 'Write in an academic style with precise language and scholarly tone.',
      },
      {
        id: 2,
        name: 'Conversational',
        description: 'Friendly, accessible, warm',
        system_prompt: 'Write in a friendly, conversational tone that feels natural and approachable.',
      },
      {
        id: 3,
        name: 'Technical',
        description: 'Detailed, systematic, thorough',
        system_prompt: 'Write with technical precision, using systematic structure and thorough explanations.',
      },
      {
        id: 4,
        name: 'Creative',
        description: 'Expressive, imaginative, flowing',
        system_prompt: 'Write with creative flair, using vivid language and imaginative expressions.',
      },
      {
        id: 5,
        name: 'Professional',
        description: 'Polished, business-appropriate',
        system_prompt: 'Write in a polished, professional tone suitable for business communication.',
      },
      {
        id: 6,
        name: 'Casual',
        description: 'Relaxed, informal, natural',
        system_prompt: 'Write in a casual, relaxed style as if talking to a friend.',
      },
    ];

    res.json(personas);
  });

  /**
   * GET /config/styles
   * List available styles
   */
  router.get('/styles', (_req: Request, res: Response) => {
    // Return built-in styles for local mode
    const styles = [
      {
        id: 1,
        name: 'Formal',
        description: 'Professional, polished',
        style_prompt: 'Use formal language with proper structure and professional tone.',
      },
      {
        id: 2,
        name: 'Casual',
        description: 'Relaxed, natural',
        style_prompt: 'Use casual, everyday language that feels natural and relaxed.',
      },
      {
        id: 3,
        name: 'Concise',
        description: 'Tighten, remove fluff',
        style_prompt: 'Be concise and direct. Remove unnecessary words and filler.',
      },
      {
        id: 4,
        name: 'Elaborate',
        description: 'Expand, add detail',
        style_prompt: 'Expand on ideas with additional detail and explanation.',
      },
      {
        id: 5,
        name: 'Academic',
        description: 'Scholarly, citation-ready',
        style_prompt: 'Use academic style suitable for scholarly writing.',
      },
      {
        id: 6,
        name: 'Journalistic',
        description: 'Clear, objective, informative',
        style_prompt: 'Write in journalistic style: clear, objective, and informative.',
      },
      {
        id: 7,
        name: 'Literary',
        description: 'Artistic, expressive',
        style_prompt: 'Use literary techniques for artistic, expressive writing.',
      },
      {
        id: 8,
        name: 'Technical',
        description: 'Precise, systematic',
        style_prompt: 'Use technical writing style with precise terminology and clear structure.',
      },
    ];

    res.json(styles);
  });

  return router;
}

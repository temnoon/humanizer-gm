/**
 * Outline Computation Routes
 *
 * Server-side endpoints for outline research and generation.
 * Business logic lives in OutlineService.
 *
 * Endpoints:
 * POST /api/outline-compute/:bookId/research  - Run research phase
 * GET  /api/outline-compute/:bookId/research  - Get cached research
 * POST /api/outline-compute/generate          - Generate outline from research
 * POST /api/outline-compute/:bookId/order-cards - Order cards for draft
 */

import { Router, Request, Response } from 'express';
import { getOutlineService } from '../services/OutlineService';
import { getDatabase, DbBook } from '../database';

export function createOutlineComputationRouter(): Router {
  const router = Router();

  /**
   * POST /api/outline-compute/:bookId/research
   * Run research phase on book's staging cards
   */
  router.post('/:bookId/research', async (req: Request, res: Response) => {
    try {
      const { bookId } = req.params;

      // Verify book exists
      const db = getDatabase();
      const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId) as DbBook | undefined;
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const outlineService = getOutlineService();
      const research = await outlineService.researchCards(bookId);

      res.json({
        success: true,
        research,
        message: `Research completed: ${research.themes.length} themes, ${research.arcs.length} arcs`,
      });
    } catch (error) {
      console.error('[outline-compute] Research failed:', error);
      res.status(500).json({
        error: 'Research failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/outline-compute/:bookId/research
   * Get cached research (if exists)
   */
  router.get('/:bookId/research', async (req: Request, res: Response) => {
    try {
      const { bookId } = req.params;

      const outlineService = getOutlineService();
      const research = await outlineService.getCachedResearch(bookId);

      if (!research) {
        return res.status(404).json({
          error: 'No research found',
          message: 'Run POST /api/outline-compute/:bookId/research first',
        });
      }

      res.json({
        success: true,
        research,
        cached: true,
      });
    } catch (error) {
      console.error('[outline-compute] Get research failed:', error);
      res.status(500).json({
        error: 'Failed to get research',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/outline-compute/generate
   * Generate outline from research
   */
  router.post('/generate', async (req: Request, res: Response) => {
    try {
      const { bookId, maxSections, preferArcStructure } = req.body;

      if (!bookId) {
        return res.status(400).json({ error: 'bookId is required' });
      }

      // Verify book exists
      const db = getDatabase();
      const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId) as DbBook | undefined;
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const outlineService = getOutlineService();
      const outline = await outlineService.generateOutline(bookId, {
        maxSections,
        preferArcStructure,
      });

      res.json({
        success: true,
        outline,
        message: `Generated outline with ${outline.structure.items.length} sections`,
      });
    } catch (error) {
      console.error('[outline-compute] Generate outline failed:', error);
      res.status(500).json({
        error: 'Failed to generate outline',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/outline-compute/:bookId/order-cards
   * Order cards within sections for draft generation
   */
  router.post('/:bookId/order-cards', async (req: Request, res: Response) => {
    try {
      const { bookId } = req.params;
      const { outlineId } = req.body;

      // Verify book exists
      const db = getDatabase();
      const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId) as DbBook | undefined;
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const outlineService = getOutlineService();
      const orderedSections = await outlineService.orderCardsForDraft(bookId, outlineId);

      res.json({
        success: true,
        sections: orderedSections,
        totalSections: orderedSections.length,
        totalCards: orderedSections.reduce((sum, s) => sum + s.cards.length, 0),
      });
    } catch (error) {
      console.error('[outline-compute] Order cards failed:', error);
      res.status(500).json({
        error: 'Failed to order cards',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/outline-compute/:bookId/review
   * Review outline coverage and quality (future: AI-assisted review)
   */
  router.post('/:bookId/review', async (req: Request, res: Response) => {
    try {
      const { bookId } = req.params;
      const { outlineId } = req.body;

      // Verify book exists
      const db = getDatabase();
      const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId) as DbBook | undefined;
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const outlineService = getOutlineService();

      // Get research (which includes coverage analysis)
      const research = await outlineService.getOrCreateResearch(bookId);

      // Get ordered sections to understand coverage
      const orderedSections = await outlineService.orderCardsForDraft(bookId, outlineId);

      // Build review summary
      const review = {
        bookId,
        totalCards: research.totalCards,
        themes: research.themes.length,
        arcs: research.arcs.length,
        coverageGaps: research.coverageGaps,
        strongAreas: research.strongAreas,
        sections: orderedSections.map(s => ({
          title: s.title,
          cardCount: s.cards.length,
          keyPassageCount: s.keyPassageIds.length,
        })),
        confidence: research.confidence,
        recommendations: generateRecommendations(research),
        reviewedAt: new Date().toISOString(),
      };

      res.json({
        success: true,
        review,
      });
    } catch (error) {
      console.error('[outline-compute] Review failed:', error);
      res.status(500).json({
        error: 'Failed to review outline',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

/**
 * Generate actionable recommendations from research
 */
function generateRecommendations(research: {
  coverageGaps: Array<{ severity: string; theme: string; suggestedAction: string }>;
  strongAreas: string[];
  confidence: number;
  themes: Array<{ name: string; strength: number }>;
}): string[] {
  const recommendations: string[] = [];

  // Major gaps are top priority
  const majorGaps = research.coverageGaps.filter(g => g.severity === 'major');
  for (const gap of majorGaps.slice(0, 2)) {
    recommendations.push(`⚠️ ${gap.suggestedAction}`);
  }

  // Low confidence means more research needed
  if (research.confidence < 0.4) {
    recommendations.push('Consider harvesting more content before generating the outline');
  }

  // Moderate gaps
  const moderateGaps = research.coverageGaps.filter(g => g.severity === 'moderate');
  for (const gap of moderateGaps.slice(0, 2)) {
    recommendations.push(`📝 ${gap.suggestedAction}`);
  }

  // Celebrate strengths
  if (research.strongAreas.length > 0) {
    recommendations.push(`✅ ${research.strongAreas[0]}`);
  }

  // Theme balance
  const weakThemes = research.themes.filter(t => t.strength < 0.4);
  if (weakThemes.length > research.themes.length / 2) {
    recommendations.push('Many themes have limited coverage - consider focusing on fewer topics');
  }

  return recommendations.slice(0, 5);
}

/**
 * Quantum Analysis Routes
 *
 * Local API endpoints for quantum reading analysis.
 */

import { Router, Request, Response } from 'express';
import {
  startQuantumSession,
  getQuantumSession,
  stepQuantumSession,
  deleteQuantumSession,
} from '../services/quantum';

export function createQuantumRouter(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'quantum-analysis',
      version: 'local',
    });
  });

  /**
   * POST /quantum-analysis/start
   *
   * Initialize a quantum reading session
   */
  router.post('/start', (req: Request, res: Response) => {
    try {
      const { text } = req.body;

      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ error: 'Text is required and must be non-empty' });
      }

      if (text.length < 50) {
        return res.status(400).json({ error: 'Text too short (minimum 50 characters)' });
      }

      if (text.length > 50000) {
        return res.status(400).json({ error: 'Text too long (maximum 50,000 characters)' });
      }

      const session = startQuantumSession(text);

      res.status(201).json({
        session_id: session.sessionId,
        total_sentences: session.totalSentences,
        sentences: session.sentences,
        initial_rho: {
          purity: session.initialRho.purity,
          entropy: session.initialRho.entropy,
          top_eigenvalues: session.initialRho.eigenvalues,
        },
      });
    } catch (error) {
      console.error('[Quantum] Start error:', error);
      res.status(500).json({
        error: 'Failed to create session',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /quantum-analysis/:id/step
   *
   * Process the next sentence in the quantum reading session
   */
  router.post('/:id/step', async (req: Request, res: Response) => {
    try {
      const session = getQuantumSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (session.currentSentence >= session.totalSentences) {
        return res.status(400).json({ error: 'All sentences have been processed' });
      }

      const measurement = await stepQuantumSession(req.params.id);
      if (!measurement) {
        return res.status(500).json({ error: 'Failed to process step' });
      }

      const done = (measurement.sentenceIndex + 1) >= session.totalSentences;

      res.json({
        sentence_index: measurement.sentenceIndex,
        sentence: measurement.sentence,
        measurement: measurement.measurement,
        rho_before: {
          purity: measurement.rhoBefore.purity,
          entropy: measurement.rhoBefore.entropy,
          top_eigenvalues: measurement.rhoBefore.eigenvalues,
        },
        rho_after: {
          purity: measurement.rhoAfter.purity,
          entropy: measurement.rhoAfter.entropy,
          top_eigenvalues: measurement.rhoAfter.eigenvalues,
        },
        done,
        next_sentence_index: done ? null : measurement.sentenceIndex + 1,
      });
    } catch (error) {
      console.error('[Quantum] Step error:', error);
      res.status(500).json({ error: 'Failed to process step' });
    }
  });

  /**
   * GET /quantum-analysis/:id
   *
   * Get the current state of a quantum reading session
   */
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const session = getQuantumSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({
        session_id: session.sessionId,
        total_sentences: session.totalSentences,
        current_sentence: session.currentSentence,
        sentences: session.sentences,
        current_rho: {
          purity: session.currentRho.purity,
          entropy: session.currentRho.entropy,
          top_eigenvalues: session.currentRho.eigenvalues,
        },
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      });
    } catch (error) {
      console.error('[Quantum] Get error:', error);
      res.status(500).json({ error: 'Failed to get session' });
    }
  });

  /**
   * GET /quantum-analysis/:id/trace
   *
   * Get the full reading history with all measurements
   */
  router.get('/:id/trace', (req: Request, res: Response) => {
    try {
      const session = getQuantumSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const trace = session.measurements.map(m => ({
        sentence_index: m.sentenceIndex,
        sentence: m.sentence,
        measurement: m.measurement,
        rho: {
          purity: m.rhoAfter.purity,
          entropy: m.rhoAfter.entropy,
          top_eigenvalues: m.rhoAfter.eigenvalues,
        },
      }));

      res.json({
        session_id: session.sessionId,
        total_sentences: session.totalSentences,
        trace,
      });
    } catch (error) {
      console.error('[Quantum] Trace error:', error);
      res.status(500).json({ error: 'Failed to get trace' });
    }
  });

  /**
   * DELETE /quantum-analysis/:id
   *
   * Delete a quantum reading session
   */
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const deleted = deleteQuantumSession(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[Quantum] Delete error:', error);
      res.status(500).json({ error: 'Failed to delete session' });
    }
  });

  return router;
}

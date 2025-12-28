/**
 * Sessions Routes
 *
 * Local API endpoints for studio sessions.
 */

import { Router, Request, Response } from 'express';
import {
  createSession,
  listSessions,
  getSession,
  updateSession,
  deleteSession,
  renameSession,
  addBuffer,
  updateBuffer,
  removeBuffer,
  setActiveBuffer,
} from '../services/sessions';

export function createSessionsRouter(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'sessions' });
  });

  // List sessions
  router.get('/', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const sessions = listSessions('local', limit, offset);
      res.json(sessions);
    } catch (error) {
      console.error('[Sessions] List error:', error);
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  // Create session
  router.post('/', (req: Request, res: Response) => {
    try {
      const session = req.body;

      if (!session.name) {
        return res.status(400).json({ error: 'name is required' });
      }

      const created = createSession(session);
      res.status(201).json({ success: true, sessionId: created.sessionId });
    } catch (error) {
      console.error('[Sessions] Create error:', error);

      if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: 'Session already exists' });
      }

      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  // Get session
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const session = getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json(session);
    } catch (error) {
      console.error('[Sessions] Get error:', error);
      res.status(500).json({ error: 'Failed to get session' });
    }
  });

  // Update session
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const session = updateSession(req.params.id, req.body);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[Sessions] Update error:', error);
      res.status(500).json({ error: 'Failed to update session' });
    }
  });

  // Delete session
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const deleted = deleteSession(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[Sessions] Delete error:', error);
      res.status(500).json({ error: 'Failed to delete session' });
    }
  });

  // Rename session
  router.put('/:id/rename', (req: Request, res: Response) => {
    try {
      const { name } = req.body;

      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name is required' });
      }

      const session = renameSession(req.params.id, name);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({ success: true, session });
    } catch (error) {
      console.error('[Sessions] Rename error:', error);
      res.status(500).json({ error: 'Failed to rename session' });
    }
  });

  // ============================================================================
  // Buffer Operations
  // ============================================================================

  // Add buffer
  router.post('/:id/buffers', (req: Request, res: Response) => {
    try {
      const buffer = req.body;

      if (!buffer.bufferId) {
        return res.status(400).json({ error: 'bufferId is required' });
      }

      const session = addBuffer(req.params.id, buffer);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.status(201).json({ success: true, session });
    } catch (error) {
      console.error('[Sessions] Add buffer error:', error);
      res.status(500).json({ error: 'Failed to add buffer' });
    }
  });

  // Update buffer
  router.put('/:id/buffers/:bufferId', (req: Request, res: Response) => {
    try {
      const session = updateBuffer(req.params.id, req.params.bufferId, req.body);
      if (!session) {
        return res.status(404).json({ error: 'Session or buffer not found' });
      }

      res.json({ success: true, session });
    } catch (error) {
      console.error('[Sessions] Update buffer error:', error);
      res.status(500).json({ error: 'Failed to update buffer' });
    }
  });

  // Remove buffer
  router.delete('/:id/buffers/:bufferId', (req: Request, res: Response) => {
    try {
      const session = removeBuffer(req.params.id, req.params.bufferId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({ success: true, session });
    } catch (error) {
      console.error('[Sessions] Remove buffer error:', error);
      res.status(500).json({ error: 'Failed to remove buffer' });
    }
  });

  // Set active buffer
  router.put('/:id/active-buffer', (req: Request, res: Response) => {
    try {
      const { bufferId } = req.body;

      if (!bufferId) {
        return res.status(400).json({ error: 'bufferId is required' });
      }

      const session = setActiveBuffer(req.params.id, bufferId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({ success: true, session });
    } catch (error) {
      console.error('[Sessions] Set active buffer error:', error);
      res.status(500).json({ error: 'Failed to set active buffer' });
    }
  });

  return router;
}

/**
 * Clusters API Routes
 */

import { Router, Request, Response } from 'express';
import { getDatabase, generateId, now, DbCluster } from '../database';
import { broadcastEvent } from '../server';

export function createClustersRouter(): Router {
  const router = Router();

  // GET /api/clusters?bookId=xxx - List clusters for a book
  router.get('/', (req: Request, res: Response) => {
    try {
      const { bookId } = req.query;

      if (!bookId) {
        return res.status(400).json({ error: 'bookId is required' });
      }

      const db = getDatabase();
      const clusters = db.prepare(`
        SELECT * FROM clusters WHERE book_id = ? ORDER BY created_at ASC
      `).all(bookId) as DbCluster[];

      res.json({ clusters: clusters.map(parseClusterJsonFields) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/clusters/:id - Get a single cluster
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(req.params.id) as DbCluster | undefined;

      if (!cluster) {
        return res.status(404).json({ error: 'Cluster not found' });
      }

      res.json({ cluster: parseClusterJsonFields(cluster) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/clusters - Create a new cluster
  router.post('/', (req: Request, res: Response) => {
    try {
      const { bookId, name, cardIds = [], locked = false, seedCardId, centroid } = req.body;

      if (!bookId || !name) {
        return res.status(400).json({ error: 'bookId and name are required' });
      }

      const db = getDatabase();

      // Verify book exists
      const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const id = generateId();
      const timestamp = now();

      db.prepare(`
        INSERT INTO clusters (id, book_id, name, card_ids, locked, seed_card_id, centroid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, bookId, name, JSON.stringify(cardIds), locked ? 1 : 0,
        seedCardId || null, centroid ? JSON.stringify(centroid) : null,
        timestamp, timestamp
      );

      const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(id) as DbCluster;

      // Broadcast event
      broadcastEvent({
        type: 'cluster-created',
        bookId,
        entityType: 'cluster',
        entityId: id,
        payload: parseClusterJsonFields(cluster),
        timestamp: Date.now(),
      });

      res.status(201).json({ cluster: parseClusterJsonFields(cluster) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // PATCH /api/clusters/:id - Update a cluster
  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const db = getDatabase();

      const existing = db.prepare('SELECT * FROM clusters WHERE id = ?').get(req.params.id) as DbCluster | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Cluster not found' });
      }

      const { name, cardIds, locked, seedCardId, centroid } = req.body;

      const updates: string[] = ['updated_at = ?'];
      const values: (string | number | null)[] = [now()];

      if (name !== undefined) {
        updates.push('name = ?');
        values.push(name);
      }
      if (cardIds !== undefined) {
        updates.push('card_ids = ?');
        values.push(JSON.stringify(cardIds));
      }
      if (locked !== undefined) {
        updates.push('locked = ?');
        values.push(locked ? 1 : 0);
      }
      if (seedCardId !== undefined) {
        updates.push('seed_card_id = ?');
        values.push(seedCardId);
      }
      if (centroid !== undefined) {
        updates.push('centroid = ?');
        values.push(centroid ? JSON.stringify(centroid) : null);
      }

      values.push(req.params.id);

      db.prepare(`
        UPDATE clusters SET ${updates.join(', ')} WHERE id = ?
      `).run(...values);

      const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(req.params.id) as DbCluster;

      // Broadcast event
      broadcastEvent({
        type: 'cluster-updated',
        bookId: existing.book_id,
        entityType: 'cluster',
        entityId: req.params.id,
        payload: parseClusterJsonFields(cluster),
        timestamp: Date.now(),
      });

      res.json({ cluster: parseClusterJsonFields(cluster) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/clusters/:id/add-card - Add a card to cluster
  router.post('/:id/add-card', (req: Request, res: Response) => {
    try {
      const { cardId } = req.body;
      const db = getDatabase();

      const existing = db.prepare('SELECT * FROM clusters WHERE id = ?').get(req.params.id) as DbCluster | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Cluster not found' });
      }

      const cardIds = JSON.parse(existing.card_ids || '[]') as string[];
      if (!cardIds.includes(cardId)) {
        cardIds.push(cardId);
      }

      const timestamp = now();
      db.prepare(`
        UPDATE clusters SET card_ids = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(cardIds), timestamp, req.params.id);

      const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(req.params.id) as DbCluster;

      // Broadcast event
      broadcastEvent({
        type: 'cluster-card-added',
        bookId: existing.book_id,
        entityType: 'cluster',
        entityId: req.params.id,
        payload: { cardId, cluster: parseClusterJsonFields(cluster) },
        timestamp: Date.now(),
      });

      res.json({ cluster: parseClusterJsonFields(cluster) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/clusters/:id/remove-card - Remove a card from cluster
  router.post('/:id/remove-card', (req: Request, res: Response) => {
    try {
      const { cardId } = req.body;
      const db = getDatabase();

      const existing = db.prepare('SELECT * FROM clusters WHERE id = ?').get(req.params.id) as DbCluster | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Cluster not found' });
      }

      const cardIds = JSON.parse(existing.card_ids || '[]') as string[];
      const index = cardIds.indexOf(cardId);
      if (index > -1) {
        cardIds.splice(index, 1);
      }

      const timestamp = now();
      db.prepare(`
        UPDATE clusters SET card_ids = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(cardIds), timestamp, req.params.id);

      const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(req.params.id) as DbCluster;

      // Broadcast event
      broadcastEvent({
        type: 'cluster-card-removed',
        bookId: existing.book_id,
        entityType: 'cluster',
        entityId: req.params.id,
        payload: { cardId, cluster: parseClusterJsonFields(cluster) },
        timestamp: Date.now(),
      });

      res.json({ cluster: parseClusterJsonFields(cluster) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // DELETE /api/clusters/:id - Delete a cluster
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const db = getDatabase();

      const existing = db.prepare('SELECT * FROM clusters WHERE id = ?').get(req.params.id) as DbCluster | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Cluster not found' });
      }

      db.prepare('DELETE FROM clusters WHERE id = ?').run(req.params.id);

      // Broadcast event
      broadcastEvent({
        type: 'cluster-deleted',
        bookId: existing.book_id,
        entityType: 'cluster',
        entityId: req.params.id,
        timestamp: Date.now(),
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

// Helper to parse JSON fields
function parseClusterJsonFields(cluster: DbCluster): Record<string, unknown> {
  return {
    ...cluster,
    cardIds: JSON.parse(cluster.card_ids || '[]'),
    centroid: cluster.centroid ? JSON.parse(cluster.centroid) : null,
    locked: Boolean(cluster.locked),
  };
}

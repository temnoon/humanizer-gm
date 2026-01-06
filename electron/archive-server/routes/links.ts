/**
 * Links Router - Xanadu-style bidirectional link traversal
 *
 * Routes:
 * - GET /api/links - Get links for a URI (bidirectional)
 * - GET /api/content/resolve/:uri - Resolve content by URI
 * - POST /api/links - Create a new link
 * - DELETE /api/links/:id - Delete a link
 *
 * Implements Xanadu principles:
 * - Bidirectional traversal (find links where URI is source OR target)
 * - Link types: parent, child, reference, transclusion, similar, follows, responds_to
 * - Content addressing via stable URIs
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getEmbeddingDatabase } from '../services/registry';
import type { LinkType, LinkCreator } from '../services/embeddings/types';

interface LinkRow {
  id: string;
  source_uri: string;
  target_uri: string;
  link_type: string;
  link_strength: number | null;
  source_start: number | null;
  source_end: number | null;
  target_start: number | null;
  target_end: number | null;
  label: string | null;
  created_at: number;
  created_by: string | null;
  metadata: string | null;
}

interface ContentItemRow {
  id: string;
  type: string;
  source: string;
  text: string | null;
  title: string | null;
  created_at: number;
  updated_at: number | null;
  author_name: string | null;
  is_own_content: number;
  uri: string | null;
  metadata: string | null;
}

export function createLinksRouter(): Router {
  const router = Router();

  /**
   * GET /api/links
   * Get links for a URI (bidirectional traversal)
   *
   * Query params:
   * - uri: The content URI to find links for (required)
   * - direction: 'outgoing' | 'incoming' | 'both' (default: 'both')
   * - type: Filter by link type
   * - limit: Max results (default: 100)
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { uri, direction = 'both', type, limit = '100' } = req.query;

      if (!uri) {
        return res.status(400).json({ error: 'uri parameter required' });
      }

      const db = getEmbeddingDatabase();
      const rawDb = db.getRawDb();

      let query: string;
      const params: unknown[] = [];

      if (direction === 'outgoing') {
        query = `SELECT * FROM links WHERE source_uri = ?`;
        params.push(uri);
      } else if (direction === 'incoming') {
        query = `SELECT * FROM links WHERE target_uri = ?`;
        params.push(uri);
      } else {
        // Both directions
        query = `SELECT * FROM links WHERE source_uri = ? OR target_uri = ?`;
        params.push(uri, uri);
      }

      if (type) {
        query += ` AND link_type = ?`;
        params.push(type);
      }

      query += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(parseInt(limit as string));

      const links = rawDb.prepare(query).all(...params) as LinkRow[];

      // Format response
      const formatted = links.map(link => ({
        id: link.id,
        sourceUri: link.source_uri,
        targetUri: link.target_uri,
        linkType: link.link_type,
        linkStrength: link.link_strength,
        sourceSpan: link.source_start != null ? {
          start: link.source_start,
          end: link.source_end
        } : null,
        targetSpan: link.target_start != null ? {
          start: link.target_start,
          end: link.target_end
        } : null,
        label: link.label,
        createdAt: link.created_at,
        createdBy: link.created_by,
        metadata: link.metadata ? JSON.parse(link.metadata) : null,
        // Direction relative to requested URI
        direction: link.source_uri === uri ? 'outgoing' : 'incoming',
      }));

      res.json({
        uri,
        links: formatted,
        count: formatted.length,
      });

    } catch (err) {
      console.error('[links] Error fetching links:', err);
      res.status(500).json({ error: 'Failed to fetch links' });
    }
  });

  /**
   * GET /api/links/resolve/:uri
   * Resolve content by URI
   *
   * URI patterns:
   * - content://openai/conversation/{id}
   * - content://openai/message/{id}
   * - content://facebook/post/{id}
   * - media://sha256/{hash}
   */
  router.get('/resolve/*', async (req: Request, res: Response) => {
    try {
      // Get full URI from path (everything after /resolve/)
      const uri = decodeURIComponent(req.params[0] || '');

      if (!uri) {
        return res.status(400).json({ error: 'URI required' });
      }

      const db = getEmbeddingDatabase();
      const rawDb = db.getRawDb();

      // Try to find content by URI
      let content = rawDb.prepare(
        'SELECT * FROM content_items WHERE uri = ?'
      ).get(uri) as ContentItemRow | undefined;

      // If not found by URI, try extracting ID and searching by ID
      if (!content) {
        const idMatch = uri.match(/\/([^\/]+)$/);
        if (idMatch) {
          const id = idMatch[1];
          content = rawDb.prepare(
            'SELECT * FROM content_items WHERE id = ?'
          ).get(id) as ContentItemRow | undefined;
        }
      }

      if (!content) {
        return res.status(404).json({ error: 'Content not found', uri });
      }

      // Get links for this content
      const links = rawDb.prepare(
        'SELECT * FROM links WHERE source_uri = ? OR target_uri = ? LIMIT 50'
      ).all(uri, uri) as LinkRow[];

      res.json({
        uri: content.uri || uri,
        content: {
          id: content.id,
          type: content.type,
          source: content.source,
          text: content.text,
          title: content.title,
          createdAt: content.created_at,
          updatedAt: content.updated_at,
          authorName: content.author_name,
          isOwnContent: content.is_own_content === 1,
          metadata: content.metadata ? JSON.parse(content.metadata) : null,
        },
        links: links.map(link => ({
          id: link.id,
          sourceUri: link.source_uri,
          targetUri: link.target_uri,
          linkType: link.link_type,
          direction: link.source_uri === uri ? 'outgoing' : 'incoming',
        })),
      });

    } catch (err) {
      console.error('[links] Error resolving URI:', err);
      res.status(500).json({ error: 'Failed to resolve URI' });
    }
  });

  /**
   * POST /api/links
   * Create a new link between content items
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const {
        sourceUri,
        targetUri,
        linkType,
        linkStrength = 1.0,
        sourceSpan,
        targetSpan,
        label,
        createdBy = 'user',
        metadata,
      } = req.body;

      if (!sourceUri || !targetUri || !linkType) {
        return res.status(400).json({
          error: 'sourceUri, targetUri, and linkType are required'
        });
      }

      // Validate link type
      const validTypes: LinkType[] = [
        'parent', 'child', 'reference', 'transclusion',
        'similar', 'follows', 'responds_to', 'version_of'
      ];
      if (!validTypes.includes(linkType)) {
        return res.status(400).json({
          error: `Invalid linkType. Must be one of: ${validTypes.join(', ')}`
        });
      }

      const db = getEmbeddingDatabase();
      const rawDb = db.getRawDb();

      const id = uuidv4();
      const now = Date.now();

      rawDb.prepare(`
        INSERT INTO links
        (id, source_uri, target_uri, link_type, link_strength,
         source_start, source_end, target_start, target_end,
         label, created_at, created_by, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        sourceUri,
        targetUri,
        linkType,
        linkStrength,
        sourceSpan?.start ?? null,
        sourceSpan?.end ?? null,
        targetSpan?.start ?? null,
        targetSpan?.end ?? null,
        label ?? null,
        now,
        createdBy,
        metadata ? JSON.stringify(metadata) : null
      );

      res.status(201).json({
        id,
        sourceUri,
        targetUri,
        linkType,
        linkStrength,
        createdAt: now,
        createdBy,
      });

    } catch (err) {
      console.error('[links] Error creating link:', err);
      res.status(500).json({ error: 'Failed to create link' });
    }
  });

  /**
   * DELETE /api/links/:id
   * Delete a link
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const db = getEmbeddingDatabase();
      const rawDb = db.getRawDb();

      const result = rawDb.prepare('DELETE FROM links WHERE id = ?').run(id);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Link not found' });
      }

      res.json({ deleted: true, id });

    } catch (err) {
      console.error('[links] Error deleting link:', err);
      res.status(500).json({ error: 'Failed to delete link' });
    }
  });

  /**
   * GET /api/links/graph
   * Get a subgraph of links starting from a URI
   *
   * Query params:
   * - uri: Starting URI (required)
   * - depth: How many hops to traverse (default: 2)
   * - types: Comma-separated list of link types to follow
   */
  router.get('/graph', async (req: Request, res: Response) => {
    try {
      const { uri, depth = '2', types } = req.query;

      if (!uri) {
        return res.status(400).json({ error: 'uri parameter required' });
      }

      const maxDepth = Math.min(parseInt(depth as string), 5); // Cap at 5 hops
      const typeFilter = types ? (types as string).split(',') : null;

      const db = getEmbeddingDatabase();
      const rawDb = db.getRawDb();

      // BFS to collect subgraph
      const visited = new Set<string>();
      const nodes: Array<{ uri: string; depth: number }> = [];
      const edges: Array<{
        source: string;
        target: string;
        type: string;
        strength: number | null;
      }> = [];

      const queue: Array<{ uri: string; currentDepth: number }> = [
        { uri: uri as string, currentDepth: 0 }
      ];

      while (queue.length > 0) {
        const { uri: currentUri, currentDepth } = queue.shift()!;

        if (visited.has(currentUri) || currentDepth > maxDepth) {
          continue;
        }

        visited.add(currentUri);
        nodes.push({ uri: currentUri, depth: currentDepth });

        // Get links from this node
        let query = 'SELECT * FROM links WHERE source_uri = ? OR target_uri = ?';
        const params: unknown[] = [currentUri, currentUri];

        if (typeFilter) {
          const placeholders = typeFilter.map(() => '?').join(',');
          query += ` AND link_type IN (${placeholders})`;
          params.push(...typeFilter);
        }

        const links = rawDb.prepare(query).all(...params) as LinkRow[];

        for (const link of links) {
          edges.push({
            source: link.source_uri,
            target: link.target_uri,
            type: link.link_type,
            strength: link.link_strength,
          });

          // Queue connected nodes
          const connectedUri = link.source_uri === currentUri
            ? link.target_uri
            : link.source_uri;

          if (!visited.has(connectedUri) && currentDepth < maxDepth) {
            queue.push({ uri: connectedUri, currentDepth: currentDepth + 1 });
          }
        }
      }

      res.json({
        rootUri: uri,
        depth: maxDepth,
        nodes,
        edges,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      });

    } catch (err) {
      console.error('[links] Error fetching graph:', err);
      res.status(500).json({ error: 'Failed to fetch link graph' });
    }
  });

  return router;
}

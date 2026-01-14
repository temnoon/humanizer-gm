/**
 * Feed Routes - Time periods and notes
 * Routes: /periods, /notes/*
 */

import { Router, Request, Response } from 'express';
import { getEmbeddingDatabase } from '../../services/registry';

export function createFeedRouter(): Router {
  const router = Router();

  // Get time periods with activity
  router.get('/periods', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      // Query distinct periods from content_items
      const periods = db.getRawDb().prepare(`
        SELECT
          strftime('%Y', datetime(created_at, 'unixepoch')) as year,
          ((strftime('%m', datetime(created_at, 'unixepoch')) - 1) / 3 + 1) as quarter,
          COUNT(*) as count,
          MIN(created_at) as start_date,
          MAX(created_at) as end_date
        FROM content_items
        WHERE source = 'facebook'
        GROUP BY year, quarter
        ORDER BY year DESC, quarter DESC
      `).all();

      res.json({
        periods: periods.map((p: any) => ({
          period: `Q${p.quarter}_${p.year}`,
          year: parseInt(p.year),
          quarter: p.quarter,
          count: p.count,
          start_date: p.start_date,
          end_date: p.end_date,
        })),
      });
    } catch (err) {
      console.error('[facebook] Error getting periods:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ===========================================================================
  // Notes Routes
  // ===========================================================================

  // Notes statistics
  router.get('/notes/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();

      const total = (db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM fb_notes
      `).get() as { count: number }).count;

      const wordStats = db.getRawDb().prepare(`
        SELECT
          SUM(word_count) as total_words,
          AVG(word_count) as avg_words,
          MAX(word_count) as max_words,
          MIN(word_count) as min_words
        FROM fb_notes
      `).get() as { total_words: number; avg_words: number; max_words: number; min_words: number };

      const longest = db.getRawDb().prepare(`
        SELECT id, title, word_count, created_timestamp
        FROM fb_notes
        ORDER BY word_count DESC
        LIMIT 5
      `).all() as any[];

      const dateRange = db.getRawDb().prepare(`
        SELECT MIN(created_timestamp) as earliest, MAX(created_timestamp) as latest
        FROM fb_notes
        WHERE created_timestamp > 1000
      `).get() as { earliest: number | null; latest: number | null };

      const withMedia = (db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM fb_notes WHERE has_media = 1
      `).get() as { count: number }).count;

      res.json({
        total,
        totalWords: wordStats?.total_words || 0,
        averageWords: Math.round(wordStats?.avg_words || 0),
        maxWords: wordStats?.max_words || 0,
        minWords: wordStats?.min_words || 0,
        withMedia,
        longestNotes: longest.map((n: any) => ({
          id: n.id,
          title: n.title,
          wordCount: n.word_count,
          date: n.created_timestamp ? new Date(n.created_timestamp * 1000).toISOString() : null,
        })),
        dateRange: {
          earliest: dateRange?.earliest,
          latest: dateRange?.latest,
          earliestDate: dateRange?.earliest ? new Date(dateRange.earliest * 1000).toISOString() : null,
          latestDate: dateRange?.latest ? new Date(dateRange.latest * 1000).toISOString() : null,
        },
      });
    } catch (err) {
      console.error('[facebook] Error getting notes stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List notes
  router.get('/notes', async (req: Request, res: Response) => {
    try {
      const {
        limit = '50',
        offset = '0',
        sortBy = 'created_timestamp',
        search,
        minWords,
        maxWords,
      } = req.query;
      const db = getEmbeddingDatabase();

      let sql = `SELECT id, title, word_count, char_count, created_timestamp, updated_timestamp, has_media, media_count, tags FROM fb_notes WHERE 1=1`;
      const params: unknown[] = [];

      if (search) {
        sql += ` AND (title LIKE ? OR text LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
      }

      if (minWords) {
        sql += ` AND word_count >= ?`;
        params.push(parseInt(minWords as string));
      }

      if (maxWords) {
        sql += ` AND word_count <= ?`;
        params.push(parseInt(maxWords as string));
      }

      const validSortFields = ['created_timestamp', 'word_count', 'title'];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'created_timestamp';
      sql += ` ORDER BY ${sortField} DESC`;
      sql += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit as string), parseInt(offset as string));

      const notes = db.getRawDb().prepare(sql).all(...params);

      res.json({
        notes: notes.map((n: any) => ({
          id: n.id,
          title: n.title,
          wordCount: n.word_count,
          charCount: n.char_count,
          createdTimestamp: n.created_timestamp,
          updatedTimestamp: n.updated_timestamp,
          hasMedia: n.has_media === 1,
          mediaCount: n.media_count,
          tags: n.tags ? JSON.parse(n.tags) : [],
          date: n.created_timestamp ? new Date(n.created_timestamp * 1000).toISOString() : null,
        })),
      });
    } catch (err) {
      console.error('[facebook] Error listing notes:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Search notes by text content (must come before :id route)
  router.get('/notes/search', async (req: Request, res: Response) => {
    try {
      const { q, limit = '20' } = req.query;
      if (!q) {
        res.status(400).json({ error: 'Query parameter q required' });
        return;
      }

      const db = getEmbeddingDatabase();

      const notes = db.getRawDb().prepare(`
        SELECT id, title, word_count, created_timestamp,
               substr(text, max(1, instr(lower(text), lower(?)) - 50), 200) as excerpt
        FROM fb_notes
        WHERE title LIKE ? OR text LIKE ?
        ORDER BY word_count DESC
        LIMIT ?
      `).all(q, `%${q}%`, `%${q}%`, parseInt(limit as string)) as any[];

      res.json({
        query: q,
        count: notes.length,
        results: notes.map((n: any) => ({
          id: n.id,
          title: n.title,
          wordCount: n.word_count,
          date: n.created_timestamp ? new Date(n.created_timestamp * 1000).toISOString() : null,
          excerpt: n.excerpt ? `...${n.excerpt}...` : null,
        })),
      });
    } catch (err) {
      console.error('[facebook] Error searching notes:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Semantic search notes (must come before :id route)
  router.get('/notes/semantic-search', async (req: Request, res: Response) => {
    try {
      const { q, limit = '10' } = req.query;
      if (!q) {
        res.status(400).json({ error: 'Query parameter q required' });
        return;
      }

      const db = getEmbeddingDatabase();
      const { embed } = await import('../../services/embeddings/EmbeddingGenerator.js');

      // Generate query embedding
      const queryEmbedding = await embed(q as string);

      // Search for similar notes
      const results = db.searchContentItems(
        queryEmbedding,
        parseInt(limit as string),
        'note',
        'facebook'
      );

      // Get full note data for results
      const notes = results.map(result => {
        const note = db.getRawDb().prepare(`
          SELECT n.id, n.title, n.word_count, n.created_timestamp,
                 substr(n.text, 1, 300) as excerpt
          FROM fb_notes n
          WHERE n.content_item_id = ?
        `).get(result.content_item_id) as any;

        return {
          id: note?.id,
          title: note?.title,
          wordCount: note?.word_count,
          date: note?.created_timestamp ? new Date(note.created_timestamp * 1000).toISOString() : null,
          excerpt: note?.excerpt ? note.excerpt + '...' : null,
          similarity: 1 - result.distance,  // Convert distance to similarity
        };
      }).filter(n => n.id);  // Filter out any null results

      res.json({
        query: q,
        count: notes.length,
        results: notes,
      });
    } catch (err) {
      console.error('[facebook] Error in semantic search:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get a specific note with full text
  router.get('/notes/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getEmbeddingDatabase();

      const note = db.getRawDb().prepare(`
        SELECT * FROM fb_notes WHERE id = ?
      `).get(id) as any;

      if (!note) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }

      res.json({
        id: note.id,
        title: note.title,
        text: note.text,
        wordCount: note.word_count,
        charCount: note.char_count,
        createdTimestamp: note.created_timestamp,
        updatedTimestamp: note.updated_timestamp,
        hasMedia: note.has_media === 1,
        mediaCount: note.media_count,
        mediaPaths: note.media_paths ? JSON.parse(note.media_paths) : [],
        tags: note.tags ? JSON.parse(note.tags) : [],
        date: note.created_timestamp ? new Date(note.created_timestamp * 1000).toISOString() : null,
        updatedDate: note.updated_timestamp ? new Date(note.updated_timestamp * 1000).toISOString() : null,
      });
    } catch (err) {
      console.error('[facebook] Error getting note:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Import notes from Facebook export
  router.post('/notes/import', async (req: Request, res: Response) => {
    try {
      const { exportPath } = req.body;

      if (!exportPath) {
        res.status(400).json({ error: 'exportPath required' });
        return;
      }

      const { NotesParser } = await import('../../services/facebook/NotesParser.js');
      const parser = new NotesParser();

      console.log(`[facebook] Importing notes from: ${exportPath}`);

      const result = await parser.parse(exportPath);
      const db = getEmbeddingDatabase();
      const now = Date.now() / 1000;

      let inserted = 0;

      const insertStmt = db.getRawDb().prepare(`
        INSERT OR REPLACE INTO fb_notes
        (id, title, text, word_count, char_count, created_timestamp, updated_timestamp,
         has_media, media_count, media_paths, tags, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const note of result.notes) {
        insertStmt.run(
          note.id,
          note.title,
          note.text,
          note.wordCount,
          note.charCount,
          note.createdTimestamp,
          note.updatedTimestamp,
          note.hasMedia ? 1 : 0,
          note.mediaCount,
          JSON.stringify(note.mediaPaths),
          JSON.stringify(note.tags),
          now
        );
        inserted++;
      }

      console.log(`[facebook] Notes import complete: ${inserted} notes`);

      res.json({
        success: true,
        imported: inserted,
        stats: result.stats,
      });
    } catch (err) {
      console.error('[facebook] Error importing notes:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Embed notes for semantic search (with chunking for long content)
  router.post('/notes/embed', async (req: Request, res: Response) => {
    try {
      const { batchSize = 5, forceReembed = false } = req.body;
      const db = getEmbeddingDatabase();

      // Get notes: either all without embeddings, or all if force re-embed
      const notes = db.getRawDb().prepare(
        forceReembed
          ? `SELECT id, title, text, word_count, created_timestamp FROM fb_notes ORDER BY word_count DESC`
          : `SELECT n.id, n.title, n.text, n.word_count, n.created_timestamp
             FROM fb_notes n
             WHERE n.content_item_id IS NULL
             ORDER BY n.word_count DESC`
      ).all() as Array<{
        id: string;
        title: string;
        text: string;
        word_count: number;
        created_timestamp: number;
      }>;

      if (notes.length === 0) {
        const existingCount = (db.getRawDb().prepare(`
          SELECT COUNT(*) as count FROM content_items WHERE type = 'note' AND source = 'facebook'
        `).get() as { count: number }).count;

        res.json({
          success: true,
          message: existingCount > 0 ? 'Notes already embedded' : 'No notes to embed',
          embedded: 0,
          existingCount,
        });
        return;
      }

      console.log(`[facebook] Embedding ${notes.length} notes...`);

      // Dynamically import embedding generator and chunker
      const { embed } = await import('../../services/embeddings/EmbeddingGenerator.js');
      const { ContentChunker } = await import('../../services/embeddings/ContentChunker.js');

      const chunker = new ContentChunker({
        targetProseWords: 400,  // ~1600 chars, well under 24K limit
        maxChunkWords: 800,
        idPrefix: 'note_chunk',
      });

      // Threshold for chunking: ~1000 words (about 4K chars, safe for 8K token context)
      const CHUNK_THRESHOLD_WORDS = 1000;

      const now = Date.now() / 1000;
      let embedded = 0;
      let failed = 0;
      let chunkedNotes = 0;
      let totalChunks = 0;

      // Process in batches
      for (let i = 0; i < notes.length; i += batchSize) {
        const batch = notes.slice(i, i + batchSize);
        console.log(`[facebook] Processing notes ${i + 1}-${Math.min(i + batchSize, notes.length)} of ${notes.length}`);

        for (const note of batch) {
          try {
            const contentItemId = `fb_note_content_${note.id}`;
            const embeddingText = `${note.title}\n\n${note.text}`;

            // Decide chunking strategy based on length
            const needsChunking = note.word_count > CHUNK_THRESHOLD_WORDS;
            let embedding: number[];

            if (needsChunking) {
              // Chunk the note and embed each chunk
              const chunks = chunker.chunk(embeddingText);
              console.log(`   📄 ${note.title.substring(0, 30)}... (${note.word_count} words → ${chunks.length} chunks)`);

              const chunkEmbeddings: number[][] = [];

              for (let ci = 0; ci < chunks.length; ci++) {
                const chunk = chunks[ci];
                const chunkEmbedding = await embed(chunk.content);
                chunkEmbeddings.push(chunkEmbedding);

                // Store each chunk embedding
                const chunkId = `${contentItemId}_chunk_${ci}`;
                db.insertContentItemEmbedding(
                  `emb_${chunkId}`,
                  contentItemId,  // Link to parent
                  'note_chunk',
                  'facebook',
                  chunkEmbedding
                );
              }

              // Aggregate: mean pooling of chunk embeddings
              const dim = chunkEmbeddings[0].length;
              embedding = new Array(dim).fill(0);
              for (const chunkEmb of chunkEmbeddings) {
                for (let d = 0; d < dim; d++) {
                  embedding[d] += chunkEmb[d] / chunkEmbeddings.length;
                }
              }

              chunkedNotes++;
              totalChunks += chunks.length;
            } else {
              // Direct embedding for shorter notes
              embedding = await embed(embeddingText);
              console.log(`   ✓ ${note.title.substring(0, 40)}... (${note.word_count} words)`);
            }

            // Create content_item entry
            db.insertContentItem({
              id: contentItemId,
              type: 'note',
              source: 'facebook',
              text: note.text,
              title: note.title,
              created_at: note.created_timestamp,
              is_own_content: true,
              context: JSON.stringify({
                noteId: note.id,
                wordCount: note.word_count,
                chunked: needsChunking,
                chunkCount: needsChunking ? totalChunks - (chunkedNotes - 1) * 0 : 0,
              }),
            });

            // Insert aggregate/direct embedding for the note itself
            db.insertContentItemEmbedding(
              `emb_${contentItemId}`,
              contentItemId,
              'note',
              'facebook',
              embedding
            );

            // Link note to content_item
            db.getRawDb().prepare(`
              UPDATE fb_notes SET content_item_id = ? WHERE id = ?
            `).run(contentItemId, note.id);

            embedded++;
          } catch (err) {
            failed++;
            console.error(`   ✗ Failed: ${note.title.substring(0, 40)}...`, err);
          }
        }
      }

      console.log(`[facebook] Notes embedding complete: ${embedded} embedded, ${failed} failed`);
      if (chunkedNotes > 0) {
        console.log(`   Chunked ${chunkedNotes} long notes into ${totalChunks} chunks`);
      }

      res.json({
        success: true,
        embedded,
        failed,
        total: notes.length,
        chunkedNotes,
        totalChunks,
      });
    } catch (err) {
      console.error('[facebook] Error embedding notes:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

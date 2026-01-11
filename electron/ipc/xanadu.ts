/**
 * Xanadu Unified Storage IPC Handlers
 *
 * Handles all book, persona, style, passage, chapter, harvest bucket,
 * narrative arc, and analysis operations via Electron IPC.
 */

import { ipcMain, BrowserWindow } from 'electron';
import {
  getEmbeddingDatabase,
  areServicesInitialized,
  waitForServices,
  getArchiveRoot,
} from '../archive-server';

// Type for the embedding database
type EmbeddingDatabase = ReturnType<typeof getEmbeddingDatabase>;

/**
 * Ensure database is ready before operations
 */
function ensureDb(): EmbeddingDatabase {
  if (!areServicesInitialized()) {
    throw new Error('Archive services not initialized. Start archive server first.');
  }
  return getEmbeddingDatabase();
}

/**
 * Helper: Find and remove a passage from any array, return it
 */
function findAndRemovePassage(
  bucket: Record<string, unknown>,
  passageId: string
): { passage: Record<string, unknown> | null; fromArray: string | null } {
  const arrays = ['candidates', 'approved', 'gems', 'rejected'] as const;
  for (const arrayName of arrays) {
    const arr = bucket[arrayName] as Record<string, unknown>[];
    if (!arr) continue;
    const index = arr.findIndex((p) => p.id === passageId);
    if (index !== -1) {
      const [passage] = arr.splice(index, 1);
      return { passage, fromArray: arrayName };
    }
  }
  return { passage: null, fromArray: null };
}

/**
 * Register all Xanadu IPC handlers
 * @param getMainWindow - Function to get the current main window (for events)
 */
export function registerXanaduHandlers(getMainWindow: () => BrowserWindow | null) {
  // ─────────────────────────────────────────────────────────────────
  // BOOK OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:book:list', (_e, includeLibrary = true) => {
    const db = ensureDb();
    return db.getAllBooks(includeLibrary);
  });

  ipcMain.handle('xanadu:book:get', (_e, idOrUri: string) => {
    const db = ensureDb();
    return db.getBook(idOrUri);
  });

  ipcMain.handle('xanadu:book:upsert', (_e, book: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertBook(book as Parameters<typeof db.upsertBook>[0]);
    return { success: true, id: book.id };
  });

  ipcMain.handle('xanadu:book:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deleteBook(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // PERSONA OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:persona:list', (_e, includeLibrary = true) => {
    const db = ensureDb();
    return db.getAllPersonas(includeLibrary);
  });

  ipcMain.handle('xanadu:persona:get', (_e, idOrUri: string) => {
    const db = ensureDb();
    return db.getPersona(idOrUri);
  });

  ipcMain.handle('xanadu:persona:upsert', (_e, persona: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertPersona(persona as Parameters<typeof db.upsertPersona>[0]);
    return { success: true, id: persona.id };
  });

  ipcMain.handle('xanadu:persona:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deletePersona(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // STYLE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:style:list', (_e, includeLibrary = true) => {
    const db = ensureDb();
    return db.getAllStyles(includeLibrary);
  });

  ipcMain.handle('xanadu:style:get', (_e, idOrUri: string) => {
    const db = ensureDb();
    return db.getStyle(idOrUri);
  });

  ipcMain.handle('xanadu:style:upsert', (_e, style: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertStyle(style as Parameters<typeof db.upsertStyle>[0]);
    return { success: true, id: style.id };
  });

  ipcMain.handle('xanadu:style:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deleteStyle(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // PASSAGE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:passage:list', (_e, bookId: string, curationStatus?: string) => {
    const db = ensureDb();
    return db.getBookPassages(bookId, curationStatus);
  });

  ipcMain.handle('xanadu:passage:upsert', (_e, passage: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertBookPassage(passage as Parameters<typeof db.upsertBookPassage>[0]);
    return { success: true, id: passage.id };
  });

  ipcMain.handle('xanadu:passage:curate', (_e, id: string, status: string, note?: string) => {
    const db = ensureDb();
    db.updatePassageCuration(id, status, note);
    return { success: true };
  });

  ipcMain.handle('xanadu:passage:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deleteBookPassage(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // CHAPTER OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:chapter:list', (_e, bookId: string) => {
    const db = ensureDb();
    return db.getBookChapters(bookId);
  });

  ipcMain.handle('xanadu:chapter:get', (_e, id: string) => {
    const db = ensureDb();
    return db.getBookChapter(id);
  });

  ipcMain.handle('xanadu:chapter:upsert', (_e, chapter: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertBookChapter(chapter as Parameters<typeof db.upsertBookChapter>[0]);
    return { success: true, id: chapter.id };
  });

  ipcMain.handle('xanadu:chapter:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deleteBookChapter(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // CHAPTER VERSION OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:version:list', (_e, chapterId: string) => {
    const db = ensureDb();
    return db.getChapterVersions(chapterId);
  });

  ipcMain.handle('xanadu:version:save', (
    _e,
    chapterId: string,
    version: number,
    content: string,
    changes?: string,
    createdBy?: string
  ) => {
    const db = ensureDb();
    db.saveChapterVersion(chapterId, version, content, changes, createdBy);
    return { success: true };
  });

  // Fill chapter with generated content
  ipcMain.handle(
    'xanadu:chapter:fill',
    async (_e, chapterId: string, bookId: string, options?: Record<string, unknown>) => {
      if (!areServicesInitialized()) {
        return { success: false, error: 'Archive services not initialized. Start archive server first.' };
      }
      const archivePath = getArchiveRoot();
      const { fillChapter } = await import('../services/chapter-filler.js');
      return fillChapter(chapterId, bookId, archivePath, options);
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // HARVEST BUCKET OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:harvest-bucket:list', (_e, bookUri?: string) => {
    const db = ensureDb();
    if (bookUri) {
      return db.getHarvestBucketsForBook(bookUri);
    }
    return db.getAllHarvestBuckets();
  });

  ipcMain.handle('xanadu:harvest-bucket:get', (_e, id: string) => {
    const db = ensureDb();
    return db.getHarvestBucket(id);
  });

  ipcMain.handle('xanadu:harvest-bucket:upsert', (_e, bucket: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
    return { success: true, id: bucket.id };
  });

  ipcMain.handle('xanadu:harvest-bucket:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deleteHarvestBucket(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // HARVEST CURATION OPERATIONS (atomic passage moves + lifecycle)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:harvest:approve-passage', (_e, bucketId: string, passageId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      const { passage, fromArray } = findAndRemovePassage(bucket, passageId);
      if (!passage) {
        return { success: false, error: `Passage not found in bucket: ${passageId}` };
      }

      // Add to approved array
      const approved = (bucket.approved as Record<string, unknown>[]) || [];
      passage.curation = { status: 'approved', timestamp: Date.now() };
      approved.push(passage);
      bucket.approved = approved;

      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      return { success: true, fromArray };
    } catch (err) {
      console.error('[Harvest] approve-passage error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:reject-passage', (_e, bucketId: string, passageId: string, reason?: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      const { passage, fromArray } = findAndRemovePassage(bucket, passageId);
      if (!passage) {
        return { success: false, error: `Passage not found in bucket: ${passageId}` };
      }

      // Add to rejected array
      const rejected = (bucket.rejected as Record<string, unknown>[]) || [];
      passage.curation = { status: 'rejected', reason, timestamp: Date.now() };
      rejected.push(passage);
      bucket.rejected = rejected;

      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      return { success: true, fromArray };
    } catch (err) {
      console.error('[Harvest] reject-passage error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:gem-passage', (_e, bucketId: string, passageId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      const { passage, fromArray } = findAndRemovePassage(bucket, passageId);
      if (!passage) {
        return { success: false, error: `Passage not found in bucket: ${passageId}` };
      }

      // Add to gems array
      const gems = (bucket.gems as Record<string, unknown>[]) || [];
      passage.curation = { status: 'gem', timestamp: Date.now() };
      gems.push(passage);
      bucket.gems = gems;

      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      return { success: true, fromArray };
    } catch (err) {
      console.error('[Harvest] gem-passage error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:undo-passage', (_e, bucketId: string, passageId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      const { passage, fromArray } = findAndRemovePassage(bucket, passageId);
      if (!passage) {
        return { success: false, error: `Passage not found in bucket: ${passageId}` };
      }

      // Move back to candidates
      const candidates = (bucket.candidates as Record<string, unknown>[]) || [];
      passage.curation = { status: 'candidate', timestamp: Date.now() };
      candidates.push(passage);
      bucket.candidates = candidates;

      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      return { success: true, fromArray };
    } catch (err) {
      console.error('[Harvest] undo-passage error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:finish-collecting', (_e, bucketId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      if (bucket.status !== 'collecting') {
        return { success: false, error: `Bucket status is ${bucket.status}, expected 'collecting'` };
      }

      bucket.status = 'reviewing';
      bucket.completedAt = Date.now();
      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      return { success: true };
    } catch (err) {
      console.error('[Harvest] finish-collecting error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:stage-bucket', (_e, bucketId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      console.log(`[Harvest] Stage attempt for bucket ${bucketId}:`, {
        status: bucket.status,
        bookUri: bucket.bookUri,
        bookId: bucket.bookId,
        approvedCount: (bucket.approved as unknown[])?.length ?? 0,
        gemsCount: (bucket.gems as unknown[])?.length ?? 0,
      });

      if (bucket.status !== 'reviewing') {
        return { success: false, error: `Bucket status is ${bucket.status}, expected 'reviewing'` };
      }

      const approved = (bucket.approved as unknown[]) || [];
      const gems = (bucket.gems as unknown[]) || [];
      if (approved.length === 0 && gems.length === 0) {
        return { success: false, error: 'No approved or gem passages to stage' };
      }

      bucket.status = 'staged';
      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      console.log(`[Harvest] Staged bucket ${bucketId} with ${approved.length} approved, ${gems.length} gems`);
      return { success: true, approvedCount: approved.length, gemCount: gems.length };
    } catch (err) {
      console.error('[Harvest] stage-bucket error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:commit-bucket', (_e, bucketId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      console.log(`[Harvest] Commit attempt for bucket ${bucketId}:`, {
        status: bucket.status,
        bookUri: bucket.bookUri,
        bookId: bucket.bookId,
        approvedCount: (bucket.approved as unknown[])?.length ?? 0,
        gemsCount: (bucket.gems as unknown[])?.length ?? 0,
      });

      if (bucket.status !== 'staged') {
        return { success: false, error: `Bucket status is ${bucket.status}, expected 'staged'` };
      }

      // Get the book to find the bookId - try both bookUri and bookId
      console.log(`[Harvest] Looking up book by URI: ${bucket.bookUri}`);
      let book = db.getBook(bucket.bookUri as string);
      if (!book && bucket.bookId) {
        console.log(`[Harvest] URI lookup failed, trying ID: ${bucket.bookId}`);
        book = db.getBook(bucket.bookId as string);
      }
      if (!book) {
        console.error(`[Harvest] Book not found. Tried URI=${bucket.bookUri}, ID=${bucket.bookId}`);
        return { success: false, error: `Book not found: ${bucket.bookUri} (also tried ID: ${bucket.bookId})` };
      }
      console.log(`[Harvest] Found book: ${book.id} (${book.name})`);

      const approved = (bucket.approved as Record<string, unknown>[]) || [];
      const gems = (bucket.gems as Record<string, unknown>[]) || [];
      const allPassages = [...approved, ...gems];

      let passageCount = 0;
      for (const passage of allPassages) {
        const curationStatus = gems.some((g) => g.id === passage.id) ? 'gem' : 'approved';
        db.upsertBookPassage({
          id: passage.id as string,
          bookId: book.id as string,
          sourceRef: passage.sourceRef,
          text: (passage.text || passage.content || '') as string,
          wordCount: passage.wordCount as number | undefined,
          role: passage.role as string | undefined,
          harvestedBy: passage.harvestedBy as string | undefined,
          threadId: passage.threadId as string | undefined,
          curationStatus,
          curationNote: (passage.curation as Record<string, unknown>)?.notes as string | undefined,
          tags: passage.tags as string[] | undefined,
        });
        passageCount++;
      }

      bucket.status = 'committed';
      bucket.finalizedAt = Date.now();
      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);

      console.log(`[Harvest] Committed ${passageCount} passages from bucket ${bucketId} to book ${book.id}`);
      return { success: true, passageCount };
    } catch (err) {
      console.error('[Harvest] commit-bucket error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:discard-bucket', (_e, bucketId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      bucket.status = 'discarded';
      bucket.finalizedAt = Date.now();
      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      return { success: true };
    } catch (err) {
      console.error('[Harvest] discard-bucket error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // NARRATIVE ARC OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:narrative-arc:list', (_e, bookUri: string) => {
    const db = ensureDb();
    return db.getNarrativeArcsForBook(bookUri);
  });

  ipcMain.handle('xanadu:narrative-arc:get', (_e, id: string) => {
    const db = ensureDb();
    return db.getNarrativeArc(id);
  });

  ipcMain.handle('xanadu:narrative-arc:upsert', (_e, arc: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertNarrativeArc(arc as Parameters<typeof db.upsertNarrativeArc>[0]);
    return { success: true, id: arc.id };
  });

  ipcMain.handle('xanadu:narrative-arc:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deleteNarrativeArc(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // PASSAGE LINK OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:passage-link:list-by-chapter', (_e, chapterId: string) => {
    const db = ensureDb();
    return db.getPassageLinksForChapter(chapterId);
  });

  ipcMain.handle('xanadu:passage-link:list-by-passage', (_e, passageId: string) => {
    const db = ensureDb();
    return db.getPassageLinksForPassage(passageId);
  });

  ipcMain.handle('xanadu:passage-link:upsert', (_e, link: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertPassageLink(link as Parameters<typeof db.upsertPassageLink>[0]);
    return { success: true, id: link.id };
  });

  ipcMain.handle('xanadu:passage-link:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deletePassageLink(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // PASSAGE ANALYSIS (Composite analysis for curation)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'xanadu:analyze:passage',
    async (
      _e,
      passageId: string,
      text: string,
      config?: {
        bookId?: string;
        bookTheme?: string;
        enableQuantum?: boolean;
        enableAiDetection?: boolean;
        enableResonance?: boolean;
        model?: 'local' | 'cloud';
      }
    ) => {
      try {
        // Dynamic import to avoid circular dependencies
        const { analyzePassage } = await import('../services/passage-analyzer');
        const db = ensureDb();

        // Get book theme if bookId provided
        let bookTheme = config?.bookTheme;
        if (!bookTheme && config?.bookId) {
          const book = db.getBook(config.bookId);
          if (book) {
            bookTheme = `${book.name} ${book.description || ''}`;
          }
        }

        const result = await analyzePassage(passageId, text, { ...config, bookTheme }, db);
        return { success: true, analysis: result };
      } catch (err) {
        console.error('[Analysis] passage error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  ipcMain.handle(
    'xanadu:analyze:passages',
    async (
      _e,
      passages: Array<{ id: string; text: string }>,
      config?: {
        bookId?: string;
        bookTheme?: string;
        enableQuantum?: boolean;
        enableAiDetection?: boolean;
        enableResonance?: boolean;
        model?: 'local' | 'cloud';
      }
    ) => {
      try {
        const { analyzePassages } = await import('../services/passage-analyzer');
        const db = ensureDb();

        // Get book theme if bookId provided
        let bookTheme = config?.bookTheme;
        if (!bookTheme && config?.bookId) {
          const book = db.getBook(config.bookId);
          if (book) {
            bookTheme = `${book.name} ${book.description || ''}`;
          }
        }

        const results = await analyzePassages(passages, { ...config, bookTheme }, db);
        return { success: true, analyses: results };
      } catch (err) {
        console.error('[Analysis] passages error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // CHEKHOV ANALYSIS (Narrative necessity)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:chekhov:analyze-document', async (_e, documentId: string, text: string) => {
    try {
      const { analyzeDocument } = await import('../services/chekhov-analyzer');
      const result = analyzeDocument(documentId, text);
      return { success: true, analysis: result };
    } catch (err) {
      console.error('[Chekhov] analyze-document error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle(
    'xanadu:chekhov:analyze-sentence',
    async (_e, sentenceId: string, sentence: string, context?: string[]) => {
      try {
        const { analyzeSentence } = await import('../services/chekhov-analyzer');
        const result = analyzeSentence(sentenceId, sentence, context);
        return { success: true, analysis: result };
      } catch (err) {
        console.error('[Chekhov] analyze-sentence error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // SENTIMENT TRACKING (Emotional trajectory)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:sentiment:analyze-trajectory', async (_e, documentId: string, text: string) => {
    try {
      const { analyzeTrajectory } = await import('../services/sentiment-tracker');
      const result = analyzeTrajectory(documentId, text);
      return { success: true, trajectory: result };
    } catch (err) {
      console.error('[Sentiment] analyze-trajectory error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:sentiment:analyze-sentence', async (_e, sentenceId: string, sentence: string) => {
    try {
      const { analyzeSentence } = await import('../services/sentiment-tracker');
      const result = analyzeSentence(sentenceId, sentence);
      return { success: true, analysis: result };
    } catch (err) {
      console.error('[Sentiment] analyze-sentence error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // MODEL ROUTER (Local/Cloud model selection)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:model:list-available', async () => {
    try {
      const { getModelRouter } = await import('../services/model-router');
      const router = getModelRouter();
      const models = await router.listAvailableModels();
      return { success: true, models };
    } catch (err) {
      console.error('[Model] list-available error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle(
    'xanadu:model:generate',
    async (
      _e,
      request: {
        prompt: string;
        maxTokens?: number;
        temperature?: number;
        taskType?: 'quick-analysis' | 'deep-analysis' | 'draft' | 'final';
        systemPrompt?: string;
      }
    ) => {
      try {
        const { getModelRouter } = await import('../services/model-router');
        const router = getModelRouter();
        const result = await router.generate(request);
        return result;
      } catch (err) {
        console.error('[Model] generate error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error', latencyMs: 0 };
      }
    }
  );

  ipcMain.handle(
    'xanadu:model:configure',
    async (
      _e,
      config: {
        preference: 'local-only' | 'cloud-when-needed' | 'cloud-preferred';
        anthropicApiKey?: string;
        cloudflareAccountId?: string;
        cloudflareApiToken?: string;
      }
    ) => {
      try {
        const { configureModelRouter } = await import('../services/model-router');
        configureModelRouter(config);
        return { success: true };
      } catch (err) {
        console.error('[Model] configure error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // BOOK PROPOSAL (Intelligent book assembly)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'xanadu:book:generate-proposal',
    async (
      _e,
      sources: Array<{
        id: string;
        text: string;
        metadata?: { sourceRef?: string; timestamp?: number; author?: string };
      }>,
      bookTheme?: string
    ) => {
      try {
        const { generateProposal } = await import('../services/book-proposal');
        const proposal = await generateProposal(sources, bookTheme);
        return { success: true, proposal };
      } catch (err) {
        console.error('[BookProposal] generate-proposal error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  ipcMain.handle(
    'xanadu:book:generate-draft',
    async (
      _e,
      proposal: Record<string, unknown>,
      sources: Array<{ id: string; text: string; metadata?: Record<string, unknown> }>,
      config: {
        selectedArcIndex: number;
        selectedStyleIndex: number;
        additionalGuidance?: string;
        modelTier?: 'local' | 'balanced' | 'quality';
      }
    ) => {
      try {
        const { generateDraft } = await import('../services/book-proposal');
        const result = await generateDraft(
          proposal as unknown as Parameters<typeof generateDraft>[0],
          sources,
          config
        );
        return result;
      } catch (err) {
        console.error('[BookProposal] generate-draft error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // DRAFT GENERATION (Iterative chapter generation)
  // ─────────────────────────────────────────────────────────────────

  // Initialize draft generator service
  let draftGeneratorService: Awaited<
    ReturnType<typeof import('../services/draft-generator')['getDraftGenerator']>
  > | null = null;

  const ensureDraftGenerator = async () => {
    if (!draftGeneratorService) {
      if (!areServicesInitialized()) {
        throw new Error('Archive services not initialized. Start archive server first.');
      }
      const archivePath = getArchiveRoot();
      const { getDraftGenerator } = await import('../services/draft-generator.js');
      draftGeneratorService = getDraftGenerator(archivePath);

      // Forward progress events to renderer
      draftGeneratorService.on('progress', (progress) => {
        const mainWindow = getMainWindow();
        mainWindow?.webContents.send('draft:progress', progress);
      });

      draftGeneratorService.on('event', (event) => {
        const mainWindow = getMainWindow();
        mainWindow?.webContents.send('draft:event', event);
      });
    }
    return draftGeneratorService;
  };

  ipcMain.handle(
    'draft:start',
    async (
      _e,
      params: {
        bookUri: string;
        chapterId: string;
        arcId?: string;
        style?: 'academic' | 'narrative' | 'conversational';
        wordsPerSection?: number;
      }
    ) => {
      try {
        const service = await ensureDraftGenerator();
        return service.startGeneration(params);
      } catch (err) {
        console.error('[Draft] start error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  ipcMain.handle('draft:pause', async (_e, jobId: string) => {
    try {
      const service = await ensureDraftGenerator();
      return service.pause(jobId);
    } catch (err) {
      console.error('[Draft] pause error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('draft:resume', async (_e, jobId: string) => {
    try {
      const service = await ensureDraftGenerator();
      return service.resume(jobId);
    } catch (err) {
      console.error('[Draft] resume error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('draft:status', async (_e, jobId: string) => {
    try {
      const service = await ensureDraftGenerator();
      return service.getStatus(jobId);
    } catch (err) {
      console.error('[Draft] status error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('draft:list', async () => {
    try {
      const service = await ensureDraftGenerator();
      return { success: true, jobs: service.listJobs() };
    } catch (err) {
      console.error('[Draft] list error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // SEED LIBRARY DATA (First Run)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:seed-library', async () => {
    // Wait for services to be ready (handles race condition on startup)
    const ready = await waitForServices(15000); // 15 second timeout
    if (!ready) {
      console.warn('[Xanadu] Timed out waiting for services to initialize');
      return { success: false, error: 'Services not ready after 15s timeout' };
    }

    const db = ensureDb();

    // Check if library already seeded (look for a known library persona)
    const existingPersona = db.getPersona('persona://tem-noon/marginalia-voice');
    if (existingPersona) {
      console.log('[Xanadu] Library already seeded');
      return { success: true, alreadySeeded: true };
    }

    console.log('[Xanadu] Seeding library data...');

    try {
      // Seed library personas (createdAt/updatedAt generated by upsert)
      const libraryPersonas = await import('../xanadu/library-seed').then((m) => m.LIBRARY_PERSONAS);
      for (const persona of libraryPersonas) {
        db.upsertPersona({
          id: persona.id,
          uri: persona.uri,
          name: persona.name,
          description: persona.description,
          author: persona.author,
          voice: persona.voice,
          vocabulary: persona.vocabulary,
          derivedFrom: persona.derivedFrom,
          influences: persona.influences,
          exemplars: persona.exemplars,
          systemPrompt: persona.systemPrompt,
          tags: persona.tags,
          isLibrary: true,
        });
      }

      // Seed library styles (createdAt/updatedAt generated by upsert)
      const libraryStyles = await import('../xanadu/library-seed').then((m) => m.LIBRARY_STYLES);
      for (const style of libraryStyles) {
        db.upsertStyle({
          id: style.id,
          uri: style.uri,
          name: style.name,
          description: style.description,
          author: style.author,
          characteristics: style.characteristics,
          structure: style.structure,
          stylePrompt: style.stylePrompt,
          derivedFrom: style.derivedFrom,
          tags: style.tags,
          isLibrary: true,
        });
      }

      // Seed library books (createdAt/updatedAt generated by upsert)
      const libraryBooks = await import('../xanadu/library-seed').then((m) => m.LIBRARY_BOOKS);
      for (const book of libraryBooks) {
        db.upsertBook({
          id: book.id,
          uri: book.uri,
          name: book.name,
          subtitle: book.subtitle,
          description: book.description,
          author: book.author,
          status: book.status,
          personaRefs: book.personaRefs,
          styleRefs: book.styleRefs,
          sourceRefs: book.sourceRefs,
          threads: book.threads,
          harvestConfig: book.harvestConfig,
          editorial: book.editorial,
          stats: book.stats,
          tags: book.tags,
          isLibrary: true,
        });
      }

      console.log('[Xanadu] Library seed complete');
      return { success: true, alreadySeeded: false };
    } catch (err) {
      console.error('[Xanadu] Failed to seed library:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  console.log('Xanadu unified storage IPC handlers registered');
}

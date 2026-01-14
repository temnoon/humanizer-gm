/**
 * BookOperations - Book building, personas, styles, passages, and related entities
 *
 * Extracted from EmbeddingDatabase for maintainability.
 */

import { DatabaseOperations } from './DatabaseOperations.js';

export class BookOperations extends DatabaseOperations {
  // ===========================================================================
  // Xanadu Links (Bidirectional)
  // ===========================================================================

  insertLink(link: {
    id: string;
    sourceUri: string;
    targetUri: string;
    linkType: string;
    linkStrength?: number;
    sourceStart?: number;
    sourceEnd?: number;
    targetStart?: number;
    targetEnd?: number;
    label?: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.db.prepare(`
      INSERT INTO links (id, source_uri, target_uri, link_type, link_strength,
        source_start, source_end, target_start, target_end,
        label, created_at, created_by, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      link.id,
      link.sourceUri,
      link.targetUri,
      link.linkType,
      link.linkStrength ?? 1.0,
      link.sourceStart ?? null,
      link.sourceEnd ?? null,
      link.targetStart ?? null,
      link.targetEnd ?? null,
      link.label ?? null,
      Date.now(),
      link.createdBy,
      link.metadata ? JSON.stringify(link.metadata) : null
    );
  }

  getLinksBySource(sourceUri: string): Array<{
    id: string;
    sourceUri: string;
    targetUri: string;
    linkType: string;
    linkStrength: number;
    label: string | null;
    createdBy: string;
  }> {
    return this.db.prepare(`
      SELECT id, source_uri as sourceUri, target_uri as targetUri, link_type as linkType,
             link_strength as linkStrength, label, created_by as createdBy
      FROM links WHERE source_uri = ?
    `).all(sourceUri) as Array<{
      id: string;
      sourceUri: string;
      targetUri: string;
      linkType: string;
      linkStrength: number;
      label: string | null;
      createdBy: string;
    }>;
  }

  getLinksByTarget(targetUri: string): Array<{
    id: string;
    sourceUri: string;
    targetUri: string;
    linkType: string;
    linkStrength: number;
    label: string | null;
    createdBy: string;
  }> {
    return this.db.prepare(`
      SELECT id, source_uri as sourceUri, target_uri as targetUri, link_type as linkType,
             link_strength as linkStrength, label, created_by as createdBy
      FROM links WHERE target_uri = ?
    `).all(targetUri) as Array<{
      id: string;
      sourceUri: string;
      targetUri: string;
      linkType: string;
      linkStrength: number;
      label: string | null;
      createdBy: string;
    }>;
  }

  getLinksBidirectional(uri: string): Array<{
    id: string;
    sourceUri: string;
    targetUri: string;
    linkType: string;
    linkStrength: number;
    direction: 'outgoing' | 'incoming';
  }> {
    const outgoing = this.db.prepare(`
      SELECT id, source_uri as sourceUri, target_uri as targetUri, link_type as linkType,
             link_strength as linkStrength, 'outgoing' as direction
      FROM links WHERE source_uri = ?
    `).all(uri) as Array<{
      id: string;
      sourceUri: string;
      targetUri: string;
      linkType: string;
      linkStrength: number;
      direction: 'outgoing' | 'incoming';
    }>;

    const incoming = this.db.prepare(`
      SELECT id, source_uri as sourceUri, target_uri as targetUri, link_type as linkType,
             link_strength as linkStrength, 'incoming' as direction
      FROM links WHERE target_uri = ?
    `).all(uri) as Array<{
      id: string;
      sourceUri: string;
      targetUri: string;
      linkType: string;
      linkStrength: number;
      direction: 'outgoing' | 'incoming';
    }>;

    return [...outgoing, ...incoming];
  }

  deleteLink(id: string): void {
    this.db.prepare('DELETE FROM links WHERE id = ?').run(id);
  }

  // ===========================================================================
  // Content-Addressable Media Items
  // ===========================================================================

  upsertMediaItem(item: {
    id: string;
    contentHash: string;
    filePath: string;
    originalFilename?: string;
    mimeType?: string;
    fileSize?: number;
    width?: number;
    height?: number;
    duration?: number;
    takenAt?: number;
  }): { id: string; contentHash: string; isNew: boolean } {
    // Check if hash already exists
    const existing = this.db.prepare(
      'SELECT id, content_hash FROM media_items WHERE content_hash = ?'
    ).get(item.contentHash) as { id: string; content_hash: string } | undefined;

    if (existing) {
      return { id: existing.id, contentHash: existing.content_hash, isNew: false };
    }

    this.db.prepare(`
      INSERT INTO media_items (id, content_hash, file_path, original_filename,
        mime_type, file_size, width, height, duration, taken_at, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.contentHash,
      item.filePath,
      item.originalFilename ?? null,
      item.mimeType ?? null,
      item.fileSize ?? null,
      item.width ?? null,
      item.height ?? null,
      item.duration ?? null,
      item.takenAt ?? null,
      Date.now()
    );

    return { id: item.id, contentHash: item.contentHash, isNew: true };
  }

  getMediaByHash(contentHash: string): {
    id: string;
    contentHash: string;
    filePath: string;
    originalFilename: string | null;
    mimeType: string | null;
    fileSize: number | null;
  } | null {
    return this.db.prepare(`
      SELECT id, content_hash as contentHash, file_path as filePath,
             original_filename as originalFilename, mime_type as mimeType,
             file_size as fileSize
      FROM media_items WHERE content_hash = ?
    `).get(contentHash) as {
      id: string;
      contentHash: string;
      filePath: string;
      originalFilename: string | null;
      mimeType: string | null;
      fileSize: number | null;
    } | null;
  }

  getMediaById(id: string): {
    id: string;
    contentHash: string;
    filePath: string;
    originalFilename: string | null;
    mimeType: string | null;
    fileSize: number | null;
    width: number | null;
    height: number | null;
  } | null {
    return this.db.prepare(`
      SELECT id, content_hash as contentHash, file_path as filePath,
             original_filename as originalFilename, mime_type as mimeType,
             file_size as fileSize, width, height
      FROM media_items WHERE id = ?
    `).get(id) as {
      id: string;
      contentHash: string;
      filePath: string;
      originalFilename: string | null;
      mimeType: string | null;
      fileSize: number | null;
      width: number | null;
      height: number | null;
    } | null;
  }

  updateMediaVision(contentHash: string, description: string): void {
    this.db.prepare(`
      UPDATE media_items SET vision_description = ? WHERE content_hash = ?
    `).run(description, contentHash);
  }

  // ===========================================================================
  // Media References (Content to Media links)
  // ===========================================================================

  insertMediaReference(ref: {
    id: string;
    contentId: string;
    mediaHash: string;
    position?: number;
    charOffset?: number;
    referenceType: string;
    originalPointer?: string;
    caption?: string;
    altText?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO media_references (id, content_id, media_hash, position, char_offset,
        reference_type, original_pointer, caption, alt_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ref.id,
      ref.contentId,
      ref.mediaHash,
      ref.position ?? null,
      ref.charOffset ?? null,
      ref.referenceType,
      ref.originalPointer ?? null,
      ref.caption ?? null,
      ref.altText ?? null,
      Date.now()
    );
  }

  getMediaRefsForContent(contentId: string): Array<{
    id: string;
    mediaHash: string;
    filePath: string;
    position: number | null;
    referenceType: string;
    originalPointer: string | null;
  }> {
    return this.db.prepare(`
      SELECT mr.id, mr.media_hash as mediaHash, mi.file_path as filePath,
             mr.position, mr.reference_type as referenceType,
             mr.original_pointer as originalPointer
      FROM media_references mr
      JOIN media_items mi ON mi.content_hash = mr.media_hash
      WHERE mr.content_id = ?
      ORDER BY mr.position ASC
    `).all(contentId) as Array<{
      id: string;
      mediaHash: string;
      filePath: string;
      position: number | null;
      referenceType: string;
      originalPointer: string | null;
    }>;
  }

  resolveMediaPointer(originalPointer: string): string | null {
    const result = this.db.prepare(`
      SELECT media_hash FROM media_references WHERE original_pointer = ? LIMIT 1
    `).get(originalPointer) as { media_hash: string } | undefined;
    return result?.media_hash ?? null;
  }

  // ===========================================================================
  // Import Jobs
  // ===========================================================================

  createImportJob(job: {
    id: string;
    sourceType: string;
    sourcePath?: string;
    sourceName?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO import_jobs (id, status, source_type, source_path, source_name, created_at)
      VALUES (?, 'pending', ?, ?, ?, ?)
    `).run(job.id, job.sourceType, job.sourcePath ?? null, job.sourceName ?? null, Date.now());
  }

  updateImportJob(id: string, updates: {
    status?: string;
    progress?: number;
    currentPhase?: string;
    currentItem?: string;
    unitsTotal?: number;
    unitsProcessed?: number;
    mediaTotal?: number;
    mediaProcessed?: number;
    linksCreated?: number;
    errorsCount?: number;
    startedAt?: number;
    completedAt?: number;
    errorLog?: string[];
  }): void {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.progress !== undefined) { fields.push('progress = ?'); values.push(updates.progress); }
    if (updates.currentPhase !== undefined) { fields.push('current_phase = ?'); values.push(updates.currentPhase); }
    if (updates.currentItem !== undefined) { fields.push('current_item = ?'); values.push(updates.currentItem); }
    if (updates.unitsTotal !== undefined) { fields.push('units_total = ?'); values.push(updates.unitsTotal); }
    if (updates.unitsProcessed !== undefined) { fields.push('units_processed = ?'); values.push(updates.unitsProcessed); }
    if (updates.mediaTotal !== undefined) { fields.push('media_total = ?'); values.push(updates.mediaTotal); }
    if (updates.mediaProcessed !== undefined) { fields.push('media_processed = ?'); values.push(updates.mediaProcessed); }
    if (updates.linksCreated !== undefined) { fields.push('links_created = ?'); values.push(updates.linksCreated); }
    if (updates.errorsCount !== undefined) { fields.push('errors_count = ?'); values.push(updates.errorsCount); }
    if (updates.startedAt !== undefined) { fields.push('started_at = ?'); values.push(updates.startedAt); }
    if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt); }
    if (updates.errorLog !== undefined) { fields.push('error_log = ?'); values.push(JSON.stringify(updates.errorLog)); }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE import_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  getImportJob(id: string): {
    id: string;
    status: string;
    sourceType: string;
    sourcePath: string | null;
    sourceName: string | null;
    progress: number;
    currentPhase: string | null;
    currentItem: string | null;
    unitsTotal: number;
    unitsProcessed: number;
    mediaTotal: number;
    mediaProcessed: number;
    linksCreated: number;
    errorsCount: number;
    createdAt: number;
    startedAt: number | null;
    completedAt: number | null;
    errorLog: string[];
  } | null {
    const row = this.db.prepare(`
      SELECT id, status, source_type as sourceType, source_path as sourcePath,
             source_name as sourceName, progress, current_phase as currentPhase,
             current_item as currentItem, units_total as unitsTotal,
             units_processed as unitsProcessed, media_total as mediaTotal,
             media_processed as mediaProcessed, links_created as linksCreated,
             errors_count as errorsCount, created_at as createdAt,
             started_at as startedAt, completed_at as completedAt, error_log as errorLog
      FROM import_jobs WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      status: row.status as string,
      sourceType: row.sourceType as string,
      sourcePath: row.sourcePath as string | null,
      sourceName: row.sourceName as string | null,
      progress: row.progress as number,
      currentPhase: row.currentPhase as string | null,
      currentItem: row.currentItem as string | null,
      unitsTotal: row.unitsTotal as number,
      unitsProcessed: row.unitsProcessed as number,
      mediaTotal: row.mediaTotal as number,
      mediaProcessed: row.mediaProcessed as number,
      linksCreated: row.linksCreated as number,
      errorsCount: row.errorsCount as number,
      createdAt: row.createdAt as number,
      startedAt: row.startedAt as number | null,
      completedAt: row.completedAt as number | null,
      errorLog: row.errorLog ? JSON.parse(row.errorLog as string) : [],
    };
  }

  getRecentImportJobs(limit = 10): Array<{
    id: string;
    status: string;
    sourceType: string;
    sourceName: string | null;
    progress: number;
    unitsProcessed: number;
    mediaProcessed: number;
    errorsCount: number;
    createdAt: number;
    completedAt: number | null;
  }> {
    return this.db.prepare(`
      SELECT id, status, source_type as sourceType, source_name as sourceName,
             progress, units_processed as unitsProcessed, media_processed as mediaProcessed,
             errors_count as errorsCount, created_at as createdAt,
             completed_at as completedAt
      FROM import_jobs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: string;
      status: string;
      sourceType: string;
      sourceName: string | null;
      progress: number;
      unitsProcessed: number;
      mediaProcessed: number;
      errorsCount: number;
      createdAt: number;
      completedAt: number | null;
    }>;
  }

  // ===========================================================================
  // Book Operations (Xanadu Unified Storage)
  // ===========================================================================

  upsertBook(book: {
    id: string;
    uri: string;
    name: string;
    subtitle?: string;
    author?: string;
    description?: string;
    status?: string;
    bookType?: string;
    personaRefs?: string[];
    styleRefs?: string[];
    sourceRefs?: unknown[];
    threads?: unknown[];
    harvestConfig?: unknown;
    editorial?: unknown;
    thinking?: unknown;
    pyramidId?: string;
    stats?: unknown;
    profile?: unknown;
    tags?: string[];
    isLibrary?: boolean;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO books (
        id, uri, name, subtitle, author, description, status, book_type,
        persona_refs, style_refs, source_refs, threads, harvest_config,
        editorial, thinking, pyramid_id, stats, profile, tags, is_library,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        uri = excluded.uri,
        name = excluded.name,
        subtitle = excluded.subtitle,
        author = excluded.author,
        description = excluded.description,
        status = excluded.status,
        book_type = excluded.book_type,
        persona_refs = excluded.persona_refs,
        style_refs = excluded.style_refs,
        source_refs = excluded.source_refs,
        threads = excluded.threads,
        harvest_config = excluded.harvest_config,
        editorial = excluded.editorial,
        thinking = excluded.thinking,
        pyramid_id = excluded.pyramid_id,
        stats = excluded.stats,
        profile = excluded.profile,
        tags = excluded.tags,
        is_library = excluded.is_library,
        updated_at = excluded.updated_at
    `).run(
      book.id,
      book.uri,
      book.name,
      book.subtitle ?? null,
      book.author ?? null,
      book.description ?? null,
      book.status ?? 'harvesting',
      book.bookType ?? 'book',
      book.personaRefs ? JSON.stringify(book.personaRefs) : null,
      book.styleRefs ? JSON.stringify(book.styleRefs) : null,
      book.sourceRefs ? JSON.stringify(book.sourceRefs) : null,
      book.threads ? JSON.stringify(book.threads) : null,
      book.harvestConfig ? JSON.stringify(book.harvestConfig) : null,
      book.editorial ? JSON.stringify(book.editorial) : null,
      book.thinking ? JSON.stringify(book.thinking) : null,
      book.pyramidId ?? null,
      book.stats ? JSON.stringify(book.stats) : null,
      book.profile ? JSON.stringify(book.profile) : null,
      book.tags ? JSON.stringify(book.tags) : null,
      book.isLibrary ? 1 : 0,
      now,
      now
    );
  }

  getBook(idOrUri: string): Record<string, unknown> | null {
    const row = this.db.prepare(`
      SELECT * FROM books WHERE id = ? OR uri = ?
    `).get(idOrUri, idOrUri) as Record<string, unknown> | undefined;
    if (!row) return null;
    const book = this.parseBookRow(row);
    // Include chapters and passages
    book.chapters = this.getBookChapters(book.id as string);
    book.passages = this.getBookPassages(book.id as string);
    // Compute stats from actual data (override stored stats)
    book.stats = this.computeBookStats(book);
    return book;
  }

  getAllBooks(includeLibrary = true): Record<string, unknown>[] {
    const query = includeLibrary
      ? 'SELECT * FROM books ORDER BY updated_at DESC'
      : 'SELECT * FROM books WHERE is_library = 0 ORDER BY updated_at DESC';
    const rows = this.db.prepare(query).all() as Record<string, unknown>[];

    return rows.map(row => {
      const book = this.parseBookRow(row);
      // Include chapters
      book.chapters = this.getBookChapters(book.id as string);
      // Include passages
      book.passages = this.getBookPassages(book.id as string);
      // Compute stats from actual data (override stored stats)
      book.stats = this.computeBookStats(book);
      return book;
    });
  }

  deleteBook(id: string): void {
    this.db.prepare('DELETE FROM books WHERE id = ?').run(id);
  }

  private parseBookRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      uri: row.uri,
      name: row.name,
      subtitle: row.subtitle,
      author: row.author,
      description: row.description,
      status: row.status,
      bookType: row.book_type ?? 'book',
      personaRefs: row.persona_refs ? JSON.parse(row.persona_refs as string) : [],
      styleRefs: row.style_refs ? JSON.parse(row.style_refs as string) : [],
      sourceRefs: row.source_refs ? JSON.parse(row.source_refs as string) : [],
      threads: row.threads ? JSON.parse(row.threads as string) : [],
      harvestConfig: row.harvest_config ? JSON.parse(row.harvest_config as string) : null,
      editorial: row.editorial ? JSON.parse(row.editorial as string) : null,
      thinking: row.thinking ? JSON.parse(row.thinking as string) : null,
      pyramidId: row.pyramid_id,
      stats: row.stats ? JSON.parse(row.stats as string) : {},
      profile: row.profile ? JSON.parse(row.profile as string) : null,
      tags: row.tags ? JSON.parse(row.tags as string) : [],
      isLibrary: row.is_library === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private computeBookStats(book: Record<string, unknown>): Record<string, unknown> {
    const chapters = (book.chapters || []) as Array<{ wordCount?: number; content?: string }>;
    const passages = (book.passages || []) as Array<{ curation?: { status?: string }; curationStatus?: string; text?: string; wordCount?: number }>;
    const sourceRefs = (book.sourceRefs || []) as unknown[];

    // Count passages by status
    const approved = passages.filter(p => {
      const status = p.curation?.status || p.curationStatus;
      return status === 'approved' || status === 'gem';
    });
    const gems = passages.filter(p => {
      const status = p.curation?.status || p.curationStatus;
      return status === 'gem';
    });

    // Compute word count from chapters
    const chapterWordCount = chapters.reduce((sum, ch) => {
      if (ch.wordCount) return sum + ch.wordCount;
      if (ch.content && typeof ch.content === 'string') {
        return sum + ch.content.trim().split(/\s+/).filter(Boolean).length;
      }
      return sum;
    }, 0);

    // Fallback: count from passages if no chapters
    const passageWordCount = passages.reduce((sum, p) => {
      if (p.wordCount) return sum + p.wordCount;
      if (p.text && typeof p.text === 'string') {
        return sum + p.text.trim().split(/\s+/).filter(Boolean).length;
      }
      return sum;
    }, 0);

    return {
      totalSources: sourceRefs.length,
      totalPassages: passages.length,
      approvedPassages: approved.length,
      gems: gems.length,
      chapters: chapters.length,
      wordCount: chapterWordCount > 0 ? chapterWordCount : passageWordCount,
    };
  }

  // ===========================================================================
  // Persona Operations
  // ===========================================================================

  upsertPersona(persona: {
    id: string;
    uri: string;
    name: string;
    description?: string;
    author?: string;
    voice?: unknown;
    vocabulary?: unknown;
    derivedFrom?: unknown[];
    influences?: unknown[];
    exemplars?: unknown[];
    systemPrompt?: string;
    tags?: string[];
    isLibrary?: boolean;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO personas (
        id, uri, name, description, author, voice, vocabulary,
        derived_from, influences, exemplars, system_prompt, tags, is_library,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        uri = excluded.uri,
        name = excluded.name,
        description = excluded.description,
        author = excluded.author,
        voice = excluded.voice,
        vocabulary = excluded.vocabulary,
        derived_from = excluded.derived_from,
        influences = excluded.influences,
        exemplars = excluded.exemplars,
        system_prompt = excluded.system_prompt,
        tags = excluded.tags,
        is_library = excluded.is_library,
        updated_at = excluded.updated_at
    `).run(
      persona.id,
      persona.uri,
      persona.name,
      persona.description ?? null,
      persona.author ?? null,
      persona.voice ? JSON.stringify(persona.voice) : null,
      persona.vocabulary ? JSON.stringify(persona.vocabulary) : null,
      persona.derivedFrom ? JSON.stringify(persona.derivedFrom) : null,
      persona.influences ? JSON.stringify(persona.influences) : null,
      persona.exemplars ? JSON.stringify(persona.exemplars) : null,
      persona.systemPrompt ?? null,
      persona.tags ? JSON.stringify(persona.tags) : null,
      persona.isLibrary ? 1 : 0,
      now,
      now
    );
  }

  getPersona(idOrUri: string): Record<string, unknown> | null {
    const row = this.db.prepare(`
      SELECT * FROM personas WHERE id = ? OR uri = ?
    `).get(idOrUri, idOrUri) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.parsePersonaRow(row);
  }

  getAllPersonas(includeLibrary = true): Record<string, unknown>[] {
    const query = includeLibrary
      ? 'SELECT * FROM personas ORDER BY name'
      : 'SELECT * FROM personas WHERE is_library = 0 ORDER BY name';
    const rows = this.db.prepare(query).all() as Record<string, unknown>[];
    return rows.map(row => this.parsePersonaRow(row));
  }

  deletePersona(id: string): void {
    this.db.prepare('DELETE FROM personas WHERE id = ?').run(id);
  }

  private parsePersonaRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      uri: row.uri,
      name: row.name,
      description: row.description,
      author: row.author,
      voice: row.voice ? JSON.parse(row.voice as string) : null,
      vocabulary: row.vocabulary ? JSON.parse(row.vocabulary as string) : null,
      derivedFrom: row.derived_from ? JSON.parse(row.derived_from as string) : [],
      influences: row.influences ? JSON.parse(row.influences as string) : [],
      exemplars: row.exemplars ? JSON.parse(row.exemplars as string) : [],
      systemPrompt: row.system_prompt,
      tags: row.tags ? JSON.parse(row.tags as string) : [],
      isLibrary: row.is_library === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ===========================================================================
  // Style Operations
  // ===========================================================================

  upsertStyle(style: {
    id: string;
    uri: string;
    name: string;
    description?: string;
    author?: string;
    characteristics?: unknown;
    structure?: unknown;
    stylePrompt?: string;
    derivedFrom?: unknown[];
    tags?: string[];
    isLibrary?: boolean;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO styles (
        id, uri, name, description, author, characteristics, structure,
        style_prompt, derived_from, tags, is_library, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        uri = excluded.uri,
        name = excluded.name,
        description = excluded.description,
        author = excluded.author,
        characteristics = excluded.characteristics,
        structure = excluded.structure,
        style_prompt = excluded.style_prompt,
        derived_from = excluded.derived_from,
        tags = excluded.tags,
        is_library = excluded.is_library,
        updated_at = excluded.updated_at
    `).run(
      style.id,
      style.uri,
      style.name,
      style.description ?? null,
      style.author ?? null,
      style.characteristics ? JSON.stringify(style.characteristics) : null,
      style.structure ? JSON.stringify(style.structure) : null,
      style.stylePrompt ?? null,
      style.derivedFrom ? JSON.stringify(style.derivedFrom) : null,
      style.tags ? JSON.stringify(style.tags) : null,
      style.isLibrary ? 1 : 0,
      now,
      now
    );
  }

  getStyle(idOrUri: string): Record<string, unknown> | null {
    const row = this.db.prepare(`
      SELECT * FROM styles WHERE id = ? OR uri = ?
    `).get(idOrUri, idOrUri) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.parseStyleRow(row);
  }

  getAllStyles(includeLibrary = true): Record<string, unknown>[] {
    const query = includeLibrary
      ? 'SELECT * FROM styles ORDER BY name'
      : 'SELECT * FROM styles WHERE is_library = 0 ORDER BY name';
    const rows = this.db.prepare(query).all() as Record<string, unknown>[];
    return rows.map(row => this.parseStyleRow(row));
  }

  deleteStyle(id: string): void {
    this.db.prepare('DELETE FROM styles WHERE id = ?').run(id);
  }

  private parseStyleRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      uri: row.uri,
      name: row.name,
      description: row.description,
      author: row.author,
      characteristics: row.characteristics ? JSON.parse(row.characteristics as string) : null,
      structure: row.structure ? JSON.parse(row.structure as string) : null,
      stylePrompt: row.style_prompt,
      derivedFrom: row.derived_from ? JSON.parse(row.derived_from as string) : [],
      tags: row.tags ? JSON.parse(row.tags as string) : [],
      isLibrary: row.is_library === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ===========================================================================
  // Book Passage Operations
  // ===========================================================================

  upsertBookPassage(passage: {
    id: string;
    bookId: string;
    sourceRef?: unknown;
    text: string;
    wordCount?: number;
    role?: string;
    harvestedBy?: string;
    threadId?: string;
    curationStatus?: string;
    curationNote?: string;
    chapterId?: string;
    tags?: string[];
  }): void {
    const now = Date.now();
    const wordCount = passage.wordCount ?? passage.text.trim().split(/\s+/).filter(Boolean).length;

    this.db.prepare(`
      INSERT INTO book_passages (
        id, book_id, source_ref, text, word_count, role, harvested_by,
        thread_id, curation_status, curation_note, chapter_id, tags, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_ref = excluded.source_ref,
        text = excluded.text,
        word_count = excluded.word_count,
        role = excluded.role,
        harvested_by = excluded.harvested_by,
        thread_id = excluded.thread_id,
        curation_status = excluded.curation_status,
        curation_note = excluded.curation_note,
        chapter_id = excluded.chapter_id,
        tags = excluded.tags
    `).run(
      passage.id,
      passage.bookId,
      passage.sourceRef ? JSON.stringify(passage.sourceRef) : null,
      passage.text,
      wordCount,
      passage.role ?? null,
      passage.harvestedBy ?? 'manual',
      passage.threadId ?? null,
      passage.curationStatus ?? 'candidate',
      passage.curationNote ?? null,
      passage.chapterId ?? null,
      passage.tags ? JSON.stringify(passage.tags) : null,
      now
    );
  }

  getBookPassages(bookId: string, curationStatus?: string): Record<string, unknown>[] {
    let query = 'SELECT * FROM book_passages WHERE book_id = ?';
    const params: (string | null)[] = [bookId];

    if (curationStatus) {
      query += ' AND curation_status = ?';
      params.push(curationStatus);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map(row => this.parsePassageRow(row));
  }

  updatePassageCuration(id: string, status: string, note?: string): void {
    this.db.prepare(`
      UPDATE book_passages SET curation_status = ?, curation_note = ? WHERE id = ?
    `).run(status, note ?? null, id);
  }

  deleteBookPassage(id: string): void {
    this.db.prepare('DELETE FROM book_passages WHERE id = ?').run(id);
  }

  private parsePassageRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      bookId: row.book_id,
      sourceRef: row.source_ref ? JSON.parse(row.source_ref as string) : null,
      text: row.text,
      wordCount: row.word_count,
      role: row.role,
      harvestedBy: row.harvested_by,
      threadId: row.thread_id,
      curationStatus: row.curation_status,
      curationNote: row.curation_note,
      chapterId: row.chapter_id,
      tags: row.tags ? JSON.parse(row.tags as string) : [],
      createdAt: row.created_at,
    };
  }

  // ===========================================================================
  // Book Chapter Operations
  // ===========================================================================

  upsertBookChapter(chapter: {
    id: string;
    bookId: string;
    number: number;
    title: string;
    content?: string;
    wordCount?: number;
    version?: number;
    status?: string;
    epigraph?: unknown;
    sections?: unknown[];
    marginalia?: unknown[];
    metadata?: unknown;
    passageRefs?: string[];
  }): void {
    const now = Date.now();
    const wordCount = chapter.wordCount ?? (chapter.content?.trim().split(/\s+/).filter(Boolean).length ?? 0);

    this.db.prepare(`
      INSERT INTO book_chapters (
        id, book_id, number, title, content, word_count, version, status,
        epigraph, sections, marginalia, metadata, passage_refs, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        number = excluded.number,
        title = excluded.title,
        content = excluded.content,
        word_count = excluded.word_count,
        version = excluded.version,
        status = excluded.status,
        epigraph = excluded.epigraph,
        sections = excluded.sections,
        marginalia = excluded.marginalia,
        metadata = excluded.metadata,
        passage_refs = excluded.passage_refs,
        updated_at = excluded.updated_at
    `).run(
      chapter.id,
      chapter.bookId,
      chapter.number,
      chapter.title,
      chapter.content ?? null,
      wordCount,
      chapter.version ?? 1,
      chapter.status ?? 'outline',
      chapter.epigraph ? JSON.stringify(chapter.epigraph) : null,
      chapter.sections ? JSON.stringify(chapter.sections) : null,
      chapter.marginalia ? JSON.stringify(chapter.marginalia) : null,
      chapter.metadata ? JSON.stringify(chapter.metadata) : null,
      chapter.passageRefs ? JSON.stringify(chapter.passageRefs) : null,
      now,
      now
    );
  }

  getBookChapters(bookId: string): Record<string, unknown>[] {
    const rows = this.db.prepare(`
      SELECT * FROM book_chapters WHERE book_id = ? ORDER BY number
    `).all(bookId) as Record<string, unknown>[];
    return rows.map(row => this.parseChapterRow(row));
  }

  getBookChapter(id: string): Record<string, unknown> | null {
    const row = this.db.prepare(`
      SELECT * FROM book_chapters WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.parseChapterRow(row);
  }

  deleteBookChapter(id: string): void {
    this.db.prepare('DELETE FROM book_chapters WHERE id = ?').run(id);
  }

  saveChapterVersion(chapterId: string, version: number, content: string, changes?: string, createdBy?: string): void {
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
    this.db.prepare(`
      INSERT INTO chapter_versions (id, chapter_id, version, content, word_count, changes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `${chapterId}-v${version}`,
      chapterId,
      version,
      content,
      wordCount,
      changes ?? null,
      createdBy ?? 'user',
      Date.now()
    );
  }

  getChapterVersions(chapterId: string): Record<string, unknown>[] {
    return this.db.prepare(`
      SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY version DESC
    `).all(chapterId) as Record<string, unknown>[];
  }

  private parseChapterRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      bookId: row.book_id,
      number: row.number,
      title: row.title,
      content: row.content,
      wordCount: row.word_count,
      version: row.version,
      status: row.status,
      epigraph: row.epigraph ? JSON.parse(row.epigraph as string) : null,
      sections: row.sections ? JSON.parse(row.sections as string) : [],
      marginalia: row.marginalia ? JSON.parse(row.marginalia as string) : [],
      metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
      passageRefs: row.passage_refs ? JSON.parse(row.passage_refs as string) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ===========================================================================
  // Harvest Bucket Operations
  // ===========================================================================

  upsertHarvestBucket(bucket: {
    id: string;
    bookId: string;
    bookUri: string;
    status?: string;
    queries?: string[];
    candidates?: unknown[];
    approved?: unknown[];
    gems?: unknown[];
    rejected?: unknown[];
    duplicateIds?: string[];
    config?: unknown;
    threadUri?: string;
    stats?: unknown;
    initiatedBy?: string;
    completedAt?: number;
    finalizedAt?: number;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO harvest_buckets (
        id, book_id, book_uri, status, queries, candidates, approved, gems, rejected,
        duplicate_ids, config, thread_uri, stats, initiated_by, created_at, updated_at,
        completed_at, finalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        queries = excluded.queries,
        candidates = excluded.candidates,
        approved = excluded.approved,
        gems = excluded.gems,
        rejected = excluded.rejected,
        duplicate_ids = excluded.duplicate_ids,
        config = excluded.config,
        thread_uri = excluded.thread_uri,
        stats = excluded.stats,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        finalized_at = excluded.finalized_at
    `).run(
      bucket.id,
      bucket.bookId,
      bucket.bookUri,
      bucket.status ?? 'collecting',
      bucket.queries ? JSON.stringify(bucket.queries) : null,
      bucket.candidates ? JSON.stringify(bucket.candidates) : null,
      bucket.approved ? JSON.stringify(bucket.approved) : null,
      bucket.gems ? JSON.stringify(bucket.gems) : null,
      bucket.rejected ? JSON.stringify(bucket.rejected) : null,
      bucket.duplicateIds ? JSON.stringify(bucket.duplicateIds) : null,
      bucket.config ? JSON.stringify(bucket.config) : null,
      bucket.threadUri ?? null,
      bucket.stats ? JSON.stringify(bucket.stats) : null,
      bucket.initiatedBy ?? null,
      now,
      now,
      bucket.completedAt ?? null,
      bucket.finalizedAt ?? null
    );
  }

  getHarvestBucket(id: string): Record<string, unknown> | null {
    const row = this.db.prepare(`
      SELECT * FROM harvest_buckets WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.parseHarvestBucketRow(row);
  }

  getHarvestBucketsForBook(bookUri: string): Record<string, unknown>[] {
    const rows = this.db.prepare(`
      SELECT * FROM harvest_buckets WHERE book_uri = ? ORDER BY created_at DESC
    `).all(bookUri) as Record<string, unknown>[];
    return rows.map(row => this.parseHarvestBucketRow(row));
  }

  getAllHarvestBuckets(): Record<string, unknown>[] {
    const rows = this.db.prepare(`
      SELECT * FROM harvest_buckets ORDER BY created_at DESC
    `).all() as Record<string, unknown>[];
    return rows.map(row => this.parseHarvestBucketRow(row));
  }

  deleteHarvestBucket(id: string): void {
    this.db.prepare('DELETE FROM harvest_buckets WHERE id = ?').run(id);
  }

  private parseHarvestBucketRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      bookId: row.book_id,
      bookUri: row.book_uri,
      status: row.status,
      queries: row.queries ? JSON.parse(row.queries as string) : [],
      candidates: row.candidates ? JSON.parse(row.candidates as string) : [],
      approved: row.approved ? JSON.parse(row.approved as string) : [],
      gems: row.gems ? JSON.parse(row.gems as string) : [],
      rejected: row.rejected ? JSON.parse(row.rejected as string) : [],
      duplicateIds: row.duplicate_ids ? JSON.parse(row.duplicate_ids as string) : [],
      config: row.config ? JSON.parse(row.config as string) : {},
      threadUri: row.thread_uri,
      stats: row.stats ? JSON.parse(row.stats as string) : {},
      initiatedBy: row.initiated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      finalizedAt: row.finalized_at,
    };
  }

  // ===========================================================================
  // Narrative Arc Operations
  // ===========================================================================

  upsertNarrativeArc(arc: {
    id: string;
    bookId: string;
    bookUri: string;
    thesis: string;
    arcType?: string;
    evaluationStatus?: string;
    evaluationFeedback?: string;
    evaluatedAt?: number;
    proposedBy?: string;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO narrative_arcs (
        id, book_id, book_uri, thesis, arc_type, evaluation_status, evaluation_feedback,
        evaluated_at, proposed_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        thesis = excluded.thesis,
        arc_type = excluded.arc_type,
        evaluation_status = excluded.evaluation_status,
        evaluation_feedback = excluded.evaluation_feedback,
        evaluated_at = excluded.evaluated_at,
        updated_at = excluded.updated_at
    `).run(
      arc.id,
      arc.bookId,
      arc.bookUri,
      arc.thesis,
      arc.arcType ?? 'thematic',
      arc.evaluationStatus ?? null,
      arc.evaluationFeedback ?? null,
      arc.evaluatedAt ?? null,
      arc.proposedBy ?? null,
      now,
      now
    );
  }

  getNarrativeArc(id: string): Record<string, unknown> | null {
    const row = this.db.prepare(`
      SELECT * FROM narrative_arcs WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.parseNarrativeArcRow(row);
  }

  getNarrativeArcsForBook(bookUri: string): Record<string, unknown>[] {
    const rows = this.db.prepare(`
      SELECT * FROM narrative_arcs WHERE book_uri = ? ORDER BY created_at DESC
    `).all(bookUri) as Record<string, unknown>[];
    return rows.map(row => this.parseNarrativeArcRow(row));
  }

  deleteNarrativeArc(id: string): void {
    this.db.prepare('DELETE FROM narrative_arcs WHERE id = ?').run(id);
  }

  private parseNarrativeArcRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      bookId: row.book_id,
      bookUri: row.book_uri,
      thesis: row.thesis,
      arcType: row.arc_type,
      evaluation: row.evaluation_status ? {
        status: row.evaluation_status,
        feedback: row.evaluation_feedback,
        evaluatedAt: row.evaluated_at,
      } : null,
      proposedBy: row.proposed_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ===========================================================================
  // Passage Link Operations
  // ===========================================================================

  upsertPassageLink(link: {
    id: string;
    passageId: string;
    chapterId: string;
    position: number;
    sectionId?: string;
    usageType?: string;
    createdBy?: string;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO passage_links (
        id, passage_id, chapter_id, position, section_id, usage_type, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        position = excluded.position,
        section_id = excluded.section_id,
        usage_type = excluded.usage_type
    `).run(
      link.id,
      link.passageId,
      link.chapterId,
      link.position,
      link.sectionId ?? null,
      link.usageType ?? 'quote',
      link.createdBy ?? 'user',
      now
    );
  }

  getPassageLinksForChapter(chapterId: string): Record<string, unknown>[] {
    const rows = this.db.prepare(`
      SELECT * FROM passage_links WHERE chapter_id = ? ORDER BY position
    `).all(chapterId) as Record<string, unknown>[];
    return rows.map(row => this.parsePassageLinkRow(row));
  }

  getPassageLinksForPassage(passageId: string): Record<string, unknown>[] {
    const rows = this.db.prepare(`
      SELECT * FROM passage_links WHERE passage_id = ?
    `).all(passageId) as Record<string, unknown>[];
    return rows.map(row => this.parsePassageLinkRow(row));
  }

  deletePassageLink(id: string): void {
    this.db.prepare('DELETE FROM passage_links WHERE id = ?').run(id);
  }

  private parsePassageLinkRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      passageId: row.passage_id,
      chapterId: row.chapter_id,
      position: row.position,
      sectionId: row.section_id,
      usageType: row.usage_type,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }
}

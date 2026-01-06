/**
 * LocalStorageMigration - Migrate localStorage data to Xanadu unified storage
 *
 * Reads data from:
 * - BookshelfService: humanizer-bookshelf-{personas,styles,books}
 * - BookProjectService: humanizer-book-projects, humanizer-book-project-{id}
 *
 * Migrates to:
 * - window.electronAPI.xanadu.{books,personas,styles,passages,chapters}
 */

import type {
  XanaduBook,
  XanaduPersona,
  XanaduStyle,
  XanaduPassage,
  XanaduChapter,
  XanaduChapterVersion,
  CurationStatus,
  BookStatus,
  ChapterStatus,
} from '../../types/electron';

// ═══════════════════════════════════════════════════════════════════
// STORAGE KEYS (matching existing services)
// ═══════════════════════════════════════════════════════════════════

const BOOKSHELF_KEYS = {
  personas: 'humanizer-bookshelf-personas',
  styles: 'humanizer-bookshelf-styles',
  books: 'humanizer-bookshelf-books',
  index: 'humanizer-bookshelf-index',
};

const BOOK_PROJECT_KEYS = {
  projectList: 'humanizer-book-projects',
  project: (id: string) => `humanizer-book-project-${id}`,
};

// ═══════════════════════════════════════════════════════════════════
// MIGRATION RESULT TYPE
// ═══════════════════════════════════════════════════════════════════

export interface MigrationResult {
  success: boolean;
  migrated: {
    personas: number;
    styles: number;
    books: number;
    passages: number;
    chapters: number;
    versions: number;
  };
  skipped: {
    personas: number;
    styles: number;
    books: number;
  };
  errors: Array<{
    type: 'persona' | 'style' | 'book' | 'passage' | 'chapter' | 'version';
    id: string;
    error: string;
  }>;
  duration: number;
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATION SERVICE
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if migration has been completed
 */
export function isMigrationComplete(): boolean {
  return localStorage.getItem('xanadu-migration-complete') === 'true';
}

/**
 * Mark migration as complete
 */
export function markMigrationComplete(): void {
  localStorage.setItem('xanadu-migration-complete', 'true');
  localStorage.setItem('xanadu-migration-date', new Date().toISOString());
}

/**
 * Check if there's any localStorage data to migrate
 */
export function hasDataToMigrate(): boolean {
  const hasBookshelfPersonas = localStorage.getItem(BOOKSHELF_KEYS.personas) !== null;
  const hasBookshelfStyles = localStorage.getItem(BOOKSHELF_KEYS.styles) !== null;
  const hasBookshelfBooks = localStorage.getItem(BOOKSHELF_KEYS.books) !== null;
  const hasBookProjects = localStorage.getItem(BOOK_PROJECT_KEYS.projectList) !== null;

  return hasBookshelfPersonas || hasBookshelfStyles || hasBookshelfBooks || hasBookProjects;
}

/**
 * Migrate all localStorage data to Xanadu unified storage
 */
export async function migrateToUnifiedStorage(options: {
  clearAfterMigration?: boolean;
  skipIfComplete?: boolean;
} = {}): Promise<MigrationResult> {
  const startTime = Date.now();
  const { clearAfterMigration = false, skipIfComplete = true } = options;

  // Check if already migrated
  if (skipIfComplete && isMigrationComplete()) {
    return {
      success: true,
      migrated: { personas: 0, styles: 0, books: 0, passages: 0, chapters: 0, versions: 0 },
      skipped: { personas: 0, styles: 0, books: 0 },
      errors: [],
      duration: 0,
    };
  }

  // Ensure we're in Electron
  if (!window.electronAPI?.xanadu) {
    console.error('[Migration] Xanadu API not available');
    return {
      success: false,
      migrated: { personas: 0, styles: 0, books: 0, passages: 0, chapters: 0, versions: 0 },
      skipped: { personas: 0, styles: 0, books: 0 },
      errors: [{ type: 'book', id: 'init', error: 'Xanadu API not available' }],
      duration: Date.now() - startTime,
    };
  }

  const result: MigrationResult = {
    success: true,
    migrated: { personas: 0, styles: 0, books: 0, passages: 0, chapters: 0, versions: 0 },
    skipped: { personas: 0, styles: 0, books: 0 },
    errors: [],
    duration: 0,
  };

  try {
    // Seed library data first
    console.log('[Migration] Seeding library data...');
    await window.electronAPI!.xanadu.seedLibrary();

    // Migrate personas
    await migratePersonas(result);

    // Migrate styles
    await migrateStyles(result);

    // Migrate books from BookshelfService
    await migrateBookshelfBooks(result);

    // Migrate books from BookProjectService (may have more detail)
    await migrateBookProjects(result);

    // Mark as complete
    markMigrationComplete();

    // Optionally clear localStorage
    if (clearAfterMigration && result.errors.length === 0) {
      clearLocalStorage();
    }

    result.success = result.errors.length === 0;
  } catch (error) {
    result.success = false;
    result.errors.push({
      type: 'book',
      id: 'global',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  result.duration = Date.now() - startTime;
  console.log('[Migration] Complete:', result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// INDIVIDUAL MIGRATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

async function migratePersonas(result: MigrationResult): Promise<void> {
  const personasJson = localStorage.getItem(BOOKSHELF_KEYS.personas);
  if (!personasJson) return;

  try {
    const personas = JSON.parse(personasJson) as unknown[];
    console.log(`[Migration] Migrating ${personas.length} personas...`);

    for (const persona of personas) {
      try {
        const p = persona as Record<string, unknown>;

        // Skip library personas (they're seeded)
        if (p.uri && (p.uri as string).includes('tem-noon/')) {
          result.skipped.personas++;
          continue;
        }

        const xanaduPersona: Partial<XanaduPersona> & { id: string; uri: string; name: string } = {
          id: (p.id as string) || generateId(),
          uri: (p.uri as string) || `persona://user/${slugify(p.name as string)}`,
          name: p.name as string,
          description: p.description as string | undefined,
          author: p.author as string | undefined,
          voice: p.voice,
          vocabulary: p.vocabulary,
          derivedFrom: p.derivedFrom as unknown[],
          influences: p.influences as unknown[],
          exemplars: p.exemplars as unknown[],
          systemPrompt: p.systemPrompt as string | undefined,
          tags: p.tags as string[] | undefined,
        };

        await window.electronAPI!.xanadu.personas.upsert(xanaduPersona);
        result.migrated.personas++;
      } catch (error) {
        result.errors.push({
          type: 'persona',
          id: (persona as Record<string, unknown>).id as string || 'unknown',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  } catch (error) {
    result.errors.push({
      type: 'persona',
      id: 'parse',
      error: 'Failed to parse personas from localStorage',
    });
  }
}

async function migrateStyles(result: MigrationResult): Promise<void> {
  const stylesJson = localStorage.getItem(BOOKSHELF_KEYS.styles);
  if (!stylesJson) return;

  try {
    const styles = JSON.parse(stylesJson) as unknown[];
    console.log(`[Migration] Migrating ${styles.length} styles...`);

    for (const style of styles) {
      try {
        const s = style as Record<string, unknown>;

        // Skip library styles
        if (s.uri && (s.uri as string).includes('tem-noon/')) {
          result.skipped.styles++;
          continue;
        }

        const xanaduStyle: Partial<XanaduStyle> & { id: string; uri: string; name: string } = {
          id: (s.id as string) || generateId(),
          uri: (s.uri as string) || `style://user/${slugify(s.name as string)}`,
          name: s.name as string,
          description: s.description as string | undefined,
          author: s.author as string | undefined,
          characteristics: s.characteristics,
          structure: s.structure,
          stylePrompt: s.stylePrompt as string | undefined,
          derivedFrom: s.derivedFrom as unknown[],
          tags: s.tags as string[] | undefined,
        };

        await window.electronAPI!.xanadu.styles.upsert(xanaduStyle);
        result.migrated.styles++;
      } catch (error) {
        result.errors.push({
          type: 'style',
          id: (style as Record<string, unknown>).id as string || 'unknown',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  } catch (error) {
    result.errors.push({
      type: 'style',
      id: 'parse',
      error: 'Failed to parse styles from localStorage',
    });
  }
}

async function migrateBookshelfBooks(result: MigrationResult): Promise<void> {
  const booksJson = localStorage.getItem(BOOKSHELF_KEYS.books);
  if (!booksJson) return;

  try {
    const books = JSON.parse(booksJson) as unknown[];
    console.log(`[Migration] Migrating ${books.length} bookshelf books...`);

    for (const book of books) {
      try {
        const b = book as Record<string, unknown>;

        // Skip library books
        if (b.uri && (b.uri as string).includes('tem-noon/')) {
          result.skipped.books++;
          continue;
        }

        await migrateBook(b, result);
      } catch (error) {
        result.errors.push({
          type: 'book',
          id: (book as Record<string, unknown>).id as string || 'unknown',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  } catch (error) {
    result.errors.push({
      type: 'book',
      id: 'parse',
      error: 'Failed to parse bookshelf books from localStorage',
    });
  }
}

async function migrateBookProjects(result: MigrationResult): Promise<void> {
  const projectListJson = localStorage.getItem(BOOK_PROJECT_KEYS.projectList);
  if (!projectListJson) return;

  try {
    const projectIds = JSON.parse(projectListJson) as string[];
    console.log(`[Migration] Migrating ${projectIds.length} book projects...`);

    for (const projectId of projectIds) {
      try {
        const projectJson = localStorage.getItem(BOOK_PROJECT_KEYS.project(projectId));
        if (!projectJson) continue;

        const project = JSON.parse(projectJson) as Record<string, unknown>;

        // Skip library books
        if (project.uri && (project.uri as string).includes('tem-noon/')) {
          result.skipped.books++;
          continue;
        }

        await migrateBook(project, result);
      } catch (error) {
        result.errors.push({
          type: 'book',
          id: projectId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  } catch (error) {
    result.errors.push({
      type: 'book',
      id: 'parse',
      error: 'Failed to parse book project list from localStorage',
    });
  }
}

async function migrateBook(book: Record<string, unknown>, result: MigrationResult): Promise<void> {
  const bookId = (book.id as string) || generateId();
  const bookUri = (book.uri as string) || `book://user/${slugify(book.name as string)}`;

  // Create the book
  const xanaduBook: Partial<XanaduBook> & { id: string; uri: string; name: string } = {
    id: bookId,
    uri: bookUri,
    name: book.name as string,
    subtitle: book.subtitle as string | undefined,
    author: book.author as string | undefined,
    description: book.description as string | undefined,
    status: (book.status as BookStatus) || 'harvesting',
    personaRefs: book.personaRefs as string[] | undefined,
    styleRefs: book.styleRefs as string[] | undefined,
    sourceRefs: book.sourceRefs as unknown[],
    threads: book.threads as unknown[],
    harvestConfig: book.harvestConfig,
    editorial: book.editorial,
    thinking: book.thinking,
    stats: book.stats,
    profile: book.profile,
    tags: book.tags as string[] | undefined,
  };

  await window.electronAPI!.xanadu.books.upsert(xanaduBook);
  result.migrated.books++;

  // Migrate passages
  const passages = (book.passages || (book.sources as Record<string, unknown>)?.passages || []) as unknown[];
  for (const passage of passages) {
    try {
      const p = passage as Record<string, unknown>;
      const curation = p.curation as Record<string, unknown> | undefined;

      const xanaduPassage: Partial<XanaduPassage> & { id: string; bookId: string; text: string } = {
        id: (p.id as string) || generateId(),
        bookId,
        sourceRef: p.sourceRef,
        text: (p.text as string) || (p.content as string) || '',
        wordCount: p.wordCount as number | undefined,
        role: p.role as string | undefined,
        harvestedBy: p.harvestedBy as string | undefined,
        threadId: p.threadId as string | undefined,
        curationStatus: ((curation?.status || p.status || 'candidate') as CurationStatus),
        curationNote: curation?.note as string | undefined,
        tags: p.tags as string[] | undefined,
      };

      await window.electronAPI!.xanadu.passages.upsert(xanaduPassage);
      result.migrated.passages++;
    } catch (error) {
      result.errors.push({
        type: 'passage',
        id: (passage as Record<string, unknown>).id as string || 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Migrate chapters
  const chapters = (book.chapters || (book.drafts as Record<string, unknown>)?.chapters || []) as unknown[];
  for (const chapter of chapters) {
    try {
      const c = chapter as Record<string, unknown>;
      const chapterId = (c.id as string) || generateId();

      const xanaduChapter: Partial<XanaduChapter> & { id: string; bookId: string; number: number; title: string } = {
        id: chapterId,
        bookId,
        number: (c.number as number) || 1,
        title: c.title as string,
        content: c.content as string | undefined,
        wordCount: c.wordCount as number | undefined,
        version: c.version as number | undefined,
        status: ((c.status || 'draft') as ChapterStatus),
        epigraph: (c.epigraph as Record<string, unknown>)?.text as string | undefined,
        sections: c.sections as unknown[],
        marginalia: c.marginalia as unknown[],
        metadata: c.metadata,
        passageRefs: c.passageRefs as string[] | undefined,
      };

      await window.electronAPI!.xanadu.chapters.upsert(xanaduChapter);
      result.migrated.chapters++;

      // Migrate version history
      const versions = (c.versions || []) as unknown[];
      for (const version of versions) {
        try {
          const v = version as Record<string, unknown>;
          await window.electronAPI!.xanadu.versions.save(
            chapterId,
            v.version as number,
            v.content as string,
            v.changes as string | undefined,
            v.createdBy as string | undefined
          );
          result.migrated.versions++;
        } catch (error) {
          result.errors.push({
            type: 'version',
            id: `${chapterId}-v${(version as Record<string, unknown>).version}`,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    } catch (error) {
      result.errors.push({
        type: 'chapter',
        id: (chapter as Record<string, unknown>).id as string || 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════

/**
 * Clear localStorage data after successful migration
 */
function clearLocalStorage(): void {
  console.log('[Migration] Clearing localStorage...');

  // Clear bookshelf data
  localStorage.removeItem(BOOKSHELF_KEYS.personas);
  localStorage.removeItem(BOOKSHELF_KEYS.styles);
  localStorage.removeItem(BOOKSHELF_KEYS.books);
  localStorage.removeItem(BOOKSHELF_KEYS.index);

  // Clear book project data
  const projectListJson = localStorage.getItem(BOOK_PROJECT_KEYS.projectList);
  if (projectListJson) {
    try {
      const projectIds = JSON.parse(projectListJson) as string[];
      for (const id of projectIds) {
        localStorage.removeItem(BOOK_PROJECT_KEYS.project(id));
      }
    } catch {
      // Ignore parse errors
    }
  }
  localStorage.removeItem(BOOK_PROJECT_KEYS.projectList);
}

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

export default {
  migrateToUnifiedStorage,
  isMigrationComplete,
  markMigrationComplete,
  hasDataToMigrate,
};

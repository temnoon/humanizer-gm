/**
 * AUI Context Builder
 *
 * Builds a complete AUIContext from BookshelfContext and workspace state.
 * This bridges the gap between React contexts and AUI tool execution.
 *
 * NOTE: BookContext has been consolidated into BookshelfContext.
 * The "Simple" methods in BookshelfContext operate on the activeBook automatically.
 */

import type { AUIContext, WorkspaceState } from './tools';
import type { BookProject, DraftChapter, SourcePassage, CurationStatus } from '../bookshelf/types';
import type { PinnedContent } from '../buffer/pins';

/**
 * @deprecated Use BookshelfContextValue instead. BookContext is being consolidated.
 */
interface BookContextValue {
  activeProject: BookProject | null;
  createProject: (name: string, subtitle?: string) => BookProject;
  updateChapter: (chapterId: string, content: string, changes?: string) => void;
  createChapter: (title: string, content?: string) => DraftChapter | null;
  deleteChapter: (chapterId: string) => void;
  renderBook: () => string;
  getChapter: (chapterId: string) => DraftChapter | null;
  getPassages: () => SourcePassage[];
  addPassage: (passage: {
    content: string;
    conversationId?: string;
    conversationTitle: string;
    role?: 'user' | 'assistant';
    tags?: string[];
  }) => SourcePassage | null;
  updatePassage: (passageId: string, updates: Partial<SourcePassage>) => void;
}

/**
 * Bookshelf context interface (from BookshelfContext)
 * Now includes "Simple" methods that operate on activeBook automatically.
 * Methods may return Promises when using Xanadu unified storage.
 */
interface BookshelfContextValue {
  activeBookUri: string | null;
  activeBook: BookProject | null;

  // URI-based passage operations
  getPassages: (bookUri: string) => SourcePassage[];
  addPassageToBook: (bookUri: string, passage: SourcePassage) => BookProject | undefined | Promise<BookProject | undefined>;
  updatePassageStatus: (bookUri: string, passageId: string, status: CurationStatus) => BookProject | undefined | Promise<BookProject | undefined>;

  // Simple chapter operations (use activeBookUri)
  createChapterSimple?: (title: string, content?: string) => Promise<DraftChapter | undefined>;
  updateChapterSimple?: (chapterId: string, content: string, changes?: string) => Promise<void>;
  deleteChapterSimple?: (chapterId: string) => Promise<void>;
  getChapterSimple?: (chapterId: string) => DraftChapter | undefined;
  renderActiveBook?: () => string;

  // Simple passage operations (use activeBookUri)
  addPassageSimple?: (passage: {
    content: string;
    conversationId?: string;
    conversationTitle: string;
    role?: 'user' | 'assistant';
    tags?: string[];
  }) => Promise<SourcePassage | undefined>;
  updatePassageSimple?: (passageId: string, updates: Partial<SourcePassage>) => Promise<void>;
  getPassagesSimple?: () => SourcePassage[];
}

/**
 * Build a complete AUIContext from React contexts
 *
 * @param book - BookContext value (deprecated - prefer bookshelf)
 * @param bookshelf - BookshelfContext value (primary source)
 * @param workspace - Current workspace state
 * @param pinnedContent - Currently pinned content items
 * @returns Complete AUIContext for tool execution
 */
export function buildAUIContext(
  book: BookContextValue | null,
  bookshelf: BookshelfContextValue | null,
  workspace?: WorkspaceState,
  pinnedContent?: PinnedContent[]
): AUIContext {
  // Prefer bookshelf's activeBook (unified storage)
  const activeProject = bookshelf?.activeBook || book?.activeProject || null;

  return {
    // Book operations
    activeProject,

    createProject: (name: string, subtitle?: string) => {
      // BookContext deprecated - return minimal fallback
      if (book?.createProject) {
        return book.createProject(name, subtitle);
      }
      console.warn('[AUIContext] No createProject available - use createBook from bookshelf');
      return {
        id: `project-${Date.now()}`,
        name,
        subtitle,
        status: 'harvesting',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sources: { conversations: [], passages: [], threads: [] },
        thinking: { decisions: [], context: { recentQueries: [], pinnedConcepts: [], auiNotes: [] } },
        drafts: { chapters: [] },
        stats: { totalConversations: 0, totalPassages: 0, approvedPassages: 0, gems: 0, chapters: 0, wordCount: 0 },
      } as unknown as BookProject;
    },

    updateChapter: (chapterId: string, content: string, changes?: string) => {
      // Prefer bookshelf's simple method
      if (bookshelf?.updateChapterSimple) {
        void bookshelf.updateChapterSimple(chapterId, content, changes);
        return;
      }
      if (book?.updateChapter) {
        book.updateChapter(chapterId, content, changes);
      } else {
        console.warn('[AUIContext] No updateChapter available');
      }
    },

    createChapter: (title: string, content?: string) => {
      // Prefer bookshelf's simple method (async, but returns sync for interface compat)
      if (bookshelf?.createChapterSimple) {
        // Fire and forget for sync interface - callers should use async version
        void bookshelf.createChapterSimple(title, content);
        // Return placeholder - actual chapter created async
        return {
          id: `ch-${Date.now()}`,
          number: 1,
          title,
          content: content || `# ${title}\n\n`,
          wordCount: 0,
          version: 1,
          versions: [],
          status: 'outline',
        } as DraftChapter;
      }
      if (book?.createChapter) {
        return book.createChapter(title, content);
      }
      console.warn('[AUIContext] No createChapter available');
      return null;
    },

    deleteChapter: (chapterId: string) => {
      // Prefer bookshelf's simple method
      if (bookshelf?.deleteChapterSimple) {
        void bookshelf.deleteChapterSimple(chapterId);
        return;
      }
      if (book?.deleteChapter) {
        book.deleteChapter(chapterId);
      } else {
        console.warn('[AUIContext] No deleteChapter available');
      }
    },

    renderBook: () => {
      // Prefer bookshelf's method
      if (bookshelf?.renderActiveBook) {
        return bookshelf.renderActiveBook();
      }
      if (book?.renderBook) {
        return book.renderBook();
      }
      console.warn('[AUIContext] No renderBook available');
      return '';
    },

    getChapter: (chapterId: string) => {
      // Prefer bookshelf's simple method
      if (bookshelf?.getChapterSimple) {
        return bookshelf.getChapterSimple(chapterId) || null;
      }
      if (book?.getChapter) {
        return book.getChapter(chapterId);
      }
      console.warn('[AUIContext] No getChapter available');
      return null;
    },

    // Passage operations
    addPassage: (passage) => {
      // Prefer bookshelf's simple method
      if (bookshelf?.addPassageSimple) {
        // Fire and forget for sync interface
        void bookshelf.addPassageSimple(passage);
        // Return placeholder
        return {
          id: `passage-${Date.now()}`,
          text: passage.content,
          wordCount: passage.content.split(/\s+/).length,
          sourceRef: {
            uri: `source://chatgpt/${passage.conversationId || 'unknown'}` as `${string}://${string}`,
            sourceType: 'chatgpt',
            label: passage.conversationTitle,
          },
          curation: { status: 'candidate' },
          tags: passage.tags || [],
        } as unknown as SourcePassage;
      }
      if (book?.addPassage) {
        return book.addPassage(passage);
      }
      // Fallback to bookshelf URI-based
      if (bookshelf?.activeBookUri && bookshelf?.addPassageToBook) {
        const sourcePassage: SourcePassage = {
          id: `passage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          text: passage.content,
          wordCount: passage.content.split(/\s+/).length,
          sourceRef: {
            uri: `source://chatgpt/${passage.conversationId || 'unknown'}` as `${string}://${string}`,
            sourceType: 'chatgpt',
            label: passage.conversationTitle,
          },
          curation: {
            status: 'candidate',
            curatedAt: Date.now(),
          },
          tags: [],
        };
        const result = bookshelf.addPassageToBook(bookshelf.activeBookUri, sourcePassage);
        return result ? sourcePassage : null;
      }
      console.warn('[AUIContext] No addPassage available');
      return null;
    },

    updatePassage: (passageId: string, updates: Partial<SourcePassage>) => {
      // Prefer bookshelf's simple method
      if (bookshelf?.updatePassageSimple) {
        void bookshelf.updatePassageSimple(passageId, updates);
        return;
      }
      if (book?.updatePassage) {
        book.updatePassage(passageId, updates);
      } else if (bookshelf?.activeBookUri && updates.curation?.status) {
        bookshelf.updatePassageStatus(bookshelf.activeBookUri, passageId, updates.curation.status);
      } else {
        console.warn('[AUIContext] No updatePassage available');
      }
    },

    getPassages: () => {
      // Prefer bookshelf's simple method
      if (bookshelf?.getPassagesSimple) {
        return bookshelf.getPassagesSimple();
      }
      if (book?.getPassages) {
        return book.getPassages();
      }
      if (bookshelf?.activeBookUri) {
        return bookshelf.getPassages(bookshelf.activeBookUri);
      }
      return [];
    },

    // Workspace state
    workspace: workspace || {
      bufferContent: null,
      bufferName: null,
      selectedMedia: null,
      selectedContent: null,
      viewMode: 'text',
      selectedContainer: null,
    },

    // Pinned content
    pinnedContent: pinnedContent || [],
  };
}

/**
 * Create a minimal AUIContext for tools that don't need full book access
 */
export function buildMinimalAUIContext(workspace?: WorkspaceState): AUIContext {
  return {
    activeProject: null,
    updateChapter: () => console.warn('[AUIContext] No book context'),
    createChapter: () => null,
    deleteChapter: () => console.warn('[AUIContext] No book context'),
    renderBook: () => '',
    getChapter: () => null,
    addPassage: () => null,
    updatePassage: () => {},
    getPassages: () => [],
    workspace: workspace || {
      bufferContent: null,
      bufferName: null,
      selectedMedia: null,
      selectedContent: null,
      viewMode: 'text',
      selectedContainer: null,
    },
    pinnedContent: [],
  };
}

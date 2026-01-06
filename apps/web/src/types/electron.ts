/**
 * Electron API Type Declarations
 *
 * Re-exports types from electron/preload.ts for use in renderer process.
 * Declares window.electronAPI global for TypeScript.
 */

// ═══════════════════════════════════════════════════════════════════
// XANADU TYPES
// ═══════════════════════════════════════════════════════════════════

// Extended status types to match @humanizer/core
export type CurationStatus = 'candidate' | 'approved' | 'rejected' | 'gem' | 'needs-work' | 'unreviewed';
export type BookStatus = 'harvesting' | 'drafting' | 'revising' | 'mastering' | 'complete' | 'curating';
export type ChapterStatus = 'outline' | 'draft' | 'revision' | 'final' | 'drafting' | 'revising' | 'complete';

export interface XanaduBook {
  id: string;
  uri: string;
  name: string;
  subtitle?: string;
  author?: string;
  description?: string;
  status: BookStatus;
  bookType?: 'book' | 'paper';
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
  // Nested chapters (loaded from separate table but exposed here)
  chapters?: XanaduChapter[];
  passages?: XanaduPassage[];
  createdAt: number;
  updatedAt: number;
}

export interface XanaduPersona {
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
  embedding?: ArrayBuffer;
  embeddingModel?: string;
  tags?: string[];
  isLibrary?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface XanaduStyle {
  id: string;
  uri: string;
  name: string;
  description?: string;
  author?: string;
  characteristics?: unknown;
  structure?: unknown;
  stylePrompt?: string;
  derivedFrom?: unknown[];
  embedding?: ArrayBuffer;
  embeddingModel?: string;
  tags?: string[];
  isLibrary?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface XanaduPassage {
  id: string;
  bookId: string;
  sourceRef?: unknown;
  text: string;
  wordCount?: number;
  role?: string;
  harvestedBy?: string;
  threadId?: string;
  curationStatus: CurationStatus;
  curationNote?: string;
  chapterId?: string;
  tags?: string[];
  embedding?: ArrayBuffer;
  embeddingModel?: string;
  createdAt: number;
}

export interface XanaduChapter {
  id: string;
  bookId: string;
  number: number;
  title: string;
  content?: string;
  wordCount?: number;
  version?: number;
  status: ChapterStatus;
  epigraph?: string;
  sections?: unknown[];
  marginalia?: unknown[];
  metadata?: unknown;
  passageRefs?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface XanaduChapterVersion {
  id: string;
  chapterId: string;
  version: number;
  content: string;
  wordCount?: number;
  changes?: string;
  createdBy?: string;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════
// XANADU API
// ═══════════════════════════════════════════════════════════════════

export interface XanaduAPI {
  books: {
    list: (includeLibrary?: boolean) => Promise<XanaduBook[]>;
    get: (idOrUri: string) => Promise<XanaduBook | null>;
    upsert: (book: Partial<XanaduBook> & { id: string; uri: string; name: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  personas: {
    list: (includeLibrary?: boolean) => Promise<XanaduPersona[]>;
    get: (idOrUri: string) => Promise<XanaduPersona | null>;
    upsert: (persona: Partial<XanaduPersona> & { id: string; uri: string; name: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  styles: {
    list: (includeLibrary?: boolean) => Promise<XanaduStyle[]>;
    get: (idOrUri: string) => Promise<XanaduStyle | null>;
    upsert: (style: Partial<XanaduStyle> & { id: string; uri: string; name: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  passages: {
    list: (bookId: string, curationStatus?: CurationStatus) => Promise<XanaduPassage[]>;
    upsert: (passage: Partial<XanaduPassage> & { id: string; bookId: string; text: string }) => Promise<{ success: boolean; id: string }>;
    curate: (id: string, status: CurationStatus, note?: string) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  chapters: {
    list: (bookId: string) => Promise<XanaduChapter[]>;
    get: (id: string) => Promise<XanaduChapter | null>;
    upsert: (chapter: Partial<XanaduChapter> & { id: string; bookId: string; number: number; title: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  versions: {
    list: (chapterId: string) => Promise<XanaduChapterVersion[]>;
    save: (chapterId: string, version: number, content: string, changes?: string, createdBy?: string) => Promise<{ success: boolean }>;
  };

  seedLibrary: () => Promise<{ success: boolean; alreadySeeded?: boolean; error?: string }>;
}

// ═══════════════════════════════════════════════════════════════════
// ELECTRON API (minimal for migration)
// ═══════════════════════════════════════════════════════════════════

export interface ElectronAPI {
  xanadu: XanaduAPI;
  // Add other APIs as needed
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL DECLARATION
// ═══════════════════════════════════════════════════════════════════

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    isElectron?: boolean;
  }
}

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

// Harvest bucket types
export type HarvestBucketStatus = 'collecting' | 'reviewing' | 'staged' | 'committed' | 'discarded';
export type NarrativeArcType = 'thematic' | 'chronological' | 'argumentative' | 'character';
export type PassageLinkUsageType = 'quote' | 'reference' | 'paraphrase' | 'inspiration';

export interface XanaduHarvestBucket {
  id: string;
  bookId: string;
  bookUri: string;
  status: HarvestBucketStatus;
  queries?: string[];
  candidates?: unknown[];
  approved?: unknown[];
  gems?: unknown[];
  rejected?: unknown[];
  duplicateIds?: string[];
  config?: unknown;
  threadUri?: string;
  stats?: unknown;
  initiatedBy?: 'user' | 'aui';
  createdAt: number;
  updatedAt?: number;
  completedAt?: number;
  finalizedAt?: number;
}

export interface XanaduNarrativeArc {
  id: string;
  bookId: string;
  bookUri: string;
  thesis: string;
  arcType: NarrativeArcType;
  evaluation?: {
    status: 'pending' | 'approved' | 'rejected';
    feedback?: string;
    evaluatedAt?: number;
  };
  proposedBy?: 'user' | 'aui';
  createdAt: number;
  updatedAt?: number;
}

export interface XanaduPassageLink {
  id: string;
  passageId: string;
  chapterId: string;
  position: number;
  sectionId?: string;
  usageType: PassageLinkUsageType;
  createdBy?: 'user' | 'aui';
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════
// HARVEST CURATION RESULT TYPES
// ═══════════════════════════════════════════════════════════════════

export interface HarvestCurationResult {
  success: boolean;
  error?: string;
  fromArray?: string;
}

export interface HarvestStageResult {
  success: boolean;
  error?: string;
  approvedCount?: number;
  gemCount?: number;
}

export interface HarvestCommitResult {
  success: boolean;
  error?: string;
  passageCount?: number;
}

// ═══════════════════════════════════════════════════════════════════
// XANADU API
// ═══════════════════════════════════════════════════════════════════

export interface XanaduAPI {
  // Harvest curation operations (atomic passage moves + lifecycle)
  harvest: {
    approvePassage: (bucketId: string, passageId: string) => Promise<HarvestCurationResult>;
    rejectPassage: (bucketId: string, passageId: string, reason?: string) => Promise<HarvestCurationResult>;
    gemPassage: (bucketId: string, passageId: string) => Promise<HarvestCurationResult>;
    undoPassage: (bucketId: string, passageId: string) => Promise<HarvestCurationResult>;
    finishCollecting: (bucketId: string) => Promise<{ success: boolean; error?: string }>;
    stageBucket: (bucketId: string) => Promise<HarvestStageResult>;
    commitBucket: (bucketId: string) => Promise<HarvestCommitResult>;
    discardBucket: (bucketId: string) => Promise<{ success: boolean; error?: string }>;
  };

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

  harvestBuckets: {
    list: (bookUri?: string) => Promise<XanaduHarvestBucket[]>;
    get: (id: string) => Promise<XanaduHarvestBucket | null>;
    upsert: (bucket: Partial<XanaduHarvestBucket> & { id: string; bookId: string; bookUri: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  narrativeArcs: {
    list: (bookUri: string) => Promise<XanaduNarrativeArc[]>;
    get: (id: string) => Promise<XanaduNarrativeArc | null>;
    upsert: (arc: Partial<XanaduNarrativeArc> & { id: string; bookId: string; bookUri: string; thesis: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  passageLinks: {
    listByChapter: (chapterId: string) => Promise<XanaduPassageLink[]>;
    listByPassage: (passageId: string) => Promise<XanaduPassageLink[]>;
    upsert: (link: Partial<XanaduPassageLink> & { id: string; passageId: string; chapterId: string; position: number }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
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

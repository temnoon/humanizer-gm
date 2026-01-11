/**
 * Xanadu Unified Storage Types
 *
 * Types for books, personas, styles, passages, chapters, harvest buckets,
 * narrative arcs, analysis, and draft generation
 */

export type CurationStatus = 'candidate' | 'approved' | 'rejected' | 'gem' | 'needs-work';
export type BookStatus = 'harvesting' | 'drafting' | 'revising' | 'mastering' | 'complete';
export type ChapterStatus = 'outline' | 'draft' | 'revision' | 'final';

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

// Harvest curation result types
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

// Analysis types
export interface AnalysisConfig {
  bookId?: string;
  bookTheme?: string;
  enableQuantum?: boolean;
  enableAiDetection?: boolean;
  enableResonance?: boolean;
  model?: 'local' | 'cloud';
}

export interface PassageAnalysis {
  passageId: string;
  text: string;
  quantum: {
    stance: 'literal' | 'metaphorical' | 'both' | 'neither';
    probabilities: { literal: number; metaphorical: number; both: number; neither: number };
    entropy: number;
  };
  aiDetection: {
    score: number;
    confidence: number;
    features: { burstiness: number; vocabularyDiversity: number; avgSentenceLength: number; tellPhraseCount: number };
  };
  resonance: {
    score: number;
    matchedThemes: string[];
  };
  recommendation: {
    action: 'approve' | 'gem' | 'reject' | 'review';
    confidence: number;
    reasons: string[];
  };
  analyzedAt: number;
}

export interface AnalysisResult {
  success: boolean;
  error?: string;
  analysis?: PassageAnalysis;
}

export interface AnalysisResultBatch {
  success: boolean;
  error?: string;
  analyses?: PassageAnalysis[];
}

// Draft generation types
export type DraftJobStatus = 'pending' | 'generating' | 'paused' | 'complete' | 'failed';
export type DraftStyle = 'academic' | 'narrative' | 'conversational';

export interface DraftProgress {
  jobId: string;
  chapterTitle: string;
  currentSection: number;
  totalSections: number;
  wordsGenerated: number;
  targetWords: number;
  percentComplete: number;
  status: DraftJobStatus;
  sectionComplete?: boolean;
  elapsedMs: number;
  estimatedRemainingMs?: number;
}

export interface DraftEvent {
  type: 'job:started' | 'job:progress' | 'section:started' | 'section:complete' | 'job:complete' | 'job:paused' | 'job:resumed' | 'job:failed';
  jobId: string;
  timestamp: number;
  progress?: DraftProgress;
  section?: {
    index: number;
    title?: string;
    passageIds: string[];
    targetWords: number;
    status: 'pending' | 'generating' | 'complete' | 'failed';
    content?: string;
    wordCount?: number;
    error?: string;
  };
  error?: string;
}

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

  // Book operations
  books: {
    list: (includeLibrary?: boolean) => Promise<XanaduBook[]>;
    get: (idOrUri: string) => Promise<XanaduBook | null>;
    upsert: (book: Partial<XanaduBook> & { id: string; uri: string; name: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Persona operations
  personas: {
    list: (includeLibrary?: boolean) => Promise<XanaduPersona[]>;
    get: (idOrUri: string) => Promise<XanaduPersona | null>;
    upsert: (persona: Partial<XanaduPersona> & { id: string; uri: string; name: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Style operations
  styles: {
    list: (includeLibrary?: boolean) => Promise<XanaduStyle[]>;
    get: (idOrUri: string) => Promise<XanaduStyle | null>;
    upsert: (style: Partial<XanaduStyle> & { id: string; uri: string; name: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Passage operations
  passages: {
    list: (bookId: string, curationStatus?: CurationStatus) => Promise<XanaduPassage[]>;
    upsert: (passage: Partial<XanaduPassage> & { id: string; bookId: string; text: string }) => Promise<{ success: boolean; id: string }>;
    curate: (id: string, status: CurationStatus, note?: string) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Chapter operations
  chapters: {
    list: (bookId: string) => Promise<XanaduChapter[]>;
    get: (id: string) => Promise<XanaduChapter | null>;
    upsert: (chapter: Partial<XanaduChapter> & { id: string; bookId: string; number: number; title: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
    fill: (chapterId: string, bookId: string, options?: { style?: string; targetWords?: number; additionalQueries?: string[] }) => Promise<{
      success: boolean;
      chapter?: { id: string; title: string; content: string; wordCount: number };
      stats?: { passagesFound: number; passagesUsed: number; generationTimeMs: number; queriesUsed: string[] };
      error?: string;
    }>;
  };

  // Version operations
  versions: {
    list: (chapterId: string) => Promise<XanaduChapterVersion[]>;
    save: (chapterId: string, version: number, content: string, changes?: string, createdBy?: string) => Promise<{ success: boolean }>;
  };

  // Harvest bucket operations
  harvestBuckets: {
    list: (bookUri?: string) => Promise<XanaduHarvestBucket[]>;
    get: (id: string) => Promise<XanaduHarvestBucket | null>;
    upsert: (bucket: Partial<XanaduHarvestBucket> & { id: string; bookId: string; bookUri: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Narrative arc operations
  narrativeArcs: {
    list: (bookUri: string) => Promise<XanaduNarrativeArc[]>;
    get: (id: string) => Promise<XanaduNarrativeArc | null>;
    upsert: (arc: Partial<XanaduNarrativeArc> & { id: string; bookId: string; bookUri: string; thesis: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Passage link operations
  passageLinks: {
    listByChapter: (chapterId: string) => Promise<XanaduPassageLink[]>;
    listByPassage: (passageId: string) => Promise<XanaduPassageLink[]>;
    upsert: (link: Partial<XanaduPassageLink> & { id: string; passageId: string; chapterId: string; position: number }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Passage analysis operations
  analyze: {
    passage: (passageId: string, text: string, config?: AnalysisConfig) => Promise<AnalysisResult>;
    passages: (passages: Array<{ id: string; text: string }>, config?: AnalysisConfig) => Promise<AnalysisResultBatch>;
  };

  // Library seeding
  seedLibrary: () => Promise<{ success: boolean; alreadySeeded?: boolean; error?: string }>;

  // Draft generation
  draft: {
    start: (params: {
      bookUri: string;
      chapterId: string;
      arcId?: string;
      style?: DraftStyle;
      wordsPerSection?: number;
    }) => Promise<{ success: boolean; job?: { id: string; sections: number; totalWords: number; estimatedTimeSeconds: number }; error?: string }>;
    pause: (jobId: string) => Promise<{ success: boolean; error?: string }>;
    resume: (jobId: string) => Promise<{ success: boolean; error?: string }>;
    status: (jobId: string) => Promise<{ success: boolean; job?: unknown; progress?: DraftProgress; error?: string }>;
    list: () => Promise<{ success: boolean; jobs?: unknown[]; error?: string }>;
    onProgress: (callback: (progress: DraftProgress) => void) => () => void;
    onEvent: (callback: (event: DraftEvent) => void) => () => void;
  };
}

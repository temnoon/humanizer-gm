/**
 * Draft Generation Types
 *
 * Types for the iterative draft generation system that breaks chapters
 * into sections and generates each section sequentially to work within
 * LLM context limits.
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Maximum passages per section (context budget) */
export const PASSAGES_PER_SECTION = 6;

/** Target words per section (quality sweet spot) */
export const WORDS_PER_SECTION = 1500;

/** Maximum chars per passage in prompt (truncation limit) */
export const MAX_CHARS_PER_PASSAGE = 600;

/** LLM output token budget per section */
export const OUTPUT_TOKENS_PER_SECTION = 2000;

// ═══════════════════════════════════════════════════════════════════
// SECTION TYPES
// ═══════════════════════════════════════════════════════════════════

export type DraftSectionStatus = 'pending' | 'generating' | 'complete' | 'failed';

export interface DraftSection {
  /** Section index (0-based) */
  index: number;
  /** Optional section title */
  title?: string;
  /** IDs of passages to use in this section */
  passageIds: string[];
  /** Target word count for this section */
  targetWords: number;
  /** Current status */
  status: DraftSectionStatus;
  /** Generated content (once complete) */
  content?: string;
  /** Actual word count (once complete) */
  wordCount?: number;
  /** Error message if failed */
  error?: string;
  /** Generation time in ms */
  generationTimeMs?: number;
}

// ═══════════════════════════════════════════════════════════════════
// JOB TYPES
// ═══════════════════════════════════════════════════════════════════

export type DraftJobStatus =
  | 'pending'      // Job created, not started
  | 'generating'   // Actively generating sections
  | 'paused'       // Paused by user
  | 'complete'     // All sections generated
  | 'failed';      // Fatal error, cannot continue

export type DraftStyle = 'academic' | 'narrative' | 'conversational';

export interface DraftGenerationJob {
  /** Unique job ID */
  id: string;
  /** Job type identifier */
  type: 'draft-generation';
  /** Book URI this job belongs to */
  bookUri: string;
  /** Chapter ID being generated */
  chapterId: string;
  /** Chapter title for display */
  chapterTitle: string;
  /** Arc ID guiding the structure */
  arcId?: string;
  /** Writing style */
  style: DraftStyle;
  /** Planned sections */
  sections: DraftSection[];
  /** Index of current section being generated */
  currentSection: number;
  /** Generated content per section (indexed by section index) */
  generatedContent: string[];
  /** Current job status */
  status: DraftJobStatus;
  /** Total target word count */
  targetWords: number;
  /** Actual generated word count */
  generatedWords: number;
  /** Job creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Completion timestamp */
  completedAt?: number;
  /** Error message if failed */
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// PROGRESS TYPES
// ═══════════════════════════════════════════════════════════════════

export interface DraftProgress {
  /** Job ID */
  jobId: string;
  /** Chapter title */
  chapterTitle: string;
  /** Current section (1-based for display) */
  currentSection: number;
  /** Total sections */
  totalSections: number;
  /** Words generated so far */
  wordsGenerated: number;
  /** Target total words */
  targetWords: number;
  /** Percent complete (0-100) */
  percentComplete: number;
  /** Current status */
  status: DraftJobStatus;
  /** Whether a section just completed */
  sectionComplete?: boolean;
  /** Elapsed time in ms */
  elapsedMs: number;
  /** Estimated remaining time in ms */
  estimatedRemainingMs?: number;
}

// ═══════════════════════════════════════════════════════════════════
// REQUEST/RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════

export interface StartDraftParams {
  /** Book URI */
  bookUri: string;
  /** Chapter ID to generate */
  chapterId: string;
  /** Optional arc ID for structure guidance */
  arcId?: string;
  /** Writing style (default: academic) */
  style?: DraftStyle;
  /** Optional custom target words per section */
  wordsPerSection?: number;
}

export interface StartDraftResult {
  /** Whether job was started successfully */
  success: boolean;
  /** Job details if successful */
  job?: {
    id: string;
    sections: number;
    totalWords: number;
    estimatedTimeSeconds: number;
  };
  /** Error message if failed */
  error?: string;
}

export interface DraftStatusResult {
  /** Whether status was retrieved successfully */
  success: boolean;
  /** Job status if found */
  job?: DraftGenerationJob;
  /** Progress info if generating */
  progress?: DraftProgress;
  /** Error message if failed */
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// EVENT TYPES
// ═══════════════════════════════════════════════════════════════════

export type DraftEventType =
  | 'job:started'
  | 'job:progress'
  | 'section:started'
  | 'section:complete'
  | 'job:complete'
  | 'job:paused'
  | 'job:resumed'
  | 'job:failed';

export interface DraftEvent {
  type: DraftEventType;
  jobId: string;
  timestamp: number;
  progress?: DraftProgress;
  section?: DraftSection;
  error?: string;
}

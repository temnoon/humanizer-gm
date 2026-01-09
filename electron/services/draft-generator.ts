/**
 * Draft Generator Service
 *
 * Generates chapter drafts iteratively, breaking long chapters into sections
 * to work within LLM context limits. Features:
 *
 * - Section planning based on passage count and word targets
 * - Sequential generation with progress tracking
 * - Pause/resume capability
 * - Persistence across app restarts
 * - Event emission for renderer updates
 *
 * Design Philosophy:
 * - AUI is the orchestrator, this service is the executor
 * - No duplicate operations - single source of truth for draft generation
 * - Clear communication of context limits and progress
 */

import Store from 'electron-store';
import { EventEmitter } from 'events';
import { EmbeddingDatabase } from '../archive-server/services/embeddings/EmbeddingDatabase.js';
import { getModelRouter } from './model-router.js';
import type {
  DraftGenerationJob,
  DraftSection,
  DraftProgress,
  DraftEvent,
  DraftStyle,
  StartDraftParams,
  StartDraftResult,
  DraftStatusResult,
  DraftJobStatus,
  PASSAGES_PER_SECTION,
  WORDS_PER_SECTION,
  MAX_CHARS_PER_PASSAGE,
} from '@humanizer/core';

// Re-import constants (can't import values from type-only imports)
const PASSAGES_PER_SECTION = 6;
const WORDS_PER_SECTION = 1500;
const MAX_CHARS_PER_PASSAGE = 600;

// ═══════════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════════

interface DraftStore {
  jobs: Record<string, DraftGenerationJob>;
}

const store = new Store<DraftStore>({
  name: 'draft-generator',
  defaults: {
    jobs: {},
  },
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE CLASS
// ═══════════════════════════════════════════════════════════════════

export class DraftGeneratorService extends EventEmitter {
  private jobs: Map<string, DraftGenerationJob> = new Map();
  private activeGeneration: string | null = null;
  private archivePath: string;

  constructor(archivePath: string) {
    super();
    this.archivePath = archivePath;
    this.restoreJobs();
  }

  // ─────────────────────────────────────────────────────────────────
  // PERSISTENCE
  // ─────────────────────────────────────────────────────────────────

  private restoreJobs(): void {
    const savedJobs = store.get('jobs', {});
    for (const [id, job] of Object.entries(savedJobs)) {
      // Only restore jobs that aren't complete or failed
      if (job.status === 'generating' || job.status === 'paused' || job.status === 'pending') {
        // Mark as paused if was generating (interrupted by app restart)
        if (job.status === 'generating') {
          job.status = 'paused';
        }
        this.jobs.set(id, job);
      }
    }
    console.log(`[draft-generator] Restored ${this.jobs.size} pending jobs`);
  }

  private saveJobs(): void {
    const jobsObj: Record<string, DraftGenerationJob> = {};
    for (const [id, job] of this.jobs) {
      jobsObj[id] = job;
    }
    store.set('jobs', jobsObj);
  }

  private updateJob(job: DraftGenerationJob): void {
    job.updatedAt = Date.now();
    this.jobs.set(job.id, job);
    this.saveJobs();
  }

  // ─────────────────────────────────────────────────────────────────
  // SECTION PLANNING
  // ─────────────────────────────────────────────────────────────────

  private planSections(
    passageIds: string[],
    passageContents: Map<string, { text: string; wordCount: number }>
  ): DraftSection[] {
    const sections: DraftSection[] = [];
    let currentPassages: string[] = [];
    let currentWordEstimate = 0;

    for (const passageId of passageIds) {
      const passage = passageContents.get(passageId);
      const passageWords = passage?.wordCount || 0;

      currentPassages.push(passageId);
      currentWordEstimate += passageWords;

      // Start new section if we've hit the passage or word limit
      const hitPassageLimit = currentPassages.length >= PASSAGES_PER_SECTION;
      const hitWordLimit = currentWordEstimate >= WORDS_PER_SECTION * 0.8; // 80% of target

      if (hitPassageLimit || hitWordLimit) {
        sections.push({
          index: sections.length,
          passageIds: [...currentPassages],
          targetWords: Math.min(WORDS_PER_SECTION, Math.ceil(currentWordEstimate * 1.5)),
          status: 'pending',
        });
        currentPassages = [];
        currentWordEstimate = 0;
      }
    }

    // Handle remaining passages
    if (currentPassages.length > 0) {
      sections.push({
        index: sections.length,
        passageIds: currentPassages,
        targetWords: Math.max(500, Math.ceil(currentWordEstimate * 1.5)),
        status: 'pending',
      });
    }

    // Ensure at least one section
    if (sections.length === 0) {
      sections.push({
        index: 0,
        passageIds: [],
        targetWords: WORDS_PER_SECTION,
        status: 'pending',
      });
    }

    return sections;
  }

  // ─────────────────────────────────────────────────────────────────
  // JOB MANAGEMENT
  // ─────────────────────────────────────────────────────────────────

  async startGeneration(params: StartDraftParams): Promise<StartDraftResult> {
    const { bookUri, chapterId, arcId, style = 'academic', wordsPerSection } = params;

    try {
      // Initialize database
      const db = new EmbeddingDatabase(this.archivePath);

      // Get chapter info
      const chapter = db.getBookChapter(chapterId);
      if (!chapter) {
        return { success: false, error: `Chapter not found: ${chapterId}` };
      }

      // Get book info
      const book = db.getBookByUri(bookUri);
      if (!book) {
        return { success: false, error: `Book not found: ${bookUri}` };
      }

      // Get passages for this chapter
      // First try to get passage IDs from arc/chapter outline, then fall back to approved passages
      let passageIds: string[] = [];
      let passageContents = new Map<string, { text: string; wordCount: number }>();

      if (arcId) {
        // Get passages from arc's chapter outline
        const arc = db.getNarrativeArc(arcId);
        if (arc?.chapters) {
          const chapterOutline = arc.chapters.find(
            (c: { number?: number }) => c.number === (chapter.number as number)
          );
          if (chapterOutline?.passageIds) {
            passageIds = chapterOutline.passageIds;
          }
        }
      }

      // Fall back to approved passages from book
      if (passageIds.length === 0) {
        const passages = db.getBookPassages(bookUri);
        passageIds = passages
          .filter((p: { status?: string }) => p.status === 'approved' || p.status === 'gem')
          .map((p: { id: string }) => p.id);
      }

      // Load passage content
      for (const passageId of passageIds) {
        const passage = db.getPassage(passageId);
        if (passage) {
          passageContents.set(passageId, {
            text: passage.content || passage.text || '',
            wordCount: (passage.content || passage.text || '').split(/\s+/).filter(Boolean).length,
          });
        }
      }

      if (passageIds.length === 0) {
        return {
          success: false,
          error: 'No approved passages found. Mark some passages as approved or gem first.',
        };
      }

      // Plan sections
      const sections = this.planSections(passageIds, passageContents);

      // Calculate totals
      const totalTargetWords = sections.reduce((sum, s) => sum + s.targetWords, 0);
      const estimatedTimeSeconds = sections.length * 45; // ~45s per section

      // Create job
      const job: DraftGenerationJob = {
        id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'draft-generation',
        bookUri,
        chapterId,
        chapterTitle: chapter.title as string,
        arcId,
        style: style as DraftStyle,
        sections,
        currentSection: 0,
        generatedContent: [],
        status: 'pending',
        targetWords: totalTargetWords,
        generatedWords: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.jobs.set(job.id, job);
      this.saveJobs();

      // Emit job started event
      this.emitEvent({
        type: 'job:started',
        jobId: job.id,
        timestamp: Date.now(),
        progress: this.buildProgress(job),
      });

      // Start generation asynchronously
      this.runGeneration(job.id).catch((err) => {
        console.error(`[draft-generator] Generation error:`, err);
      });

      return {
        success: true,
        job: {
          id: job.id,
          sections: sections.length,
          totalWords: totalTargetWords,
          estimatedTimeSeconds,
        },
      };
    } catch (err) {
      console.error(`[draft-generator] Start error:`, err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  async pause(jobId: string): Promise<{ success: boolean; error?: string }> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { success: false, error: 'Job not found' };
    }

    if (job.status !== 'generating') {
      return { success: false, error: `Cannot pause job in status: ${job.status}` };
    }

    job.status = 'paused';
    this.updateJob(job);

    this.emitEvent({
      type: 'job:paused',
      jobId: job.id,
      timestamp: Date.now(),
      progress: this.buildProgress(job),
    });

    return { success: true };
  }

  async resume(jobId: string): Promise<{ success: boolean; error?: string }> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { success: false, error: 'Job not found' };
    }

    if (job.status !== 'paused') {
      return { success: false, error: `Cannot resume job in status: ${job.status}` };
    }

    job.status = 'generating';
    this.updateJob(job);

    this.emitEvent({
      type: 'job:resumed',
      jobId: job.id,
      timestamp: Date.now(),
      progress: this.buildProgress(job),
    });

    // Continue generation
    this.runGeneration(jobId).catch((err) => {
      console.error(`[draft-generator] Resume error:`, err);
    });

    return { success: true };
  }

  getStatus(jobId: string): DraftStatusResult {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { success: false, error: 'Job not found' };
    }

    return {
      success: true,
      job,
      progress: this.buildProgress(job),
    };
  }

  listJobs(): DraftGenerationJob[] {
    return Array.from(this.jobs.values());
  }

  // ─────────────────────────────────────────────────────────────────
  // GENERATION LOOP
  // ─────────────────────────────────────────────────────────────────

  private async runGeneration(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Prevent concurrent generation
    if (this.activeGeneration && this.activeGeneration !== jobId) {
      console.log(`[draft-generator] Queuing job ${jobId}, active: ${this.activeGeneration}`);
      return;
    }

    this.activeGeneration = jobId;
    job.status = 'generating';
    this.updateJob(job);

    const db = new EmbeddingDatabase(this.archivePath);
    const router = getModelRouter({ preference: 'local-only' });

    try {
      // Process each pending section
      while (job.currentSection < job.sections.length) {
        // Check if paused
        if (job.status === 'paused') {
          console.log(`[draft-generator] Job ${jobId} paused at section ${job.currentSection}`);
          break;
        }

        const section = job.sections[job.currentSection];
        section.status = 'generating';
        this.updateJob(job);

        this.emitEvent({
          type: 'section:started',
          jobId: job.id,
          timestamp: Date.now(),
          progress: this.buildProgress(job),
          section,
        });

        const startTime = Date.now();

        try {
          // Load passage content for this section
          const passageTexts: string[] = [];
          for (const passageId of section.passageIds) {
            const passage = db.getPassage(passageId);
            if (passage) {
              const text = (passage.content || passage.text || '').substring(0, MAX_CHARS_PER_PASSAGE);
              passageTexts.push(text);
            }
          }

          // Build prompt
          const prompt = this.buildSectionPrompt(
            job,
            section,
            passageTexts,
            job.generatedContent
          );

          // Generate
          const result = await router.generate({
            prompt,
            maxTokens: Math.ceil(section.targetWords * 1.5),
            temperature: 0.7,
            taskType: 'draft',
          });

          if (!result.success || !result.text) {
            throw new Error(result.error || 'Generation failed');
          }

          // Update section
          section.status = 'complete';
          section.content = result.text;
          section.wordCount = result.text.split(/\s+/).filter(Boolean).length;
          section.generationTimeMs = Date.now() - startTime;

          // Update job
          job.generatedContent.push(result.text);
          job.generatedWords += section.wordCount;
          job.currentSection++;
          this.updateJob(job);

          this.emitEvent({
            type: 'section:complete',
            jobId: job.id,
            timestamp: Date.now(),
            progress: this.buildProgress(job),
            section,
          });

        } catch (err) {
          section.status = 'failed';
          section.error = err instanceof Error ? err.message : 'Unknown error';
          section.generationTimeMs = Date.now() - startTime;

          // For now, fail the whole job on section error
          // Future: could retry or skip
          job.status = 'failed';
          job.error = `Section ${section.index + 1} failed: ${section.error}`;
          this.updateJob(job);

          this.emitEvent({
            type: 'job:failed',
            jobId: job.id,
            timestamp: Date.now(),
            progress: this.buildProgress(job),
            error: job.error,
          });

          break;
        }
      }

      // Check completion
      if (job.currentSection >= job.sections.length && job.status === 'generating') {
        job.status = 'complete';
        job.completedAt = Date.now();
        this.updateJob(job);

        // Save final content to chapter
        await this.saveChapterContent(job, db);

        this.emitEvent({
          type: 'job:complete',
          jobId: job.id,
          timestamp: Date.now(),
          progress: this.buildProgress(job),
        });

        // Clean up completed job after a delay
        setTimeout(() => {
          this.jobs.delete(jobId);
          this.saveJobs();
        }, 60000); // Keep for 1 minute for status queries
      }

    } finally {
      this.activeGeneration = null;

      // Check if there are queued jobs to run
      for (const [queuedId, queuedJob] of this.jobs) {
        if (queuedJob.status === 'pending' || queuedJob.status === 'generating') {
          if (queuedId !== jobId) {
            this.runGeneration(queuedId).catch(console.error);
            break;
          }
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // PROMPT BUILDING
  // ─────────────────────────────────────────────────────────────────

  private buildSectionPrompt(
    job: DraftGenerationJob,
    section: DraftSection,
    passageTexts: string[],
    previousContent: string[]
  ): string {
    const styleInstructions: Record<DraftStyle, string> = {
      academic: 'Use an academic but accessible tone. Include clear definitions, structured arguments, and appropriate philosophical vocabulary.',
      narrative: 'Use a narrative, engaging tone. Weave ideas together as a story of intellectual discovery.',
      conversational: 'Use a conversational, approachable tone. Explain concepts as if talking to an interested friend.',
    };

    const sectionNumber = section.index + 1;
    const totalSections = job.sections.length;
    const isFirstSection = section.index === 0;
    const isLastSection = section.index === job.sections.length - 1;

    // Build context from previous sections
    let previousContext = '';
    if (previousContent.length > 0) {
      const lastSection = previousContent[previousContent.length - 1];
      const preview = lastSection.slice(-500); // Last 500 chars for continuity
      previousContext = `\n\nPREVIOUS SECTION ENDING:\n"...${preview}"\n\nContinue naturally from this point.`;
    }

    // Build source material
    const sourceMaterial = passageTexts
      .map((text, i) => `[Source ${i + 1}]: ${text}`)
      .join('\n\n');

    // Build prompt
    let prompt = `You are writing section ${sectionNumber} of ${totalSections} for a chapter titled "${job.chapterTitle}".

Writing Style: ${styleInstructions[job.style]}

Target Length: approximately ${section.targetWords} words
`;

    if (isFirstSection) {
      prompt += `\nThis is the OPENING section. Start with an engaging introduction that sets up the chapter's themes.\n`;
    } else if (isLastSection) {
      prompt += `\nThis is the CLOSING section. Provide a thoughtful conclusion that ties together the chapter's ideas.\n`;
    } else {
      prompt += `\nThis is a MIDDLE section. Maintain momentum and build on previous ideas.\n`;
    }

    prompt += previousContext;

    prompt += `

SOURCE MATERIAL (use these ideas, synthesize into original prose):
${sourceMaterial}

INSTRUCTIONS:
1. Write prose that flows naturally${isFirstSection ? '' : ' from the previous section'}
2. Draw from the source material but synthesize into original prose
3. Maintain the specified writing style throughout
4. Target approximately ${section.targetWords} words
5. ${isLastSection ? 'Provide a satisfying conclusion' : 'End at a natural transition point'}

Write section ${sectionNumber} now:`;

    return prompt;
  }

  // ─────────────────────────────────────────────────────────────────
  // CHAPTER SAVE
  // ─────────────────────────────────────────────────────────────────

  private async saveChapterContent(
    job: DraftGenerationJob,
    db: EmbeddingDatabase
  ): Promise<void> {
    // Combine all sections with transitions
    const fullContent = job.generatedContent.join('\n\n---\n\n');

    // Get existing chapter
    const chapter = db.getBookChapter(job.chapterId);
    if (!chapter) return;

    // Update chapter
    db.upsertBookChapter({
      id: job.chapterId,
      bookId: (chapter.bookId || chapter.book_id) as string,
      number: chapter.number as number,
      title: job.chapterTitle,
      content: fullContent,
      wordCount: job.generatedWords,
      status: 'draft',
      version: ((chapter.version as number) || 0) + 1,
    });

    // Save version snapshot
    db.saveChapterVersion(
      job.chapterId,
      ((chapter.version as number) || 0) + 1,
      fullContent,
      `Generated draft: ${job.sections.length} sections, ${job.generatedWords} words`,
      'aui'
    );

    console.log(`[draft-generator] Saved chapter: ${job.generatedWords} words`);
  }

  // ─────────────────────────────────────────────────────────────────
  // PROGRESS
  // ─────────────────────────────────────────────────────────────────

  private buildProgress(job: DraftGenerationJob): DraftProgress {
    const elapsedMs = Date.now() - job.createdAt;
    const sectionsComplete = job.generatedContent.length;
    const sectionsRemaining = job.sections.length - sectionsComplete;

    // Estimate remaining time based on average section time
    let estimatedRemainingMs: number | undefined;
    if (sectionsComplete > 0) {
      const avgTimePerSection = elapsedMs / sectionsComplete;
      estimatedRemainingMs = avgTimePerSection * sectionsRemaining;
    }

    return {
      jobId: job.id,
      chapterTitle: job.chapterTitle,
      currentSection: job.currentSection + 1, // 1-based for display
      totalSections: job.sections.length,
      wordsGenerated: job.generatedWords,
      targetWords: job.targetWords,
      percentComplete: Math.round((sectionsComplete / job.sections.length) * 100),
      status: job.status,
      sectionComplete: false, // Set by caller when appropriate
      elapsedMs,
      estimatedRemainingMs,
    };
  }

  private emitEvent(event: DraftEvent): void {
    this.emit('event', event);
    this.emit(event.type, event);

    // Also emit progress for convenience
    if (event.progress) {
      this.emit('progress', event.progress);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════

let _service: DraftGeneratorService | null = null;

export function getDraftGenerator(archivePath?: string): DraftGeneratorService {
  if (!_service) {
    if (!archivePath) {
      throw new Error('Archive path required for first initialization');
    }
    _service = new DraftGeneratorService(archivePath);
  }
  return _service;
}

export function closeDraftGenerator(): void {
  _service = null;
}

export default { getDraftGenerator, closeDraftGenerator };

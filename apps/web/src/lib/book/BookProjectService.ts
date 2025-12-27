/**
 * BookProjectService - Persistence and version control for book projects
 *
 * Features:
 * - localStorage persistence
 * - Linear version control (v1, v2, v3...)
 * - Chapter CRUD operations
 * - Book rendering (compile chapters to markdown)
 */

import type {
  BookProject,
  DraftChapter,
  DraftVersion,
  SourcePassage,
} from '../../components/archive/book-project/types';
import type {
  PyramidStructure,
  BookProfile,
} from '@humanizer/core';

// ═══════════════════════════════════════════════════════════════════
// STORAGE KEYS
// ═══════════════════════════════════════════════════════════════════

const STORAGE_KEYS = {
  projectList: 'humanizer-book-projects',
  project: (id: string) => `humanizer-book-project-${id}`,
};

// ═══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ═══════════════════════════════════════════════════════════════════
// BOOK PROJECT SERVICE
// ═══════════════════════════════════════════════════════════════════

export class BookProjectService {
  // ─────────────────────────────────────────────────────────────────
  // CRUD OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get list of all project IDs
   */
  list(): string[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.projectList);
      if (stored) {
        return JSON.parse(stored) as string[];
      }
    } catch (e) {
      console.error('Failed to load project list:', e);
    }
    return [];
  }

  /**
   * Load all projects (full objects)
   */
  loadAll(): BookProject[] {
    const ids = this.list();
    const projects: BookProject[] = [];

    for (const id of ids) {
      const project = this.load(id);
      if (project) {
        projects.push(project);
      }
    }

    return projects;
  }

  /**
   * Load a single project by ID
   */
  load(id: string): BookProject | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.project(id));
      if (stored) {
        return JSON.parse(stored) as BookProject;
      }
    } catch (e) {
      console.error(`Failed to load project ${id}:`, e);
    }
    return null;
  }

  /**
   * Save a project to localStorage
   */
  save(project: BookProject): void {
    try {
      // Update timestamps
      project.updatedAt = Date.now();

      // Save the project
      localStorage.setItem(
        STORAGE_KEYS.project(project.id),
        JSON.stringify(project)
      );

      // Update project list
      const ids = this.list();
      if (!ids.includes(project.id)) {
        ids.push(project.id);
        localStorage.setItem(STORAGE_KEYS.projectList, JSON.stringify(ids));
      }
    } catch (e) {
      console.error(`Failed to save project ${project.id}:`, e);
      throw e;
    }
  }

  /**
   * Delete a project
   */
  delete(id: string): void {
    try {
      // Remove project data
      localStorage.removeItem(STORAGE_KEYS.project(id));

      // Update project list
      const ids = this.list().filter(pid => pid !== id);
      localStorage.setItem(STORAGE_KEYS.projectList, JSON.stringify(ids));
    } catch (e) {
      console.error(`Failed to delete project ${id}:`, e);
    }
  }

  /**
   * Create a new project
   */
  createProject(name: string, subtitle?: string): BookProject {
    const now = Date.now();
    const id = generateId();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const project: BookProject = {
      id,
      uri: `book://user/${slug}`,
      type: 'book',
      name,
      subtitle,
      author: 'user',
      description: '',
      createdAt: now,
      updatedAt: now,
      tags: [],
      status: 'harvesting',
      // New flat structure
      personaRefs: [],
      styleRefs: [],
      threads: [],
      sourceRefs: [],
      passages: [],
      chapters: [],
      // Legacy structure (for backward compatibility)
      sources: {
        conversations: [],
        passages: [],
        threads: [],
      },
      thinking: {
        decisions: [],
        context: {
          recentQueries: [],
          pinnedConcepts: [],
          auiNotes: [],
        },
      },
      drafts: {
        chapters: [],
      },
      stats: {
        totalSources: 0,
        totalConversations: 0, // Legacy alias
        totalPassages: 0,
        approvedPassages: 0,
        gems: 0,
        chapters: 0,
        wordCount: 0,
      },
    };

    this.save(project);
    return project;
  }

  // ─────────────────────────────────────────────────────────────────
  // CHAPTER OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a new chapter
   */
  createChapter(
    project: BookProject,
    title: string,
    content?: string
  ): { project: BookProject; chapter: DraftChapter } {
    const now = Date.now();
    const existingChapters = project.chapters || project.drafts?.chapters || [];
    const chapterNumber = existingChapters.length + 1;
    const initialContent = content || `# ${title}\n\nStart writing here...\n`;

    const chapter: DraftChapter = {
      id: `ch-${generateId()}`,
      number: chapterNumber,
      title,
      content: initialContent,
      wordCount: countWords(initialContent),
      version: 1,
      versions: [
        {
          version: 1,
          timestamp: now,
          content: initialContent,
          wordCount: countWords(initialContent),
          changes: 'Initial draft',
          createdBy: 'user',
        },
      ],
      sections: [],
      status: 'outline',
      marginalia: [],
      metadata: {
        notes: [],
        lastEditedBy: 'user',
        lastEditedAt: now,
        auiSuggestions: [],
      },
      passageRefs: [],
    };

    // Add to project - use new flat structure if available, otherwise legacy
    const updatedChapters = [...existingChapters, chapter];
    const updatedProject = {
      ...project,
      chapters: updatedChapters,
      drafts: {
        ...(project.drafts || {}),
        chapters: updatedChapters,
      },
      stats: {
        ...project.stats,
        chapters: project.stats.chapters + 1,
        wordCount: project.stats.wordCount + chapter.wordCount,
      },
      status: project.status === 'harvesting' ? 'drafting' : project.status,
    } as BookProject;

    this.save(updatedProject);
    return { project: updatedProject, chapter };
  }

  /**
   * Update chapter content (creates a new version)
   */
  updateChapter(
    project: BookProject,
    chapterId: string,
    content: string,
    changes?: string,
    createdBy: 'user' | 'aui' = 'user'
  ): { project: BookProject; chapter: DraftChapter; version: number } {
    const chapters = project.chapters || project.drafts?.chapters || [];
    const chapterIndex = chapters.findIndex(c => c.id === chapterId);

    if (chapterIndex === -1) {
      throw new Error(`Chapter ${chapterId} not found`);
    }

    const chapter = chapters[chapterIndex];
    const now = Date.now();
    const newVersion = chapter.version + 1;
    const newWordCount = countWords(content);
    const oldWordCount = chapter.wordCount;

    // Create version snapshot
    const versionSnapshot: DraftVersion = {
      version: newVersion,
      timestamp: now,
      content,
      wordCount: newWordCount,
      changes: changes || `Updated content (${newWordCount - oldWordCount > 0 ? '+' : ''}${newWordCount - oldWordCount} words)`,
      createdBy,
    };

    // Update chapter
    const updatedChapter: DraftChapter = {
      ...chapter,
      content,
      wordCount: newWordCount,
      version: newVersion,
      versions: [...chapter.versions, versionSnapshot],
      status: chapter.status === 'outline' ? 'drafting' : chapter.status,
      metadata: {
        ...chapter.metadata,
        lastEditedBy: createdBy,
        lastEditedAt: now,
      },
    };

    // Update project
    const updatedChapters = [...chapters];
    updatedChapters[chapterIndex] = updatedChapter;

    const updatedProject: BookProject = {
      ...project,
      chapters: updatedChapters,
      drafts: {
        ...(project.drafts || {}),
        chapters: updatedChapters,
      },
      stats: {
        ...project.stats,
        wordCount: project.stats.wordCount - oldWordCount + newWordCount,
      },
    };

    this.save(updatedProject);
    return { project: updatedProject, chapter: updatedChapter, version: newVersion };
  }

  /**
   * Delete a chapter
   */
  deleteChapter(project: BookProject, chapterId: string): BookProject {
    const chapters = project.chapters || project.drafts?.chapters || [];
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) {
      throw new Error(`Chapter ${chapterId} not found`);
    }

    const updatedChapters = chapters
      .filter(c => c.id !== chapterId)
      .map((c, i) => ({ ...c, number: i + 1 })); // Renumber

    const updatedProject: BookProject = {
      ...project,
      chapters: updatedChapters,
      drafts: {
        ...(project.drafts || {}),
        chapters: updatedChapters,
      },
      stats: {
        ...project.stats,
        chapters: project.stats.chapters - 1,
        wordCount: project.stats.wordCount - chapter.wordCount,
      },
    };

    this.save(updatedProject);
    return updatedProject;
  }

  // ─────────────────────────────────────────────────────────────────
  // PASSAGE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Add a passage to the book project
   */
  addPassage(
    project: BookProject,
    passageData: {
      content: string;
      conversationId?: string;
      conversationTitle: string;
      role?: 'user' | 'assistant';
      tags?: string[];
    }
  ): { project: BookProject; passage: SourcePassage } {
    const now = Date.now();
    const passageId = `p-${generateId()}`;
    const conversationId = passageData.conversationId || `manual-${now}`;

    const passage: SourcePassage = {
      id: passageId,
      // New unified structure
      sourceRef: {
        uri: `source://chatgpt/${conversationId}`,
        sourceType: 'chatgpt',
        conversationId,
        conversationTitle: passageData.conversationTitle,
        label: passageData.conversationTitle,
      },
      text: passageData.content,
      wordCount: countWords(passageData.content),
      role: passageData.role || 'user',
      timestamp: now,
      harvestedBy: 'manual',
      curation: {
        status: 'candidate',
      },
      tags: passageData.tags || [],
      // Legacy aliases for backward compatibility
      conversationId,
      conversationTitle: passageData.conversationTitle,
      content: passageData.content,
      status: 'unreviewed',
    };

    // Use new flat structure with fallback
    const existingPassages = project.passages || project.sources?.passages || [];
    const updatedPassages = [...existingPassages, passage];

    const updatedProject: BookProject = {
      ...project,
      passages: updatedPassages,
      sources: {
        ...(project.sources || { conversations: [], threads: [] }),
        passages: updatedPassages,
      },
      stats: {
        ...project.stats,
        totalPassages: project.stats.totalPassages + 1,
      },
    };

    this.save(updatedProject);
    return { project: updatedProject, passage };
  }

  /**
   * Update an existing passage
   */
  updatePassage(
    project: BookProject,
    passageId: string,
    updates: Partial<SourcePassage>
  ): { project: BookProject; passage: SourcePassage } {
    const passages = project.passages || project.sources?.passages || [];
    const passageIndex = passages.findIndex(p => p.id === passageId);

    if (passageIndex === -1) {
      throw new Error(`Passage ${passageId} not found`);
    }

    const oldPassage = passages[passageIndex];
    const oldStatus = oldPassage.curation?.status || oldPassage.status;

    const updatedPassage: SourcePassage = {
      ...oldPassage,
      ...updates,
      id: passageId, // Ensure ID doesn't change
    };

    // Recalculate word count if content changed
    if (updates.text || updates.content) {
      updatedPassage.wordCount = countWords(updates.text || updates.content || '');
    }

    const updatedPassages = [...passages];
    updatedPassages[passageIndex] = updatedPassage;

    // Update stats based on status changes
    let statsUpdate = { ...project.stats };
    const newStatus = updates.curation?.status || updates.status;
    if (newStatus && newStatus !== oldStatus) {
      // Decrement old status count
      if (oldStatus === 'gem') statsUpdate.gems--;
      if (oldStatus === 'approved' || oldStatus === 'gem') statsUpdate.approvedPassages--;

      // Increment new status count
      if (newStatus === 'gem') {
        statsUpdate.gems++;
        statsUpdate.approvedPassages++;
      } else if (newStatus === 'approved') {
        statsUpdate.approvedPassages++;
      }
    }

    const updatedProject: BookProject = {
      ...project,
      passages: updatedPassages,
      sources: {
        ...(project.sources || { conversations: [], threads: [] }),
        passages: updatedPassages,
      },
      stats: statsUpdate,
    };

    this.save(updatedProject);
    return { project: updatedProject, passage: updatedPassage };
  }

  /**
   * Get all passages from a project
   */
  getPassages(project: BookProject): SourcePassage[] {
    return project.passages || project.sources?.passages || [];
  }

  /**
   * Get a single passage by ID
   */
  getPassage(project: BookProject, passageId: string): SourcePassage | null {
    const passages = project.passages || project.sources?.passages || [];
    return passages.find(p => p.id === passageId) || null;
  }

  /**
   * Delete a passage
   */
  deletePassage(project: BookProject, passageId: string): BookProject {
    const passages = project.passages || project.sources?.passages || [];
    const passage = passages.find(p => p.id === passageId);
    if (!passage) {
      throw new Error(`Passage ${passageId} not found`);
    }

    // Update stats
    const status = passage.curation?.status || passage.status;
    let statsUpdate = { ...project.stats };
    statsUpdate.totalPassages--;
    if (status === 'gem') statsUpdate.gems--;
    if (status === 'approved' || status === 'gem') {
      statsUpdate.approvedPassages--;
    }

    const updatedPassages = passages.filter(p => p.id !== passageId);
    const updatedProject: BookProject = {
      ...project,
      passages: updatedPassages,
      sources: {
        ...(project.sources || { conversations: [], threads: [] }),
        passages: updatedPassages,
      },
      stats: statsUpdate,
    };

    this.save(updatedProject);
    return updatedProject;
  }

  // ─────────────────────────────────────────────────────────────────
  // VERSION CONTROL
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get a specific version of a chapter
   */
  getVersion(
    project: BookProject,
    chapterId: string,
    version: number
  ): DraftVersion | null {
    const chapters = project.chapters || project.drafts?.chapters || [];
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return null;

    return chapter.versions.find(v => v.version === version) || null;
  }

  /**
   * Revert chapter to a previous version
   */
  revertToVersion(
    project: BookProject,
    chapterId: string,
    version: number
  ): { project: BookProject; chapter: DraftChapter } {
    const targetVersion = this.getVersion(project, chapterId, version);
    if (!targetVersion) {
      throw new Error(`Version ${version} not found for chapter ${chapterId}`);
    }

    // Create a new version that reverts to the old content
    return this.updateChapter(
      project,
      chapterId,
      targetVersion.content,
      `Reverted to version ${version}`,
      'user'
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // PYRAMID OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Update the pyramid structure for a project
   */
  updatePyramid(project: BookProject, pyramid: PyramidStructure): BookProject {
    const updatedProject: BookProject = {
      ...project,
      pyramid: {
        chunks: pyramid.chunks,
        summaries: pyramid.summaries,
        apex: pyramid.apex,
        meta: pyramid.meta,
      },
      // Update profile stats if apex exists
      profile: project.profile
        ? {
            ...project.profile,
            apex: pyramid.apex
              ? {
                  summary: pyramid.apex.summary,
                  themes: pyramid.apex.themes,
                  characters: pyramid.apex.characters,
                  arc: pyramid.apex.arc,
                }
              : project.profile.apex,
            stats: {
              ...project.profile.stats,
              pyramidDepth: pyramid.meta.depth,
              totalChunks: pyramid.chunks.length,
              compressionRatio: pyramid.meta.compressionRatio,
              lastUpdated: Date.now(),
            },
          }
        : undefined,
    };

    this.save(updatedProject);
    return updatedProject;
  }

  /**
   * Get the pyramid for a project
   */
  getPyramid(project: BookProject): PyramidStructure | null {
    if (!project.pyramid) return null;

    // Return as full PyramidStructure with meta
    return {
      chunks: project.pyramid.chunks || [],
      summaries: project.pyramid.summaries || [],
      apex: project.pyramid.apex,
      meta: {
        depth: this.calculatePyramidDepth(project.pyramid),
        chunkCount: (project.pyramid.chunks || []).length,
        sourceWordCount: (project.pyramid.chunks || []).reduce(
          (sum, c) => sum + c.wordCount,
          0
        ),
        compressionRatio: this.calculateCompressionRatio(project.pyramid),
        builtAt: project.updatedAt,
        config: {
          chunkSize: 300,
          compressionTarget: 5,
          summarizerModel: 'haiku',
          extractorModel: 'sonnet',
          computeEmbeddings: false,
        },
      },
    };
  }

  /**
   * Clear the pyramid for a project (to rebuild)
   */
  clearPyramid(project: BookProject): BookProject {
    const updatedProject: BookProject = {
      ...project,
      pyramid: undefined,
    };

    this.save(updatedProject);
    return updatedProject;
  }

  /**
   * Calculate pyramid depth from structure
   */
  private calculatePyramidDepth(
    pyramid: { chunks?: unknown[]; summaries?: { level: number }[] }
  ): number {
    if (!pyramid.summaries || pyramid.summaries.length === 0) {
      return pyramid.chunks?.length ? 1 : 0;
    }
    const maxLevel = Math.max(...pyramid.summaries.map((s) => s.level));
    return maxLevel + 1; // +1 for L0 chunks
  }

  /**
   * Calculate compression ratio
   */
  private calculateCompressionRatio(
    pyramid: {
      chunks?: { wordCount: number }[];
      apex?: { summary: string };
    }
  ): number {
    const totalWords =
      pyramid.chunks?.reduce((sum, c) => sum + c.wordCount, 0) || 0;
    const apexWords = pyramid.apex?.summary
      ? countWords(pyramid.apex.summary)
      : 0;
    if (apexWords === 0) return 1;
    return totalWords / apexWords;
  }

  // ─────────────────────────────────────────────────────────────────
  // PROFILE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Update the book profile
   */
  updateProfile(project: BookProject, profile: Partial<BookProfile>): BookProject {
    const now = Date.now();
    const existingProfile = project.profile || {
      apex: { summary: '', themes: [] },
      tone: { overall: '', register: '' },
      stats: {
        pyramidDepth: 0,
        totalChunks: 0,
        compressionRatio: 1,
        lastUpdated: now,
      },
    };

    const updatedProfile: BookProfile = {
      ...existingProfile,
      ...profile,
      stats: {
        ...existingProfile.stats,
        ...profile.stats,
        lastUpdated: now,
      },
    };

    const updatedProject: BookProject = {
      ...project,
      profile: updatedProfile,
    };

    this.save(updatedProject);
    return updatedProject;
  }

  /**
   * Get the profile for a project
   */
  getProfile(project: BookProject): BookProfile | null {
    return project.profile || null;
  }

  // ─────────────────────────────────────────────────────────────────
  // BOOK RENDERING
  // ─────────────────────────────────────────────────────────────────

  /**
   * Compile all chapters into a single markdown document
   */
  renderBook(project: BookProject): string {
    const parts: string[] = [];
    const chapters = project.chapters || project.drafts?.chapters || [];

    // Title page
    parts.push(`# ${project.name}`);
    if (project.subtitle) {
      parts.push(`\n*${project.subtitle}*`);
    }
    if (project.description) {
      parts.push(`\n${project.description}`);
    }
    parts.push('\n---\n');

    // Table of contents
    if (chapters.length > 0) {
      parts.push('## Contents\n');
      for (const chapter of chapters) {
        parts.push(`${chapter.number}. [${chapter.title}](#chapter-${chapter.number})`);
      }
      parts.push('\n---\n');
    }

    // Chapters
    for (const chapter of chapters) {
      // Chapter anchor
      parts.push(`<a id="chapter-${chapter.number}"></a>\n`);

      // Epigraph if present
      if (chapter.epigraph) {
        parts.push(`> ${chapter.epigraph.text}`);
        if (chapter.epigraph.source) {
          parts.push(`>\n> — *${chapter.epigraph.source}*`);
        }
        parts.push('');
      }

      // Chapter content
      parts.push(chapter.content);

      // Chapter separator
      parts.push('\n---\n');
    }

    // Footer
    parts.push(`\n*${project.stats.wordCount.toLocaleString()} words · ${project.stats.chapters} chapters*`);
    parts.push(`\n*Last updated: ${new Date(project.updatedAt).toLocaleDateString()}*`);

    return parts.join('\n');
  }

  /**
   * Get chapter by ID
   */
  getChapter(project: BookProject, chapterId: string): DraftChapter | null {
    const chapters = project.chapters || project.drafts?.chapters || [];
    return chapters.find(c => c.id === chapterId) || null;
  }

  /**
   * Get chapter by number
   */
  getChapterByNumber(project: BookProject, number: number): DraftChapter | null {
    const chapters = project.chapters || project.drafts?.chapters || [];
    return chapters.find(c => c.number === number) || null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════

export const bookProjectService = new BookProjectService();

export default bookProjectService;

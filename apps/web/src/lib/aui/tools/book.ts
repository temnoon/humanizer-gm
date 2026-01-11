/**
 * AUI Tools - Book Operations
 *
 * Handles book project and chapter management:
 * - Create/update/delete chapters
 * - Render book preview
 * - List chapters
 */

import type { AUIContext, AUIToolResult } from './types';

// ═══════════════════════════════════════════════════════════════════
// BOOK TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a new book project
 */
export function executeCreateBook(
  params: Record<string, unknown>,
  context: AUIContext
): AUIToolResult {
  const { name, title, subtitle, description } = params as {
    name?: string;
    title?: string;  // Alias for name
    subtitle?: string;
    description?: string;
  };

  const bookName = name || title || 'Untitled Book';
  const bookSubtitle = subtitle || description;

  if (!context.createProject) {
    return {
      success: false,
      error: 'Book creation not available. Please create a book manually using Archive > Books > + New Project',
    };
  }

  try {
    console.log('[AUI] Creating book project:', bookName, bookSubtitle);
    const project = context.createProject(bookName, bookSubtitle);

    if (!project) {
      console.error('[AUI] createProject returned null/undefined');
      return {
        success: false,
        error: 'Book creation failed - no project returned. Please create manually via Archive > Books > + New Project',
      };
    }

    console.log('[AUI] Book project created:', project.id, project.name);

    return {
      success: true,
      message: `Created book project "${project.name}"${project.subtitle ? ` (${project.subtitle})` : ''} - Click BOOKS tab to view`,
      data: {
        projectId: project.id,
        name: project.name,
        subtitle: project.subtitle,
      },
      teaching: {
        whatHappened: `Created new book project "${project.name}"${project.subtitle ? ` - ${project.subtitle}` : ''}`,
        guiPath: [
          'Archive panel (left)',
          'Books tab',
          '+ New Project button',
          'Enter name and subtitle',
        ],
        why: 'Book projects organize your harvested passages, thinking notes, and chapter drafts in one place.',
      },
    };
  } catch (e) {
    console.error('[AUI] Failed to create book project:', e);
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to create book project',
    };
  }
}

export function executeUpdateChapter(
  params: Record<string, unknown>,
  context: AUIContext
): AUIToolResult {
  const { chapterId, content, changes } = params as {
    chapterId?: string;
    content?: string;
    changes?: string;
  };

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  if (!chapterId) {
    return { success: false, error: 'Missing chapterId parameter' };
  }

  if (!content) {
    return { success: false, error: 'Missing content parameter' };
  }

  try {
    context.updateChapter(chapterId, content, changes);

    // Get the updated chapter to report version
    const chapter = context.getChapter(chapterId);
    const version = chapter?.version || '?';
    const wordCount = chapter?.wordCount || 0;

    return {
      success: true,
      message: `Chapter updated to version ${version}`,
      data: { chapterId, version },
      teaching: {
        whatHappened: `Saved new version (v${version}) of "${chapter?.title || 'chapter'}" - ${wordCount} words`,
        guiPath: [
          'Click on a chapter to open the editor',
          'Make your edits in the text area',
          'Changes are auto-saved as new versions',
          'Use the version dropdown to see history',
        ],
        why: 'Every edit creates a new version. You can always go back to previous versions if needed.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to update chapter',
    };
  }
}

export function executeCreateChapter(
  params: Record<string, unknown>,
  context: AUIContext
): AUIToolResult {
  const { title, content } = params as {
    title?: string;
    content?: string;
  };

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  if (!title) {
    return { success: false, error: 'Missing title parameter' };
  }

  try {
    const chapter = context.createChapter(title, content);

    if (!chapter) {
      return { success: false, error: 'Failed to create chapter' };
    }

    return {
      success: true,
      message: `Created Chapter ${chapter.number}: ${chapter.title}`,
      data: { chapterId: chapter.id, number: chapter.number, title: chapter.title },
      teaching: {
        whatHappened: `Created a new chapter "${chapter.title}" as Chapter ${chapter.number}`,
        guiPath: [
          'Open the Book panel (right side)',
          'Click the "Chapters" tab',
          'Click "+ New Chapter"',
          'Enter the title',
        ],
        shortcut: 'Press "N" while in the Book panel',
        why: 'Chapters organize your book. Start with an outline, then fill in content from your curated passages.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to create chapter',
    };
  }
}

export function executeDeleteChapter(
  params: Record<string, unknown>,
  context: AUIContext
): AUIToolResult {
  const { chapterId } = params as { chapterId?: string };

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  if (!chapterId) {
    return { success: false, error: 'Missing chapterId parameter' };
  }

  try {
    context.deleteChapter(chapterId);
    return {
      success: true,
      message: `Chapter deleted`,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to delete chapter',
    };
  }
}

export function executeRenderBook(context: AUIContext): AUIToolResult {
  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  try {
    const rendered = context.renderBook();
    return {
      success: true,
      message: `Book rendered (${context.activeProject.stats.chapters} chapters, ${context.activeProject.stats.wordCount} words)`,
      content: rendered,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to render book',
    };
  }
}

export function executeListChapters(context: AUIContext): AUIToolResult {
  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  const projectChapters = context.activeProject.chapters || context.activeProject.drafts?.chapters || [];
  const chapters = projectChapters.map(c => ({
    id: c.id,
    number: c.number,
    title: c.title,
    status: c.status,
    version: c.version,
    wordCount: c.wordCount,
  }));

  return {
    success: true,
    message: `${chapters.length} chapter(s) in project`,
    data: { chapters },
  };
}

export function executeGetChapter(
  params: Record<string, unknown>,
  context: AUIContext
): AUIToolResult {
  const { chapterId } = params as { chapterId?: string };

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  if (!chapterId) {
    return { success: false, error: 'Missing chapterId parameter' };
  }

  const chapter = context.getChapter(chapterId);

  if (!chapter) {
    return { success: false, error: `Chapter ${chapterId} not found` };
  }

  return {
    success: true,
    data: {
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
      content: chapter.content,
      version: chapter.version,
      wordCount: chapter.wordCount,
      status: chapter.status,
    },
  };
}

/**
 * AUI Tools - Passage Management
 *
 * Handles passage operations for book curation:
 * - Add passages to book projects
 * - List and organize passages
 * - Mark passages with curation status (gem/approved/rejected)
 */

import type { AUIContext, AUIToolResult } from './types';

// ═══════════════════════════════════════════════════════════════════
// PASSAGE MANAGEMENT TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Add a passage to the book project
 */
export function executeAddPassage(
  params: Record<string, unknown>,
  context: AUIContext
): AUIToolResult {
  const { text, title, tags } = params as {
    text?: string;
    title?: string;
    tags?: string[];
  };

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  if (!context.addPassage) {
    return { success: false, error: 'Passage management not available' };
  }

  // If no text provided, use workspace content
  let passageContent = text;
  let passageTitle = title;

  if (!passageContent && context.workspace) {
    if (context.workspace.selectedContent) {
      passageContent = context.workspace.selectedContent.text;
      passageTitle = passageTitle || context.workspace.selectedContent.title || `Facebook ${context.workspace.selectedContent.type}`;
    } else if (context.workspace.bufferContent) {
      passageContent = context.workspace.bufferContent;
      passageTitle = passageTitle || context.workspace.bufferName || 'Untitled passage';
    }
  }

  if (!passageContent) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  try {
    const passage = context.addPassage({
      content: passageContent,
      conversationTitle: passageTitle || passageContent.slice(0, 50) + '...',
      role: 'user',
      tags: tags || ['uncategorized'],
    });

    if (!passage) {
      return { success: false, error: 'Failed to add passage' };
    }

    const wordCount = passageContent.split(/\s+/).filter(w => w).length;

    return {
      success: true,
      message: `Added passage "${passage.conversationTitle}" with tags: ${passage.tags.join(', ')}`,
      data: {
        passageId: passage.id,
        title: passage.conversationTitle,
        tags: passage.tags,
        wordCount,
      },
      // Teaching output - show the user how to do this themselves
      teaching: {
        whatHappened: `Saved ${wordCount} words to your book's passage library under "${passage.conversationTitle}"`,
        guiPath: [
          'Open the Book panel (right side)',
          'Click the "Passages" tab',
          'Click "+ Add Passage"',
          'Paste your text and add tags',
        ],
        shortcut: 'Select text > Right-click > "Add to Book"',
        why: 'Passages are the raw material for your book. They get curated (approved/gem/rejected) before becoming chapters.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to add passage',
    };
  }
}

/**
 * List passages in the book project
 */
export function executeListPassages(context: AUIContext): AUIToolResult {
  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  if (!context.getPassages) {
    return { success: false, error: 'Passage management not available' };
  }

  try {
    const passages = context.getPassages();

    // Group by tags
    const byTag: Record<string, { count: number; gems: number; unreviewed: number }> = {};
    for (const p of passages) {
      for (const tag of p.tags || ['uncategorized']) {
        if (!byTag[tag]) {
          byTag[tag] = { count: 0, gems: 0, unreviewed: 0 };
        }
        byTag[tag].count++;
        if (p.status === 'gem') byTag[tag].gems++;
        if (p.status === 'unreviewed') byTag[tag].unreviewed++;
      }
    }

    const gemCount = passages.filter(p => p.status === 'gem').length;
    const unreviewedCount = passages.filter(p => p.status === 'unreviewed').length;

    return {
      success: true,
      message: `${passages.length} passage(s) with ${Object.keys(byTag).length} tag(s)`,
      data: {
        total: passages.length,
        byTag,
        passages: passages.slice(0, 20).map(p => ({
          id: p.id,
          title: p.conversationTitle,
          tags: p.tags,
          status: p.status,
          preview: p.content?.slice(0, 100),
        })),
      },
      teaching: {
        whatHappened: `Found ${passages.length} passages: ${gemCount} gems, ${unreviewedCount} unreviewed`,
        guiPath: [
          'Open the Book panel (right side)',
          'Click the "Passages" tab',
          'Use the filter dropdown to show gems/unreviewed',
        ],
        why: 'Review passages to mark the best ones as "gems" - these become the foundation of your chapters.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to list passages',
    };
  }
}

/**
 * Mark a passage with curation status
 */
export function executeMarkPassage(
  params: Record<string, unknown>,
  context: AUIContext
): AUIToolResult {
  const { passageId, status, notes } = params as {
    passageId?: string;
    status?: 'unreviewed' | 'approved' | 'gem' | 'rejected';
    notes?: string;
  };

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  if (!context.updatePassage) {
    return { success: false, error: 'Passage management not available' };
  }

  if (!passageId) {
    return { success: false, error: 'Missing passageId parameter' };
  }

  if (!status) {
    return { success: false, error: 'Missing status parameter (unreviewed/approved/gem/rejected)' };
  }

  try {
    context.updatePassage(passageId, {
      status,
      curatorNotes: notes,
    });

    const statusEmoji: Record<string, string> = {
      gem: '💎',
      approved: '✓',
      rejected: '✗',
      unreviewed: '○',
    };

    return {
      success: true,
      message: `${statusEmoji[status] || ''} Passage marked as "${status}"${notes ? ` with notes` : ''}`,
      data: { passageId, status },
      teaching: {
        whatHappened: `Changed passage status to "${status}"${status === 'gem' ? ' - this is your best material!' : ''}`,
        guiPath: [
          'Click on a passage in the Passages tab',
          'Click the status dropdown (unreviewed/approved/gem/rejected)',
          'Select the new status',
        ],
        shortcut: status === 'gem' ? 'Press "G" while viewing a passage' : undefined,
        why: status === 'gem'
          ? 'Gems are passages with exceptional quality - inflection points, high velocity, tension, or commitment.'
          : 'Curating passages helps you organize material for chapters.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to mark passage',
    };
  }
}

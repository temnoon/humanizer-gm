/**
 * AUI Tools - Workspace Operations
 *
 * Handles workspace state queries and content saving:
 * - Get current workspace state (view mode, content, media)
 * - Save workspace content to chapters
 */

import type { AUIContext, AUIToolResult } from './types';

// ═══════════════════════════════════════════════════════════════════
// WORKSPACE TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get current workspace state - what's being displayed
 */
export function executeGetWorkspace(context: AUIContext): AUIToolResult {
  const ws = context.workspace;

  if (!ws) {
    return {
      success: true,
      message: 'Workspace state not available',
      data: { viewMode: 'unknown' },
    };
  }

  const result: Record<string, unknown> = {
    viewMode: ws.viewMode,
  };

  if (ws.bufferContent) {
    result.buffer = {
      name: ws.bufferName,
      content: ws.bufferContent.slice(0, 500), // Preview only
      length: ws.bufferContent.length,
      wordCount: ws.bufferContent.split(/\s+/).filter(w => w).length,
    };
  }

  if (ws.selectedMedia) {
    result.media = {
      id: ws.selectedMedia.id,
      type: ws.selectedMedia.media_type,
      filename: ws.selectedMedia.filename,
      hasLinkedContent: (ws.selectedMedia.linkedContent?.length || 0) > 0,
    };
  }

  if (ws.selectedContent) {
    result.facebookContent = {
      id: ws.selectedContent.id,
      type: ws.selectedContent.type,
      title: ws.selectedContent.title,
      textPreview: ws.selectedContent.text.slice(0, 200),
      textLength: ws.selectedContent.text.length,
      hasMedia: (ws.selectedContent.media?.length || 0) > 0,
      isOwnContent: ws.selectedContent.is_own_content,
    };
  }

  return {
    success: true,
    message: `Workspace viewing: ${ws.viewMode}`,
    data: result,
  };
}

/**
 * Save current workspace content to a chapter
 */
export function executeSaveToChapter(
  params: Record<string, unknown>,
  context: AUIContext
): AUIToolResult {
  const { chapterId, append } = params as { chapterId?: string; append?: boolean };

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  if (!chapterId) {
    return { success: false, error: 'Missing chapterId parameter' };
  }

  const ws = context.workspace;
  if (!ws) {
    return { success: false, error: 'Workspace state not available' };
  }

  // Determine content to save
  let content: string | null = null;
  let source: string = 'unknown';

  if (ws.selectedContent) {
    content = ws.selectedContent.text;
    source = `Facebook ${ws.selectedContent.type}`;
  } else if (ws.bufferContent) {
    content = ws.bufferContent;
    source = ws.bufferName || 'buffer';
  }

  if (!content) {
    return { success: false, error: 'No content in workspace to save' };
  }

  try {
    const chapter = context.getChapter(chapterId);
    if (!chapter) {
      return { success: false, error: `Chapter ${chapterId} not found` };
    }

    const finalContent = append
      ? `${chapter.content}\n\n---\n\n${content}`
      : content;

    context.updateChapter(chapterId, finalContent, `Added content from ${source}`);

    const wordCount = content.split(/\s+/).filter(w => w).length;

    return {
      success: true,
      message: `${append ? 'Appended to' : 'Replaced'} chapter "${chapter.title}" with ${source} content`,
      data: { chapterId, contentLength: content.length },
      teaching: {
        whatHappened: `${append ? 'Added' : 'Replaced content with'} ${wordCount} words from ${source} in "${chapter.title}"`,
        guiPath: [
          'View content in the workspace (center panel)',
          'Open the Book panel (right side)',
          'Click "Add to Chapter" button',
          'Select a chapter from the dropdown',
          `Choose "${append ? 'Append' : 'Replace'}"`,
        ],
        why: append
          ? 'Appending adds new content to the end with a separator, preserving existing work.'
          : 'Replacing overwrites the chapter - useful when starting fresh.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to save to chapter',
    };
  }
}

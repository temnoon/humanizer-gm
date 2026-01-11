/**
 * AUI Tools - Workflow Operations
 *
 * Handles workflow orchestration:
 * - Discover thematic threads in passages
 * - Start guided book-building workflows
 */

import type { AUIContext, AUIToolResult, SourcePassage } from './types';

// ═══════════════════════════════════════════════════════════════════
// WORKFLOW TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Passage reference within a discovered thread
 */
export interface ThreadPassage {
  /** Passage ID */
  id: string;
  /** Preview text (first 100 chars) */
  text: string;
  /** Jaccard similarity to the thread theme (0.0 to 1.0) */
  similarity: number;
}

/**
 * A thematic thread discovered from passage analysis
 */
export interface DiscoveredThread {
  /** Theme keyword (capitalized) */
  theme: string;
  /** Passages belonging to this thread */
  passages: ThreadPassage[];
}

/**
 * Discover thematic threads in passages using AI clustering
 * Groups similar passages together to reveal common themes
 */
export async function executeDiscoverThreads(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { minPassages, maxThreads } = params as {
    minPassages?: number;
    maxThreads?: number;
  };

  // Get passages from book context
  if (!context.activeProject) {
    return {
      success: false,
      error: 'No active book project. Open a book project first.',
    };
  }

  const passages = context.getPassages?.() || [];
  if (passages.length < 3) {
    return {
      success: false,
      error: `Need at least 3 passages to discover threads. Currently have ${passages.length}.`,
    };
  }

  try {
    // Group passages by similarity using simple text clustering
    // In a full implementation, this would use embeddings
    const threads: DiscoveredThread[] = [];

    // Simple keyword extraction and grouping
    const keywordMap = new Map<string, string[]>();
    const passageKeywords = new Map<string, string[]>();

    // Extract keywords from each passage
    for (const passage of passages) {
      const text = typeof passage.content === 'string' ? passage.content : JSON.stringify(passage.content);
      // Simple keyword extraction (words 5+ chars, not common words)
      const commonWords = new Set(['about', 'which', 'their', 'there', 'would', 'could', 'should', 'where', 'these', 'those', 'being', 'having', 'making', 'during', 'through']);
      const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w: string) => w.length >= 5 && !commonWords.has(w));

      // Count word frequency
      const wordFreq = new Map<string, number>();
      for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }

      // Top keywords for this passage
      const topKeywords = Array.from(wordFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([w]) => w);

      passageKeywords.set(passage.id, topKeywords);

      // Build global keyword → passage mapping
      for (const kw of topKeywords) {
        if (!keywordMap.has(kw)) {
          keywordMap.set(kw, []);
        }
        keywordMap.get(kw)!.push(passage.id);
      }
    }

    // Find keywords that appear in multiple passages (themes)
    const themeKeywords = Array.from(keywordMap.entries())
      .filter(([, ids]) => ids.length >= (minPassages || 2))
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, maxThreads || 5);

    // Build threads from theme keywords
    const usedPassages = new Set<string>();
    for (const [theme, passageIds] of themeKeywords) {
      if (threads.length >= (maxThreads || 5)) break;

      const threadPassages = passageIds
        .filter((id: string) => !usedPassages.has(id))
        .map((id: string) => {
          const p = passages.find((p: SourcePassage) => p.id === id);
          if (!p) return null;
          usedPassages.add(id);

          // Calculate Jaccard similarity: how many of this passage's keywords match the theme
          const pKeywords = passageKeywords.get(id) || [];
          const matchingKeywords = pKeywords.filter((kw: string) => kw === theme.toLowerCase());
          const totalKeywords = Math.max(pKeywords.length, 1);
          const similarity = matchingKeywords.length / totalKeywords;

          return {
            id: p.id,
            text: (typeof p.content === 'string' ? p.content : '').slice(0, 100) + '...',
            similarity: Math.round(similarity * 100) / 100, // 0.0 to 1.0
          };
        })
        .filter(Boolean) as ThreadPassage[];

      if (threadPassages.length >= (minPassages || 2)) {
        threads.push({
          theme: theme.charAt(0).toUpperCase() + theme.slice(1),
          passages: threadPassages,
        });
      }
    }

    // Group remaining unclustered passages
    const unclustered = passages
      .filter((p: SourcePassage) => !usedPassages.has(p.id))
      .map((p: SourcePassage) => ({
        id: p.id,
        text: (typeof p.content === 'string' ? p.content : '').slice(0, 100) + '...',
      }));

    return {
      success: true,
      message: `Discovered ${threads.length} thematic threads from ${passages.length} passages`,
      data: {
        totalPassages: passages.length,
        threadCount: threads.length,
        threads: threads.map(t => ({
          theme: t.theme,
          passageCount: t.passages.length,
          previewPassages: t.passages.slice(0, 3),
        })),
        unclusteredCount: unclustered.length,
        unclustered: unclustered.slice(0, 5),
      },
      teaching: {
        whatHappened: `Analyzed ${passages.length} passages and found ${threads.length} common themes`,
        guiPath: ['Bookshelf', 'Threads', 'Review grouped passages'],
        why: 'Discovering threads helps you see patterns in your collected material and organize chapters around themes.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Thread discovery failed',
    };
  }
}

/**
 * Start a guided book-building workflow
 * Orchestrates multiple agents to help build a book step by step
 */
export async function executeStartBookWorkflow(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { workflowType, topic } = params as {
    workflowType?: 'harvest' | 'curate' | 'build' | 'full';
    topic?: string;
  };

  if (!context.activeProject) {
    return {
      success: false,
      error: 'No active book project. Create or open a book project first.',
    };
  }

  const workflow = workflowType || 'full';
  const projectTitle = context.activeProject.name || 'Untitled Book';

  try {
    // Define workflow steps based on type
    const steps: Array<{
      name: string;
      agentId: string;
      taskType: string;
      description: string;
    }> = [];

    switch (workflow) {
      case 'harvest':
        steps.push({
          name: 'Search Archive',
          agentId: 'harvester',
          taskType: 'search-archive',
          description: `Search for passages about "${topic || 'your topic'}"`,
        });
        break;

      case 'curate':
        steps.push({
          name: 'Assess Quality',
          agentId: 'curator',
          taskType: 'assess-passages',
          description: 'Review passages for book-worthiness',
        });
        steps.push({
          name: 'Organize Content',
          agentId: 'curator',
          taskType: 'organize-passages',
          description: 'Group passages by theme',
        });
        break;

      case 'build':
        steps.push({
          name: 'Discover Threads',
          agentId: 'builder',
          taskType: 'discover-threads',
          description: 'Find thematic patterns',
        });
        steps.push({
          name: 'Compose Chapters',
          agentId: 'builder',
          taskType: 'compose-chapter',
          description: 'Draft chapters from passages',
        });
        break;

      case 'full':
      default:
        steps.push({
          name: 'Harvest',
          agentId: 'harvester',
          taskType: 'search-archive',
          description: `Search for passages about "${topic || 'your topic'}"`,
        });
        steps.push({
          name: 'Curate',
          agentId: 'curator',
          taskType: 'assess-passages',
          description: 'Review and approve passages',
        });
        steps.push({
          name: 'Build Pyramid',
          agentId: 'builder',
          taskType: 'build-pyramid',
          description: 'Create hierarchical summary',
        });
        steps.push({
          name: 'Compose',
          agentId: 'builder',
          taskType: 'compose-chapter',
          description: 'Draft chapters from approved content',
        });
        steps.push({
          name: 'Review',
          agentId: 'reviewer',
          taskType: 'review-content',
          description: 'Check AI detection and quality',
        });
        break;
    }

    // Get current status
    const allPassages = context.getPassages?.() || [];
    const passageCount = allPassages.length;
    const approvedCount = allPassages.filter(
      (p: SourcePassage) => p.status === 'approved' || p.status === 'gem'
    ).length;
    const chapterCount = context.activeProject?.chapters?.length || 0;

    return {
      success: true,
      message: `Starting ${workflow} workflow for "${projectTitle}"`,
      data: {
        workflowType: workflow,
        project: projectTitle,
        currentState: {
          passages: passageCount,
          approved: approvedCount,
          chapters: chapterCount,
        },
        steps: steps.map((s, i) => ({
          step: i + 1,
          name: s.name,
          agent: s.agentId,
          description: s.description,
          status: 'pending',
        })),
        nextAction: steps[0]
          ? `First, the ${steps[0].agentId} will ${steps[0].description.toLowerCase()}`
          : 'No steps defined',
      },
      teaching: {
        whatHappened: `Initialized the "${workflow}" workflow with ${steps.length} steps`,
        guiPath: ['AUI Chat', 'Follow prompts', 'Approve agent proposals'],
        why: 'Guided workflows break complex tasks into manageable steps. Each agent specializes in a part of the process.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to start workflow',
    };
  }
}

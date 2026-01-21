/**
 * Metrics Service
 *
 * Computes and persists quality metrics for each stage of the book-making process.
 * Enables tracking progress and identifying areas for improvement.
 *
 * Stages:
 * 1. Harvest - Card collection quality
 * 2. Research - Theme/arc analysis quality
 * 3. Clustering - Grouping effectiveness
 * 4. Outline - Structure coverage
 * 5. Assignment - Card placement quality
 * 6. Draft - Content generation quality
 */

import { getDatabase, DbBookMetrics, DbCard, DbChapter, DbCluster, generateId } from '../database';

// ============================================================================
// Metric Types
// ============================================================================

export interface HarvestMetrics {
  cardCount: number;
  avgContentLength: number;
  minContentLength: number;
  maxContentLength: number;
  sourceDiversity: number; // Unique sources / total cards
  gradeDistribution: Record<number, number>; // grade (1-5) -> count
  avgGrade: number;
  gradedPercent: number;
  withTitles: number;
  withDates: number;
}

export interface ResearchMetrics {
  themeCount: number;
  avgThemeStrength: number;
  strongThemes: number; // Themes with strength >= 0.7
  arcCount: number;
  avgArcCompleteness: number;
  completeArcs: number; // Arcs with completeness >= 0.7
  coverageGapCount: number;
  majorGaps: number;
  keyPassageCount: number;
  orphanCards: number; // Cards not mapped to any theme
  confidence: number;
}

export interface ClusteringMetrics {
  clusterCount: number;
  avgClusterSize: number;
  minClusterSize: number;
  maxClusterSize: number;
  avgSimilarity: number;
  unclusteredCount: number;
  unclusteredPercent: number;
  singletonClusters: number; // Clusters with only 1 card
}

export interface OutlineMetrics {
  sectionCount: number;
  avgCardsPerSection: number;
  cardCoverage: number; // Cards assigned to sections / total cards
  keyPassageCoverage: number; // Key passages in sections / total key passages
  emptyCount: number; // Sections with no cards
  confidence: number;
}

export interface AssignmentMetrics {
  totalCards: number;
  assignedCount: number;
  stagingCount: number;
  assignedPercent: number;
  avgConfidence: number;
  highConfidenceCount: number; // Confidence >= 0.8
  lowConfidenceCount: number; // Confidence < 0.5
  orphanCount: number; // Cards with no suggested chapter
}

export interface DraftMetrics {
  chapterCount: number;
  totalWordCount: number;
  avgWordsPerChapter: number;
  chaptersWithDraft: number;
  chaptersWithoutDraft: number;
  sourceUtilization: number; // Cards used in drafts / total assigned cards
  avgSourcesPerChapter: number;
}

export interface BookMetrics {
  bookId: string;
  computedAt: string;
  harvest: HarvestMetrics;
  research: ResearchMetrics | null;
  clustering: ClusteringMetrics | null;
  outline: OutlineMetrics | null;
  assignment: AssignmentMetrics;
  draft: DraftMetrics;
  overallScore: number; // 0-100 composite score
  readinessLevel: 'harvesting' | 'researching' | 'organizing' | 'outlining' | 'drafting' | 'ready';
}

// ============================================================================
// Metric Computation
// ============================================================================

/**
 * Compute harvest metrics from cards
 */
export function computeHarvestMetrics(cards: DbCard[]): HarvestMetrics {
  if (cards.length === 0) {
    return {
      cardCount: 0,
      avgContentLength: 0,
      minContentLength: 0,
      maxContentLength: 0,
      sourceDiversity: 0,
      gradeDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      avgGrade: 0,
      gradedPercent: 0,
      withTitles: 0,
      withDates: 0,
    };
  }

  const contentLengths = cards.map(c => c.content.length);
  const uniqueSources = new Set(cards.map(c => c.source));

  // Parse grades
  const grades: number[] = [];
  const gradeDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  for (const card of cards) {
    if (card.grade) {
      try {
        const gradeObj = JSON.parse(card.grade);
        const overall = Math.round(gradeObj.overall || 0);
        if (overall >= 1 && overall <= 5) {
          grades.push(overall);
          gradeDistribution[overall]++;
        }
      } catch {
        // Skip invalid grades
      }
    }
  }

  return {
    cardCount: cards.length,
    avgContentLength: Math.round(contentLengths.reduce((a, b) => a + b, 0) / cards.length),
    minContentLength: Math.min(...contentLengths),
    maxContentLength: Math.max(...contentLengths),
    sourceDiversity: uniqueSources.size / cards.length,
    gradeDistribution,
    avgGrade: grades.length > 0 ? grades.reduce((a, b) => a + b, 0) / grades.length : 0,
    gradedPercent: (grades.length / cards.length) * 100,
    withTitles: cards.filter(c => c.title).length,
    withDates: cards.filter(c => c.source_created_at).length,
  };
}

/**
 * Compute research metrics from cached research
 */
export function computeResearchMetrics(researchJson: string | null): ResearchMetrics | null {
  if (!researchJson) return null;

  try {
    const research = JSON.parse(researchJson);

    const themes = research.themes || [];
    const arcs = research.arcs || [];
    const gaps = research.coverageGaps || [];
    const mappings = research.sourceMappings || [];

    const themeStrengths = themes.map((t: { strength: number }) => t.strength || 0);
    const arcCompleteness = arcs.map((a: { completeness: number }) => a.completeness || 0);

    return {
      themeCount: themes.length,
      avgThemeStrength: themeStrengths.length > 0
        ? themeStrengths.reduce((a: number, b: number) => a + b, 0) / themeStrengths.length
        : 0,
      strongThemes: themeStrengths.filter((s: number) => s >= 0.7).length,
      arcCount: arcs.length,
      avgArcCompleteness: arcCompleteness.length > 0
        ? arcCompleteness.reduce((a: number, b: number) => a + b, 0) / arcCompleteness.length
        : 0,
      completeArcs: arcCompleteness.filter((c: number) => c >= 0.7).length,
      coverageGapCount: gaps.length,
      majorGaps: gaps.filter((g: { severity: string }) => g.severity === 'major').length,
      keyPassageCount: mappings.filter((m: { isKeyPassage: boolean }) => m.isKeyPassage).length,
      orphanCards: mappings.filter((m: { themes: string[] }) => (m.themes || []).length === 0).length,
      confidence: research.confidence || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Compute clustering metrics
 */
export function computeClusteringMetrics(clusters: DbCluster[], totalCards: number): ClusteringMetrics {
  if (clusters.length === 0 || totalCards === 0) {
    return {
      clusterCount: 0,
      avgClusterSize: 0,
      minClusterSize: 0,
      maxClusterSize: 0,
      avgSimilarity: 0,
      unclusteredCount: totalCards,
      unclusteredPercent: 100,
      singletonClusters: 0,
    };
  }

  const clusterSizes: number[] = [];
  let clusteredCount = 0;

  for (const cluster of clusters) {
    try {
      const cardIds = JSON.parse(cluster.card_ids || '[]');
      const size = cardIds.length;
      clusterSizes.push(size);
      if (cluster.id !== 'unclustered') {
        clusteredCount += size;
      }
    } catch {
      clusterSizes.push(0);
    }
  }

  const unclusteredCount = totalCards - clusteredCount;

  return {
    clusterCount: clusters.filter(c => c.id !== 'unclustered').length,
    avgClusterSize: clusterSizes.length > 0
      ? clusterSizes.reduce((a, b) => a + b, 0) / clusterSizes.length
      : 0,
    minClusterSize: clusterSizes.length > 0 ? Math.min(...clusterSizes) : 0,
    maxClusterSize: clusterSizes.length > 0 ? Math.max(...clusterSizes) : 0,
    avgSimilarity: 0, // Would need to compute from cluster metadata
    unclusteredCount,
    unclusteredPercent: (unclusteredCount / totalCards) * 100,
    singletonClusters: clusterSizes.filter(s => s === 1).length,
  };
}

/**
 * Compute outline metrics
 */
export function computeOutlineMetrics(
  outlineJson: string | null,
  totalCards: number,
  keyPassageCount: number
): OutlineMetrics | null {
  if (!outlineJson) return null;

  try {
    const outline = JSON.parse(outlineJson);
    const items = outline.structure?.items || outline.items || [];

    let totalAssigned = 0;
    let keyPassagesInSections = 0;
    let emptyCount = 0;

    for (const item of items) {
      const cardIds = item.cardIds || [];
      totalAssigned += cardIds.length;
      if (cardIds.length === 0) emptyCount++;
      // Would need key passage mapping to compute keyPassagesInSections
    }

    return {
      sectionCount: items.length,
      avgCardsPerSection: items.length > 0 ? totalAssigned / items.length : 0,
      cardCoverage: totalCards > 0 ? (totalAssigned / totalCards) * 100 : 0,
      keyPassageCoverage: keyPassageCount > 0 ? (keyPassagesInSections / keyPassageCount) * 100 : 0,
      emptyCount,
      confidence: outline.confidence || outline.structure?.confidence || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Compute assignment metrics
 */
export function computeAssignmentMetrics(cards: DbCard[]): AssignmentMetrics {
  const assigned = cards.filter(c => c.status === 'placed' || c.chapter_id);
  const staging = cards.filter(c => c.status === 'staging' && !c.chapter_id);

  return {
    totalCards: cards.length,
    assignedCount: assigned.length,
    stagingCount: staging.length,
    assignedPercent: cards.length > 0 ? (assigned.length / cards.length) * 100 : 0,
    avgConfidence: 0, // Would need assignment proposal data
    highConfidenceCount: 0,
    lowConfidenceCount: 0,
    orphanCount: staging.length,
  };
}

/**
 * Compute draft metrics
 */
export function computeDraftMetrics(chapters: DbChapter[], assignedCards: number): DraftMetrics {
  const withDraft = chapters.filter(c => c.content && c.content.length > 100);
  const totalWords = chapters.reduce((sum, c) => sum + (c.word_count || 0), 0);

  return {
    chapterCount: chapters.length,
    totalWordCount: totalWords,
    avgWordsPerChapter: chapters.length > 0 ? totalWords / chapters.length : 0,
    chaptersWithDraft: withDraft.length,
    chaptersWithoutDraft: chapters.length - withDraft.length,
    sourceUtilization: 0, // Would need to track which cards were used
    avgSourcesPerChapter: assignedCards > 0 && chapters.length > 0
      ? assignedCards / chapters.length
      : 0,
  };
}

/**
 * Calculate overall score (0-100)
 */
export function calculateOverallScore(metrics: BookMetrics): number {
  let score = 0;
  let weights = 0;

  // Harvest (20 points max)
  if (metrics.harvest.cardCount > 0) {
    const harvestScore =
      Math.min(metrics.harvest.cardCount / 20, 1) * 5 + // Card count (max 5)
      Math.min(metrics.harvest.avgGrade / 5, 1) * 10 + // Avg grade (max 10)
      Math.min(metrics.harvest.gradedPercent / 100, 1) * 5; // Grading coverage (max 5)
    score += harvestScore;
    weights += 20;
  }

  // Research (20 points max)
  if (metrics.research) {
    const researchScore =
      Math.min(metrics.research.themeCount / 5, 1) * 5 + // Theme count (max 5)
      metrics.research.avgThemeStrength * 5 + // Theme strength (max 5)
      metrics.research.confidence * 5 + // Confidence (max 5)
      Math.max(0, 5 - metrics.research.majorGaps * 2); // Penalty for gaps (max 5)
    score += researchScore;
    weights += 20;
  }

  // Clustering (15 points max)
  if (metrics.clustering && metrics.clustering.clusterCount > 0) {
    const clusterScore =
      Math.min(metrics.clustering.clusterCount / 5, 1) * 5 + // Cluster count (max 5)
      Math.max(0, 5 - metrics.clustering.unclusteredPercent / 20) + // Unclustered penalty (max 5)
      Math.min(metrics.clustering.avgClusterSize / 5, 1) * 5; // Avg size (max 5)
    score += clusterScore;
    weights += 15;
  }

  // Outline (15 points max)
  if (metrics.outline) {
    const outlineScore =
      Math.min(metrics.outline.sectionCount / 10, 1) * 5 + // Section count (max 5)
      (metrics.outline.cardCoverage / 100) * 5 + // Coverage (max 5)
      metrics.outline.confidence * 5; // Confidence (max 5)
    score += outlineScore;
    weights += 15;
  }

  // Assignment (15 points max)
  const assignmentScore =
    (metrics.assignment.assignedPercent / 100) * 10 + // Assignment rate (max 10)
    Math.max(0, 5 - metrics.assignment.orphanCount / 5); // Orphan penalty (max 5)
  score += assignmentScore;
  weights += 15;

  // Draft (15 points max)
  const draftScore =
    (metrics.draft.chaptersWithDraft / Math.max(metrics.draft.chapterCount, 1)) * 10 + // Draft coverage (max 10)
    Math.min(metrics.draft.totalWordCount / 10000, 1) * 5; // Word count (max 5)
  score += draftScore;
  weights += 15;

  return weights > 0 ? Math.round((score / weights) * 100) : 0;
}

/**
 * Determine readiness level based on metrics
 */
export function determineReadinessLevel(metrics: BookMetrics): BookMetrics['readinessLevel'] {
  if (metrics.harvest.cardCount === 0) return 'harvesting';
  if (!metrics.research || metrics.research.confidence < 0.3) return 'researching';
  if (!metrics.clustering || metrics.clustering.clusterCount === 0) return 'organizing';
  if (!metrics.outline || metrics.outline.sectionCount === 0) return 'outlining';
  if (metrics.draft.chaptersWithDraft < metrics.draft.chapterCount) return 'drafting';
  return 'ready';
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Compute and save all metrics for a book
 */
export function computeAndSaveMetrics(bookId: string, userId?: string): BookMetrics {
  const db = getDatabase();

  // Get all cards for the book
  const cards = db.prepare(`
    SELECT * FROM cards WHERE book_id = ?
  `).all(bookId) as DbCard[];

  // Get chapters
  const chapters = db.prepare(`
    SELECT * FROM chapters WHERE book_id = ? ORDER BY "order"
  `).all(bookId) as DbChapter[];

  // Get clusters
  const clusters = db.prepare(`
    SELECT * FROM clusters WHERE book_id = ?
  `).all(bookId) as DbCluster[];

  // Get latest research cache
  const researchCache = db.prepare(`
    SELECT research_json FROM research_cache
    WHERE book_id = ?
    ORDER BY computed_at DESC LIMIT 1
  `).get(bookId) as { research_json: string } | undefined;

  // Get latest outline
  const outline = db.prepare(`
    SELECT structure_json FROM outlines
    WHERE book_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(bookId) as { structure_json: string } | undefined;

  // Compute all metrics
  const harvestMetrics = computeHarvestMetrics(cards);
  const researchMetrics = computeResearchMetrics(researchCache?.research_json || null);
  const clusteringMetrics = computeClusteringMetrics(clusters, cards.length);
  const outlineMetrics = computeOutlineMetrics(
    outline?.structure_json || null,
    cards.length,
    researchMetrics?.keyPassageCount || 0
  );
  const assignmentMetrics = computeAssignmentMetrics(cards);
  const draftMetrics = computeDraftMetrics(chapters, assignmentMetrics.assignedCount);

  const bookMetrics: BookMetrics = {
    bookId,
    computedAt: new Date().toISOString(),
    harvest: harvestMetrics,
    research: researchMetrics,
    clustering: clusteringMetrics,
    outline: outlineMetrics,
    assignment: assignmentMetrics,
    draft: draftMetrics,
    overallScore: 0,
    readinessLevel: 'harvesting',
  };

  // Calculate derived values
  bookMetrics.overallScore = calculateOverallScore(bookMetrics);
  bookMetrics.readinessLevel = determineReadinessLevel(bookMetrics);

  // Save to database
  const now = Date.now();
  const stages: Array<keyof Pick<BookMetrics, 'harvest' | 'research' | 'clustering' | 'outline' | 'assignment' | 'draft'>> = [
    'harvest', 'research', 'clustering', 'outline', 'assignment', 'draft'
  ];

  for (const stage of stages) {
    const stageMetrics = bookMetrics[stage];
    if (stageMetrics) {
      db.prepare(`
        INSERT OR REPLACE INTO book_metrics (id, book_id, stage, metrics_json, computed_at, user_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        generateId(),
        bookId,
        stage,
        JSON.stringify(stageMetrics),
        now,
        userId || null
      );
    }
  }

  return bookMetrics;
}

/**
 * Get latest metrics for a book
 */
export function getBookMetrics(bookId: string): BookMetrics | null {
  const db = getDatabase();

  // Get all stage metrics
  const rows = db.prepare(`
    SELECT stage, metrics_json, computed_at
    FROM book_metrics
    WHERE book_id = ?
    AND id IN (
      SELECT id FROM book_metrics bm2
      WHERE bm2.book_id = book_metrics.book_id
      AND bm2.stage = book_metrics.stage
      ORDER BY computed_at DESC LIMIT 1
    )
  `).all(bookId) as Array<{ stage: string; metrics_json: string; computed_at: number }>;

  if (rows.length === 0) return null;

  const metrics: Partial<BookMetrics> = {
    bookId,
    computedAt: new Date(Math.max(...rows.map(r => r.computed_at))).toISOString(),
  };

  for (const row of rows) {
    try {
      const stageMetrics = JSON.parse(row.metrics_json);
      (metrics as Record<string, unknown>)[row.stage] = stageMetrics;
    } catch {
      // Skip invalid JSON
    }
  }

  // Set defaults for missing stages
  const fullMetrics = metrics as BookMetrics;
  fullMetrics.harvest = fullMetrics.harvest || computeHarvestMetrics([]);
  fullMetrics.assignment = fullMetrics.assignment || computeAssignmentMetrics([]);
  fullMetrics.draft = fullMetrics.draft || computeDraftMetrics([], 0);

  // Recalculate derived values
  fullMetrics.overallScore = calculateOverallScore(fullMetrics);
  fullMetrics.readinessLevel = determineReadinessLevel(fullMetrics);

  return fullMetrics;
}

// Export singleton getter
let metricsService: MetricsService | null = null;

export class MetricsService {
  compute(bookId: string, userId?: string): BookMetrics {
    return computeAndSaveMetrics(bookId, userId);
  }

  get(bookId: string): BookMetrics | null {
    return getBookMetrics(bookId);
  }
}

export function getMetricsService(): MetricsService {
  if (!metricsService) {
    metricsService = new MetricsService();
  }
  return metricsService;
}

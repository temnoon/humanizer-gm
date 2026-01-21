/**
 * OutlineService - Server-side Outline Generation
 *
 * Moved from: apps/web/src/lib/book-studio/outline-agent.ts
 *
 * All business logic for outline research, theme extraction,
 * arc detection, and outline generation runs here.
 */

import Database from 'better-sqlite3';
import { getDatabase, DbCard, generateId, now } from '../database';
import { getConfig } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface ExtractedTheme {
  id: string;
  name: string;
  keywords: string[];
  cardIds: string[];
  strength: number;
  avgGrade: number;
  narrativeFunction?: 'setup' | 'payoff' | 'characterization' | 'worldbuilding' | 'transition';
}

export interface ArcPhase {
  type: 'setup' | 'development' | 'climax' | 'resolution';
  cardIds: string[];
  strength: number;
}

export interface NarrativeArc {
  id: string;
  name: string;
  phases: ArcPhase[];
  cardIds: string[];
  completeness: number;
}

export interface CoverageGap {
  theme: string;
  description: string;
  severity: 'minor' | 'moderate' | 'major';
  suggestedAction: string;
}

export interface SourceMapping {
  cardId: string;
  themes: string[];
  relevanceScores: Record<string, number>;
  narrativePosition?: 'early' | 'middle' | 'late';
  isKeyPassage: boolean;
}

export interface SuggestedSection {
  title: string;
  description: string;
  themeIds: string[];
  cardIds: string[];
  order: number;
  estimatedWordCount: number;
}

export interface OutlineResearch {
  themes: ExtractedTheme[];
  arcs: NarrativeArc[];
  sourceMappings: SourceMapping[];
  coverageGaps: CoverageGap[];
  strongAreas: string[];
  suggestedSections: SuggestedSection[];
  totalCards: number;
  analyzedAt: string;
  confidence: number;
}

export interface OutlineItem {
  level: number;
  text: string;
  children?: OutlineItem[];
}

export interface OutlineStructure {
  type: 'numbered' | 'bulleted' | 'hierarchical';
  items: OutlineItem[];
  depth: number;
  confidence: number;
}

export interface GeneratedOutline {
  structure: OutlineStructure;
  itemCardAssignments: Record<string, string[]>;
  confidence: number;
  generatedAt: string;
  basedOn: {
    research: boolean;
    proposedOutline: boolean;
    userPrompts: boolean;
  };
}

export interface OrderedSection {
  title: string;
  outlineItemPath: string;
  cards: HarvestCard[];
  keyPassageIds: string[];
}

// Internal card type (simplified from DbCard)
interface HarvestCard {
  id: string;
  content: string;
  title?: string;
  createdAt?: number;
  grade?: {
    overall?: number;
    chekhovAnalysis?: {
      function: 'setup' | 'payoff' | 'characterization' | 'worldbuilding' | 'transition';
      necessity: number;
    };
    inflection?: number;
  };
}

interface DbResearch {
  id: string;
  book_id: string;
  themes: string;
  arcs: string;
  source_mappings: string;
  coverage_gaps: string;
  strong_areas: string;
  suggested_sections: string;
  total_cards: number;
  confidence: number;
  created_at: number;
  updated_at: number;
}

// ============================================================================
// Stop Words
// ============================================================================

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'going', 'about', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
  'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'if', 'because',
  'while', 'although', 'though', 'after', 'before', 'until', 'unless',
  'since', 'that', 'whether', 'even', 'still', 'already',
  'yet', 'ever', 'never', 'always', 'often', 'sometimes', 'usually',
  'really', 'actually', 'basically', 'generally', 'probably', 'perhaps',
  'maybe', 'certainly', 'definitely', 'simply', 'merely', 'rather',
  'quite', 'somewhat', 'enough', 'almost', 'nearly', 'hardly', 'barely',
  'something', 'anything', 'nothing', 'everything', 'someone', 'anyone',
  'thing', 'things', 'way', 'ways', 'time', 'times', 'year', 'years',
  'day', 'days', 'people', 'person', 'man', 'woman', 'child', 'being',
  'made', 'make', 'said', 'say', 'says', 'got', 'get', 'gets',
  'went', 'come', 'came', 'take', 'took', 'see', 'saw', 'know', 'knew',
  'think', 'thought', 'want', 'wanted', 'look', 'looked', 'use',
  'find', 'found', 'give', 'gave', 'tell', 'told', 'work', 'worked',
  'seem', 'seemed', 'feel', 'felt', 'try', 'tried', 'leave', 'left',
  'call', 'called', 'keep', 'kept', 'let', 'begin', 'began',
  'help', 'show', 'hear', 'play', 'run', 'move', 'live', 'believe',
]);

// ============================================================================
// OutlineService
// ============================================================================

export class OutlineService {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
    this.ensureResearchTable();
  }

  /**
   * Ensure research cache table exists
   */
  private ensureResearchTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outline_research (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        themes TEXT,
        arcs TEXT,
        source_mappings TEXT,
        coverage_gaps TEXT,
        strong_areas TEXT,
        suggested_sections TEXT,
        total_cards INTEGER,
        confidence REAL,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(book_id)
      );
      CREATE INDEX IF NOT EXISTS idx_outline_research_book_id ON outline_research(book_id);
    `);
  }

  /**
   * Get cards for a book by status
   */
  private getBookCards(bookId: string, status: 'staging' | 'placed' | 'all' = 'staging'): HarvestCard[] {
    let query = 'SELECT * FROM cards WHERE book_id = ?';
    const params: (string | number)[] = [bookId];

    if (status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    const rows = this.db.prepare(query).all(...params) as DbCard[];

    return rows.map(row => ({
      id: row.id,
      content: row.content,
      title: row.title || undefined,
      createdAt: row.source_created_at || row.created_at,
      grade: row.grade ? JSON.parse(row.grade) : undefined,
    }));
  }

  /**
   * Run complete research phase on book's staging cards
   */
  async researchCards(bookId: string): Promise<OutlineResearch> {
    const cards = this.getBookCards(bookId, 'staging');

    if (cards.length === 0) {
      return {
        themes: [],
        arcs: [],
        sourceMappings: [],
        coverageGaps: [{
          theme: 'General',
          description: 'No cards to analyze',
          severity: 'major',
          suggestedAction: 'Harvest content before creating an outline',
        }],
        strongAreas: [],
        suggestedSections: [],
        totalCards: 0,
        analyzedAt: new Date().toISOString(),
        confidence: 0,
      };
    }

    // Extract themes
    const themes = this.extractThemes(cards);

    // Detect narrative arcs
    const arcs = this.detectNarrativeArcs(cards);

    // Map sources to themes
    const sourceMappings = this.mapSourcesToThemes(cards, themes);

    // Analyze coverage
    const { gaps, strengths } = this.analyzeCoverage(themes, arcs, sourceMappings);

    // Suggest sections
    const suggestedSections = this.suggestSections(themes, arcs, sourceMappings, cards);

    // Calculate overall confidence
    const themeConfidence = Math.min(themes.length / 3, 1);
    const arcConfidence = arcs.length > 0 ? arcs[0].completeness : 0;
    const coverageConfidence = 1 - (gaps.filter(g => g.severity === 'major').length * 0.2);
    const confidence = Math.max(0, Math.min(1, (themeConfidence + arcConfidence + coverageConfidence) / 3));

    const research: OutlineResearch = {
      themes,
      arcs,
      sourceMappings,
      coverageGaps: gaps,
      strongAreas: strengths,
      suggestedSections,
      totalCards: cards.length,
      analyzedAt: new Date().toISOString(),
      confidence,
    };

    // Persist research results
    await this.saveResearch(bookId, research);

    return research;
  }

  /**
   * Get cached research for a book
   */
  async getCachedResearch(bookId: string): Promise<OutlineResearch | null> {
    const row = this.db.prepare('SELECT * FROM outline_research WHERE book_id = ?').get(bookId) as DbResearch | undefined;

    if (!row) {
      return null;
    }

    return {
      themes: JSON.parse(row.themes || '[]'),
      arcs: JSON.parse(row.arcs || '[]'),
      sourceMappings: JSON.parse(row.source_mappings || '[]'),
      coverageGaps: JSON.parse(row.coverage_gaps || '[]'),
      strongAreas: JSON.parse(row.strong_areas || '[]'),
      suggestedSections: JSON.parse(row.suggested_sections || '[]'),
      totalCards: row.total_cards,
      analyzedAt: new Date(row.updated_at * 1000).toISOString(),
      confidence: row.confidence,
    };
  }

  /**
   * Get or create research (returns cached if fresh enough)
   */
  async getOrCreateResearch(bookId: string, maxAgeSeconds = 3600): Promise<OutlineResearch> {
    const row = this.db.prepare('SELECT * FROM outline_research WHERE book_id = ?').get(bookId) as DbResearch | undefined;

    if (row && (now() - row.updated_at) < maxAgeSeconds) {
      return {
        themes: JSON.parse(row.themes || '[]'),
        arcs: JSON.parse(row.arcs || '[]'),
        sourceMappings: JSON.parse(row.source_mappings || '[]'),
        coverageGaps: JSON.parse(row.coverage_gaps || '[]'),
        strongAreas: JSON.parse(row.strong_areas || '[]'),
        suggestedSections: JSON.parse(row.suggested_sections || '[]'),
        totalCards: row.total_cards,
        analyzedAt: new Date(row.updated_at * 1000).toISOString(),
        confidence: row.confidence,
      };
    }

    return this.researchCards(bookId);
  }

  /**
   * Save research to database
   */
  private async saveResearch(bookId: string, research: OutlineResearch): Promise<void> {
    const existing = this.db.prepare('SELECT id FROM outline_research WHERE book_id = ?').get(bookId);

    if (existing) {
      this.db.prepare(`
        UPDATE outline_research SET
          themes = ?,
          arcs = ?,
          source_mappings = ?,
          coverage_gaps = ?,
          strong_areas = ?,
          suggested_sections = ?,
          total_cards = ?,
          confidence = ?,
          updated_at = ?
        WHERE book_id = ?
      `).run(
        JSON.stringify(research.themes),
        JSON.stringify(research.arcs),
        JSON.stringify(research.sourceMappings),
        JSON.stringify(research.coverageGaps),
        JSON.stringify(research.strongAreas),
        JSON.stringify(research.suggestedSections),
        research.totalCards,
        research.confidence,
        now(),
        bookId
      );
    } else {
      this.db.prepare(`
        INSERT INTO outline_research (id, book_id, themes, arcs, source_mappings, coverage_gaps, strong_areas, suggested_sections, total_cards, confidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateId(),
        bookId,
        JSON.stringify(research.themes),
        JSON.stringify(research.arcs),
        JSON.stringify(research.sourceMappings),
        JSON.stringify(research.coverageGaps),
        JSON.stringify(research.strongAreas),
        JSON.stringify(research.suggestedSections),
        research.totalCards,
        research.confidence,
        now(),
        now()
      );
    }
  }

  /**
   * Generate outline from research
   */
  async generateOutline(
    bookId: string,
    options: { maxSections?: number; preferArcStructure?: boolean } = {}
  ): Promise<GeneratedOutline> {
    const config = getConfig();
    const maxSections = options.maxSections ?? config.outline.maxSections;

    // Get cached research or run fresh
    const research = await this.getOrCreateResearch(bookId);
    const cards = this.getBookCards(bookId, 'staging');

    // Generate outline items from research
    let items = this.generateOutlineItems(research, cards);

    // Limit sections if needed
    if (items.length > maxSections) {
      items.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      items = items.slice(0, maxSections);
    }

    // Order for narrative flow if requested
    if (options.preferArcStructure !== false && research.arcs.length > 0) {
      items = this.orderForNarrativeFlow(items, research, cards);
    }

    // Build card assignments
    const itemCardAssignments: Record<string, string[]> = {};
    items.forEach((item, index) => {
      if (item.cardIds) {
        itemCardAssignments[`${index}`] = item.cardIds;
      }
    });

    // Create structure
    const structure: OutlineStructure = {
      type: 'numbered',
      items: items.map(item => ({
        level: item.level || 0,
        text: item.text,
        children: undefined,
      })),
      depth: 1,
      confidence: items.length > 0
        ? items.reduce((sum, i) => sum + (i.confidence || 0), 0) / items.length
        : 0,
    };

    // Save outline to database
    const outlineId = generateId();
    this.db.prepare(`
      INSERT INTO outlines (id, book_id, structure_json, generated_at, source, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      outlineId,
      bookId,
      JSON.stringify(structure),
      now(),
      'research',
      structure.confidence,
      now()
    );

    return {
      structure,
      itemCardAssignments,
      confidence: structure.confidence,
      generatedAt: new Date().toISOString(),
      basedOn: {
        research: true,
        proposedOutline: false,
        userPrompts: false,
      },
    };
  }

  /**
   * Generate outline items from research
   */
  private generateOutlineItems(
    research: OutlineResearch,
    cards: HarvestCard[]
  ): Array<OutlineItem & { cardIds?: string[]; confidence?: number }> {
    const items: Array<OutlineItem & { cardIds?: string[]; confidence?: number }> = [];
    const usedCardIds = new Set<string>();

    // Use suggested sections from research
    for (const section of research.suggestedSections) {
      const unusedCards = section.cardIds.filter(id => !usedCardIds.has(id));
      if (unusedCards.length === 0) continue;

      items.push({
        level: 0,
        text: section.title,
        cardIds: unusedCards,
        confidence: research.themes
          .filter(t => section.themeIds.includes(t.id))
          .reduce((sum, t) => sum + t.strength, 0) / Math.max(section.themeIds.length, 1),
      });

      unusedCards.forEach(id => usedCardIds.add(id));
    }

    // Add any strong themes not already represented
    const config = getConfig();
    const minStrength = config.outline.themeRelevanceThreshold;

    for (const theme of research.themes) {
      const unusedCards = theme.cardIds.filter(id => !usedCardIds.has(id));
      if (unusedCards.length < 2 || theme.strength < minStrength) continue;

      // Check if this overlaps significantly with existing items
      const hasOverlap = items.some(item => {
        if (!item.cardIds) return false;
        const overlap = unusedCards.filter(id => item.cardIds!.includes(id)).length;
        return overlap > unusedCards.length * 0.5;
      });

      if (!hasOverlap) {
        items.push({
          level: 0,
          text: theme.name,
          cardIds: unusedCards,
          confidence: theme.strength,
        });
        unusedCards.forEach(id => usedCardIds.add(id));
      }
    }

    return items;
  }

  /**
   * Order items for narrative flow
   */
  private orderForNarrativeFlow(
    items: Array<OutlineItem & { cardIds?: string[]; confidence?: number }>,
    research: OutlineResearch,
    cards: HarvestCard[]
  ): Array<OutlineItem & { cardIds?: string[]; confidence?: number }> {
    const cardLookup = new Map(cards.map(c => [c.id, c]));

    const scoredItems = items.map(item => {
      const itemThemes = research.themes.filter(t =>
        item.cardIds?.some(id => t.cardIds.includes(id))
      );

      const hasSetup = itemThemes.some(t => t.narrativeFunction === 'setup');
      const hasPayoff = itemThemes.some(t => t.narrativeFunction === 'payoff');

      const itemCards = (item.cardIds || [])
        .map(id => cardLookup.get(id))
        .filter((c): c is HarvestCard => c !== undefined);

      const avgTime = itemCards.reduce((sum, c) => {
        if (!c.createdAt) return sum;
        return sum + c.createdAt;
      }, 0) / (itemCards.length || 1);

      let orderScore = avgTime || Date.now();
      if (hasSetup) orderScore -= 1e15;
      if (hasPayoff) orderScore += 1e15;

      return { item, orderScore };
    });

    scoredItems.sort((a, b) => a.orderScore - b.orderScore);
    return scoredItems.map(({ item }) => item);
  }

  /**
   * Order cards for draft generation within each section
   */
  async orderCardsForDraft(
    bookId: string,
    outlineId?: string
  ): Promise<OrderedSection[]> {
    const cards = this.getBookCards(bookId, 'staging');
    const cardLookup = new Map(cards.map(c => [c.id, c]));
    const research = await this.getOrCreateResearch(bookId);

    // Get outline
    let outline: OutlineStructure;
    if (outlineId) {
      const row = this.db.prepare('SELECT structure_json FROM outlines WHERE id = ?').get(outlineId) as { structure_json: string } | undefined;
      if (!row) throw new Error('Outline not found');
      outline = JSON.parse(row.structure_json);
    } else {
      const generated = await this.generateOutline(bookId);
      outline = generated.structure;
    }

    const sections: OrderedSection[] = [];

    outline.items.forEach((item, index) => {
      const path = `${index}`;

      // Find cards that match this outline item
      const matchingCards = this.findMatchingCardsForItem(item.text, cards, research.themes);

      const sectionCards = matchingCards
        .map(m => cardLookup.get(m.cardId))
        .filter((c): c is HarvestCard => c !== undefined)
        .sort((a, b) => {
          const gradeA = a.grade?.overall ?? 3;
          const gradeB = b.grade?.overall ?? 3;
          if (gradeA !== gradeB) return gradeB - gradeA;

          if (!a.createdAt && !b.createdAt) return 0;
          if (!a.createdAt) return 1;
          if (!b.createdAt) return -1;
          return a.createdAt - b.createdAt;
        });

      const keyPassageIds = research.sourceMappings
        .filter(m => m.isKeyPassage && matchingCards.some(mc => mc.cardId === m.cardId))
        .map(m => m.cardId);

      if (sectionCards.length > 0) {
        sections.push({
          title: item.text,
          outlineItemPath: path,
          cards: sectionCards,
          keyPassageIds,
        });
      }
    });

    return sections;
  }

  // ============================================================================
  // Theme Extraction
  // ============================================================================

  private extractKeywords(text: string, minLength = 4): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word =>
        word.length >= minLength &&
        !STOP_WORDS.has(word) &&
        !/^\d+$/.test(word)
      );
  }

  private calculateWordFrequency(cards: HarvestCard[]): Map<string, number> {
    const freq = new Map<string, number>();

    for (const card of cards) {
      const words = this.extractKeywords(card.content);
      const seen = new Set<string>();

      for (const word of words) {
        if (!seen.has(word)) {
          seen.add(word);
          freq.set(word, (freq.get(word) || 0) + 1);
        }
      }
    }

    return freq;
  }

  private findWordClusters(cards: HarvestCard[], minCooccurrence = 2): Map<string, Set<string>> {
    const cooccurrence = new Map<string, Map<string, number>>();

    for (const card of cards) {
      const words = [...new Set(this.extractKeywords(card.content))];

      for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j < words.length; j++) {
          const [w1, w2] = [words[i], words[j]].sort();

          if (!cooccurrence.has(w1)) {
            cooccurrence.set(w1, new Map());
          }
          const map = cooccurrence.get(w1)!;
          map.set(w2, (map.get(w2) || 0) + 1);
        }
      }
    }

    const clusters = new Map<string, Set<string>>();

    for (const [word1, cowords] of cooccurrence) {
      for (const [word2, count] of cowords) {
        if (count >= minCooccurrence) {
          let foundCluster = false;

          for (const [, cluster] of clusters) {
            if (cluster.has(word1) || cluster.has(word2)) {
              cluster.add(word1);
              cluster.add(word2);
              foundCluster = true;
              break;
            }
          }

          if (!foundCluster) {
            clusters.set(word1, new Set([word1, word2]));
          }
        }
      }
    }

    return clusters;
  }

  private extractThemes(cards: HarvestCard[]): ExtractedTheme[] {
    const config = getConfig();
    const themes: ExtractedTheme[] = [];

    const wordClusters = this.findWordClusters(cards);
    const wordFreq = this.calculateWordFrequency(cards);

    for (const [, wordSet] of wordClusters) {
      const keywords = [...wordSet]
        .sort((a, b) => (wordFreq.get(b) || 0) - (wordFreq.get(a) || 0))
        .slice(0, config.outline.topKeywordsPerTheme);

      const relevantCards = cards.filter(card => {
        const cardWords = new Set(this.extractKeywords(card.content));
        const matches = keywords.filter(k => cardWords.has(k)).length;
        return matches >= 2;
      });

      if (relevantCards.length >= config.outline.minCardsPerTheme) {
        const grades = relevantCards
          .map(c => c.grade?.overall)
          .filter((g): g is number => g !== undefined);
        const avgGrade = grades.length > 0
          ? grades.reduce((a, b) => a + b, 0) / grades.length
          : 3;

        const functions = relevantCards
          .map(c => c.grade?.chekhovAnalysis?.function)
          .filter((f): f is ExtractedTheme['narrativeFunction'] => f !== undefined);
        const dominantFunction = this.findMode(functions);

        themes.push({
          id: `theme-${themes.length}`,
          name: keywords.slice(0, 2).map(this.capitalize).join(' & '),
          keywords,
          cardIds: relevantCards.map(c => c.id),
          strength: Math.min(relevantCards.length / 5, 1),
          avgGrade,
          narrativeFunction: dominantFunction,
        });
      }
    }

    return themes.sort((a, b) => b.strength - a.strength).slice(0, config.outline.maxThemes);
  }

  // ============================================================================
  // Narrative Arc Detection
  // ============================================================================

  private detectNarrativeArcs(cards: HarvestCard[]): NarrativeArc[] {
    const arcs: NarrativeArc[] = [];

    const cardFunctions = cards.map(card => ({
      card,
      function: card.grade?.chekhovAnalysis?.function || 'transition' as const,
      necessity: card.grade?.chekhovAnalysis?.necessity || 0.5,
    }));

    const setups = cardFunctions.filter(cf => cf.function === 'setup');
    const payoffs = cardFunctions.filter(cf => cf.function === 'payoff');
    const characterizations = cardFunctions.filter(cf => cf.function === 'characterization');
    const worldbuilding = cardFunctions.filter(cf => cf.function === 'worldbuilding');
    const transitions = cardFunctions.filter(cf => cf.function === 'transition');

    if (setups.length > 0 || payoffs.length > 0) {
      const mainArc: NarrativeArc = {
        id: 'main-arc',
        name: 'Main Narrative',
        phases: [],
        cardIds: [],
        completeness: 0,
      };

      if (setups.length > 0) {
        mainArc.phases.push({
          type: 'setup',
          cardIds: setups.map(cf => cf.card.id),
          strength: Math.min(setups.length / 3, 1),
        });
        mainArc.cardIds.push(...setups.map(cf => cf.card.id));
      }

      const development = [...characterizations, ...worldbuilding, ...transitions];
      if (development.length > 0) {
        mainArc.phases.push({
          type: 'development',
          cardIds: development.map(cf => cf.card.id),
          strength: Math.min(development.length / 5, 1),
        });
        mainArc.cardIds.push(...development.map(cf => cf.card.id));
      }

      if (payoffs.length > 0) {
        mainArc.phases.push({
          type: 'resolution',
          cardIds: payoffs.map(cf => cf.card.id),
          strength: Math.min(payoffs.length / 2, 1),
        });
        mainArc.cardIds.push(...payoffs.map(cf => cf.card.id));
      }

      const phaseCount = mainArc.phases.length;
      const avgStrength = mainArc.phases.reduce((sum, p) => sum + p.strength, 0) / phaseCount;
      mainArc.completeness = (phaseCount / 4) * avgStrength;

      if (mainArc.cardIds.length >= 2) {
        arcs.push(mainArc);
      }
    }

    // Detect temporal arc
    const cardsWithDates = cards
      .filter(c => c.createdAt)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    if (cardsWithDates.length >= 4) {
      const thirds = Math.ceil(cardsWithDates.length / 3);
      const early = cardsWithDates.slice(0, thirds);
      const middle = cardsWithDates.slice(thirds, thirds * 2);
      const late = cardsWithDates.slice(thirds * 2);

      const earlyKeywords = new Set(early.flatMap(c => this.extractKeywords(c.content).slice(0, 10)));
      const lateKeywords = new Set(late.flatMap(c => this.extractKeywords(c.content).slice(0, 10)));

      const overlap = [...earlyKeywords].filter(k => lateKeywords.has(k));

      if (overlap.length >= 3) {
        arcs.push({
          id: 'temporal-arc',
          name: 'Temporal Evolution',
          phases: [
            { type: 'setup', cardIds: early.map(c => c.id), strength: 0.8 },
            { type: 'development', cardIds: middle.map(c => c.id), strength: 0.8 },
            { type: 'resolution', cardIds: late.map(c => c.id), strength: 0.8 },
          ],
          cardIds: cardsWithDates.map(c => c.id),
          completeness: 0.7,
        });
      }
    }

    return arcs;
  }

  // ============================================================================
  // Source Mapping
  // ============================================================================

  private mapSourcesToThemes(cards: HarvestCard[], themes: ExtractedTheme[]): SourceMapping[] {
    const config = getConfig();
    const mappings: SourceMapping[] = [];

    const sortedCards = [...cards].sort((a, b) => {
      if (!a.createdAt && !b.createdAt) return 0;
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return a.createdAt - b.createdAt;
    });

    const totalCards = sortedCards.length;

    for (let i = 0; i < sortedCards.length; i++) {
      const card = sortedCards[i];
      const cardKeywords = new Set(this.extractKeywords(card.content));
      const relevantThemes: string[] = [];
      const relevanceScores: Record<string, number> = {};

      for (const theme of themes) {
        const matchingKeywords = theme.keywords.filter(k => cardKeywords.has(k));
        const relevance = matchingKeywords.length / theme.keywords.length;

        if (relevance > config.outline.minRelevance) {
          relevantThemes.push(theme.id);
          relevanceScores[theme.id] = relevance;
        }
      }

      let narrativePosition: SourceMapping['narrativePosition'];
      if (card.createdAt) {
        const position = i / totalCards;
        if (position < 0.33) narrativePosition = 'early';
        else if (position < 0.67) narrativePosition = 'middle';
        else narrativePosition = 'late';
      }

      const isKeyPassage =
        (card.grade?.overall ?? 0) >= 4 ||
        (card.grade?.chekhovAnalysis?.necessity ?? 0) >= 0.7 ||
        (card.grade?.inflection ?? 0) >= 4;

      mappings.push({
        cardId: card.id,
        themes: relevantThemes,
        relevanceScores,
        narrativePosition,
        isKeyPassage,
      });
    }

    return mappings;
  }

  // ============================================================================
  // Coverage Analysis
  // ============================================================================

  private analyzeCoverage(
    themes: ExtractedTheme[],
    arcs: NarrativeArc[],
    mappings: SourceMapping[]
  ): { gaps: CoverageGap[]; strengths: string[] } {
    const config = getConfig();
    const gaps: CoverageGap[] = [];
    const strengths: string[] = [];

    for (const theme of themes) {
      if (theme.cardIds.length < config.outline.minCardsPerTheme) {
        gaps.push({
          theme: theme.name,
          description: `Only ${theme.cardIds.length} card(s) support this theme`,
          severity: 'moderate',
          suggestedAction: `Find more content related to: ${theme.keywords.join(', ')}`,
        });
      } else if (theme.strength >= 0.8) {
        strengths.push(`Strong coverage of "${theme.name}" (${theme.cardIds.length} cards)`);
      }

      if (theme.avgGrade < 3 && theme.cardIds.length >= 2) {
        gaps.push({
          theme: theme.name,
          description: `Theme "${theme.name}" has low average quality (${theme.avgGrade.toFixed(1)}/5)`,
          severity: 'minor',
          suggestedAction: 'Consider finding higher-quality sources or revising existing cards',
        });
      }
    }

    for (const arc of arcs) {
      const missingPhases: string[] = [];

      if (!arc.phases.some(p => p.type === 'setup')) missingPhases.push('setup/introduction');
      if (!arc.phases.some(p => p.type === 'development')) missingPhases.push('development/middle');
      if (!arc.phases.some(p => p.type === 'resolution')) missingPhases.push('resolution/conclusion');

      if (missingPhases.length > 0) {
        gaps.push({
          theme: arc.name,
          description: `Missing narrative phases: ${missingPhases.join(', ')}`,
          severity: missingPhases.length >= 2 ? 'major' : 'moderate',
          suggestedAction: `Add content that provides ${missingPhases.join(' and ')}`,
        });
      } else if (arc.completeness >= 0.7) {
        strengths.push(`Complete narrative arc: "${arc.name}"`);
      }
    }

    const orphanCount = mappings.filter(m => m.themes.length === 0).length;
    if (orphanCount > 0) {
      gaps.push({
        theme: 'General',
        description: `${orphanCount} card(s) don't fit any detected theme`,
        severity: orphanCount > 3 ? 'moderate' : 'minor',
        suggestedAction: 'Review orphan cards - they may need tagging or represent a new theme',
      });
    }

    const keyPassages = mappings.filter(m => m.isKeyPassage);
    if (keyPassages.length === 0) {
      gaps.push({
        theme: 'Quality',
        description: 'No high-quality key passages identified',
        severity: 'major',
        suggestedAction: 'Review card grades or harvest higher-quality content',
      });
    } else if (keyPassages.length >= 3) {
      strengths.push(`${keyPassages.length} key passages identified for emphasis`);
    }

    return { gaps, strengths };
  }

  // ============================================================================
  // Section Suggestion
  // ============================================================================

  private suggestSections(
    themes: ExtractedTheme[],
    arcs: NarrativeArc[],
    mappings: SourceMapping[],
    cards: HarvestCard[]
  ): SuggestedSection[] {
    const sections: SuggestedSection[] = [];
    const keyPassageIds = new Set(mappings.filter(m => m.isKeyPassage).map(m => m.cardId));

    const mainArc = arcs.find(a => a.id === 'main-arc' && a.completeness >= 0.5);

    if (mainArc) {
      let order = 1;

      for (const phase of mainArc.phases) {
        const phaseCards = cards.filter(c => phase.cardIds.includes(c.id));
        const wordCount = phaseCards.reduce((sum, c) => sum + c.content.split(/\s+/).length, 0);

        const phaseThemes = themes.filter(t =>
          t.cardIds.some(id => phase.cardIds.includes(id))
        );

        const keyCount = phase.cardIds.filter(id => keyPassageIds.has(id)).length;
        const keyNote = keyCount > 0 ? ` (${keyCount} key passage${keyCount > 1 ? 's' : ''})` : '';

        sections.push({
          title: this.getPhaseName(phase.type),
          description: `${phase.type} phase with ${phaseCards.length} cards${keyNote}`,
          themeIds: phaseThemes.map(t => t.id),
          cardIds: phase.cardIds,
          order: order++,
          estimatedWordCount: Math.round(wordCount * 1.5),
        });
      }
    } else {
      let order = 1;

      const sortedThemes = [...themes].sort((a, b) => {
        if (a.narrativeFunction === 'setup' && b.narrativeFunction !== 'setup') return -1;
        if (b.narrativeFunction === 'setup' && a.narrativeFunction !== 'setup') return 1;
        if (a.narrativeFunction === 'payoff' && b.narrativeFunction !== 'payoff') return 1;
        if (b.narrativeFunction === 'payoff' && a.narrativeFunction !== 'payoff') return -1;
        return b.strength - a.strength;
      });

      for (const theme of sortedThemes.slice(0, 6)) {
        const themeCards = cards.filter(c => theme.cardIds.includes(c.id));
        const wordCount = themeCards.reduce((sum, c) => sum + c.content.split(/\s+/).length, 0);

        const keyCount = theme.cardIds.filter(id => keyPassageIds.has(id)).length;
        const keyNote = keyCount > 0 ? ` - ${keyCount} key passage${keyCount > 1 ? 's' : ''}` : '';

        sections.push({
          title: theme.name,
          description: `Based on theme: ${theme.keywords.slice(0, 3).join(', ')}${keyNote}`,
          themeIds: [theme.id],
          cardIds: theme.cardIds,
          order: order++,
          estimatedWordCount: Math.round(wordCount * 1.5),
        });
      }
    }

    return sections;
  }

  private getPhaseName(type: ArcPhase['type']): string {
    switch (type) {
      case 'setup': return 'Introduction';
      case 'development': return 'Development';
      case 'climax': return 'Turning Point';
      case 'resolution': return 'Conclusion';
    }
  }

  // ============================================================================
  // Card Matching
  // ============================================================================

  private findMatchingCardsForItem(
    outlineText: string,
    cards: HarvestCard[],
    themes: ExtractedTheme[],
    minRelevance = 0.2
  ): { cardId: string; relevance: number }[] {
    const matches: { cardId: string; relevance: number }[] = [];

    const outlineKeywords = new Set(this.extractKeywords(outlineText, 3));
    if (outlineKeywords.size === 0) return [];

    const matchingThemes = themes.filter(theme => {
      const overlap = theme.keywords.filter(k => outlineKeywords.has(k)).length;
      return overlap / theme.keywords.length > 0.3;
    });

    const themeCardIds = new Set(matchingThemes.flatMap(t => t.cardIds));

    for (const card of cards) {
      const cardKeywords = new Set(this.extractKeywords(card.content, 3));

      const textMatches = [...outlineKeywords].filter(w => cardKeywords.has(w)).length;
      const textRelevance = textMatches / outlineKeywords.size;

      const themeBoost = themeCardIds.has(card.id) ? 0.2 : 0;

      let titleRelevance = 0;
      if (card.title) {
        const titleKeywords = new Set(this.extractKeywords(card.title, 3));
        const titleMatches = [...outlineKeywords].filter(w => titleKeywords.has(w)).length;
        titleRelevance = outlineKeywords.size > 0 ? (titleMatches / outlineKeywords.size) * 0.3 : 0;
      }

      const totalRelevance = Math.min(1, textRelevance + themeBoost + titleRelevance);

      if (totalRelevance >= minRelevance) {
        matches.push({ cardId: card.id, relevance: totalRelevance });
      }
    }

    return matches.sort((a, b) => b.relevance - a.relevance);
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private findMode<T>(arr: T[]): T | undefined {
    if (arr.length === 0) return undefined;

    const counts = new Map<T, number>();
    for (const item of arr) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }

    let maxCount = 0;
    let mode: T | undefined;

    for (const [item, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mode = item;
      }
    }

    return mode;
  }
}

// Singleton instance
let outlineServiceInstance: OutlineService | null = null;

export function getOutlineService(): OutlineService {
  if (!outlineServiceInstance) {
    outlineServiceInstance = new OutlineService();
  }
  return outlineServiceInstance;
}

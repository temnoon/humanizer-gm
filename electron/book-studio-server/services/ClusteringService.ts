/**
 * ClusteringService - Server-side Semantic Clustering
 *
 * Moved from: apps/web/src/lib/book-studio/clustering.ts
 *
 * Clusters harvest cards by semantic similarity.
 * Uses keyword-based clustering for fast local operation.
 */

import Database from 'better-sqlite3';
import { getDatabase, DbCard, generateId, now } from '../database';
import { getConfig } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface SemanticCluster {
  id: string;
  name: string;
  theme?: string;
  cardIds: string[];
  seedCardId: string;
  avgSimilarity: number;
}

export interface ClusteringResult {
  clusters: SemanticCluster[];
  unclusteredCardIds: string[];
  stats: {
    totalCards: number;
    clusteredCards: number;
    clusterCount: number;
    avgClusterSize: number;
  };
  computedAt: string;
}

export interface ClusteringOptions {
  similarityThreshold?: number;
  minClusterSize?: number;
  maxClusters?: number;
  jaccardThreshold?: number;
}

// Internal card type
interface HarvestCard {
  id: string;
  content: string;
  title?: string;
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
  'while', 'although', 'though', 'until', 'unless',
  'since', 'whether', 'even', 'still', 'already',
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
// ClusteringService
// ============================================================================

export class ClusteringService {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  /**
   * Get cards for a book
   */
  private getBookCards(bookId: string, status: 'staging' | 'placed' | 'all' = 'staging'): HarvestCard[] {
    let query = 'SELECT id, content, title FROM cards WHERE book_id = ?';
    const params: (string | number)[] = [bookId];

    if (status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{ id: string; content: string; title: string | null }>;

    return rows.map(row => ({
      id: row.id,
      content: row.content,
      title: row.title || undefined,
    }));
  }

  /**
   * Compute clusters for a book's cards
   */
  computeClusters(
    bookId: string,
    options: ClusteringOptions = {}
  ): ClusteringResult {
    const config = getConfig();
    const opts = {
      similarityThreshold: options.similarityThreshold ?? config.clustering.similarityThreshold,
      minClusterSize: options.minClusterSize ?? config.clustering.minClusterSize,
      maxClusters: options.maxClusters ?? config.clustering.maxClusters,
      jaccardThreshold: options.jaccardThreshold ?? config.clustering.jaccardThreshold,
    };

    const cards = this.getBookCards(bookId, 'staging');

    if (cards.length === 0) {
      return {
        clusters: [],
        unclusteredCardIds: [],
        stats: {
          totalCards: 0,
          clusteredCards: 0,
          clusterCount: 0,
          avgClusterSize: 0,
        },
        computedAt: new Date().toISOString(),
      };
    }

    // For small sets, use quick clustering
    if (cards.length < 10) {
      return this.quickClusterByContent(cards, opts);
    }

    // For larger sets, use full clustering algorithm
    return this.clusterByKeywordSimilarity(cards, opts);
  }

  /**
   * Quick clustering for small card sets (under 10 cards)
   */
  private quickClusterByContent(
    cards: HarvestCard[],
    opts: Required<ClusteringOptions>
  ): ClusteringResult {
    if (cards.length < 3) {
      // Too few cards - put all in one cluster
      return {
        clusters: [{
          id: 'all',
          name: this.generateThemeLabel(cards),
          cardIds: cards.map(c => c.id),
          seedCardId: cards[0].id,
          avgSimilarity: 1,
        }],
        unclusteredCardIds: [],
        stats: {
          totalCards: cards.length,
          clusteredCards: cards.length,
          clusterCount: 1,
          avgClusterSize: cards.length,
        },
        computedAt: new Date().toISOString(),
      };
    }

    const clusters: SemanticCluster[] = [];
    const clustered = new Set<string>();

    for (const card of cards) {
      if (clustered.has(card.id)) continue;

      const cardWords = new Set(
        card.content.toLowerCase().split(/\s+/).filter(w => w.length > 4)
      );

      const clusterCardIds = [card.id];
      clustered.add(card.id);

      for (const other of cards) {
        if (clustered.has(other.id)) continue;

        const otherWords = new Set(
          other.content.toLowerCase().split(/\s+/).filter(w => w.length > 4)
        );

        // Calculate Jaccard similarity
        const intersection = new Set([...cardWords].filter(w => otherWords.has(w)));
        const union = new Set([...cardWords, ...otherWords]);
        const similarity = union.size > 0 ? intersection.size / union.size : 0;

        if (similarity > opts.jaccardThreshold) {
          clusterCardIds.push(other.id);
          clustered.add(other.id);
        }
      }

      if (clusterCardIds.length >= opts.minClusterSize) {
        const clusterCards = cards.filter(c => clusterCardIds.includes(c.id));
        clusters.push({
          id: `quick-${clusters.length}`,
          name: this.generateThemeLabel(clusterCards),
          cardIds: clusterCardIds,
          seedCardId: card.id,
          avgSimilarity: 0.5,
        });
      }
    }

    const unclusteredCardIds = cards.filter(c => !clustered.has(c.id)).map(c => c.id);

    // Add unclustered as separate cluster if any
    if (unclusteredCardIds.length > 0 && unclusteredCardIds.length >= opts.minClusterSize) {
      const unclusteredCards = cards.filter(c => unclusteredCardIds.includes(c.id));
      clusters.push({
        id: 'unclustered',
        name: 'Unclustered',
        cardIds: unclusteredCardIds,
        seedCardId: unclusteredCardIds[0],
        avgSimilarity: 0,
      });
    }

    const clusteredCount = cards.length - unclusteredCardIds.length;

    return {
      clusters,
      unclusteredCardIds: unclusteredCardIds.length < opts.minClusterSize ? unclusteredCardIds : [],
      stats: {
        totalCards: cards.length,
        clusteredCards: clusteredCount,
        clusterCount: clusters.length,
        avgClusterSize: clusters.length > 0 ? clusteredCount / clusters.length : 0,
      },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Full clustering algorithm using keyword similarity
   */
  private clusterByKeywordSimilarity(
    cards: HarvestCard[],
    opts: Required<ClusteringOptions>
  ): ClusteringResult {
    // Build similarity matrix using keyword overlap
    const similarityMap = new Map<string, Map<string, number>>();

    for (const card of cards) {
      const cardKeywords = this.extractKeywords(card.content);
      const similarities = new Map<string, number>();

      for (const other of cards) {
        if (other.id === card.id) continue;

        const otherKeywords = this.extractKeywords(other.content);
        const similarity = this.jaccardSimilarity(cardKeywords, otherKeywords);
        similarities.set(other.id, similarity);
      }

      similarityMap.set(card.id, similarities);
    }

    // Greedy clustering
    const clusters: SemanticCluster[] = [];
    const clustered = new Set<string>();
    const remainingCards = [...cards];

    while (remainingCards.length > 0 && clusters.length < opts.maxClusters) {
      const seed = remainingCards[0];
      const clusterCardIds: string[] = [seed.id];
      const similarities: number[] = [];

      clustered.add(seed.id);
      remainingCards.splice(0, 1);

      const seedSimilarities = similarityMap.get(seed.id) || new Map();

      // Find similar cards
      for (let i = remainingCards.length - 1; i >= 0; i--) {
        const candidate = remainingCards[i];
        const similarity = seedSimilarities.get(candidate.id) || 0;

        if (similarity >= opts.similarityThreshold) {
          clusterCardIds.push(candidate.id);
          similarities.push(similarity);
          clustered.add(candidate.id);
          remainingCards.splice(i, 1);
        }
      }

      // Expand cluster by transitivity
      let changed = true;
      while (changed && remainingCards.length > 0) {
        changed = false;
        for (let i = remainingCards.length - 1; i >= 0; i--) {
          const candidate = remainingCards[i];

          for (const clusteredId of clusterCardIds) {
            const cardSims = similarityMap.get(clusteredId);
            const similarity = cardSims?.get(candidate.id) || 0;

            if (similarity >= opts.similarityThreshold) {
              clusterCardIds.push(candidate.id);
              similarities.push(similarity);
              clustered.add(candidate.id);
              remainingCards.splice(i, 1);
              changed = true;
              break;
            }
          }
        }
      }

      // Create cluster if meets minimum size
      if (clusterCardIds.length >= opts.minClusterSize) {
        const avgSim = similarities.length > 0
          ? similarities.reduce((a, b) => a + b, 0) / similarities.length
          : 1.0;

        const clusterCards = cards.filter(c => clusterCardIds.includes(c.id));

        clusters.push({
          id: `semantic-${clusters.length}`,
          name: this.generateThemeLabel(clusterCards),
          cardIds: clusterCardIds,
          seedCardId: seed.id,
          avgSimilarity: avgSim,
        });
      } else {
        // Put back if cluster too small
        for (const id of clusterCardIds) {
          if (id !== seed.id) {
            const card = cards.find(c => c.id === id);
            if (card) {
              remainingCards.push(card);
              clustered.delete(id);
            }
          }
        }
      }
    }

    // Handle remaining unclustered cards
    const unclusteredCardIds = cards.filter(c => !clustered.has(c.id)).map(c => c.id);

    if (unclusteredCardIds.length >= opts.minClusterSize) {
      const unclusteredCards = cards.filter(c => unclusteredCardIds.includes(c.id));
      clusters.push({
        id: 'unclustered',
        name: 'Unclustered',
        cardIds: unclusteredCardIds,
        seedCardId: unclusteredCardIds[0],
        avgSimilarity: 0,
      });
    }

    const clusteredCount = cards.length - unclusteredCardIds.length;

    return {
      clusters,
      unclusteredCardIds: unclusteredCardIds.length < opts.minClusterSize ? unclusteredCardIds : [],
      stats: {
        totalCards: cards.length,
        clusteredCards: clusteredCount,
        clusterCount: clusters.length,
        avgClusterSize: clusters.length > 0 ? clusteredCount / clusters.length : 0,
      },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Save clusters to database
   */
  saveClusters(bookId: string, result: ClusteringResult): void {
    // Delete existing clusters for this book
    this.db.prepare('DELETE FROM clusters WHERE book_id = ?').run(bookId);

    // Insert new clusters
    const stmt = this.db.prepare(`
      INSERT INTO clusters (id, book_id, name, card_ids, seed_card_id, centroid, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `);

    const timestamp = now();

    for (const cluster of result.clusters) {
      stmt.run(
        cluster.id,
        bookId,
        cluster.name,
        JSON.stringify(cluster.cardIds),
        cluster.seedCardId,
        timestamp,
        timestamp
      );
    }
  }

  /**
   * Get saved clusters for a book
   */
  getSavedClusters(bookId: string): SemanticCluster[] {
    const rows = this.db.prepare('SELECT * FROM clusters WHERE book_id = ?').all(bookId) as Array<{
      id: string;
      name: string;
      card_ids: string;
      seed_card_id: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      cardIds: JSON.parse(row.card_ids || '[]'),
      seedCardId: row.seed_card_id,
      avgSimilarity: 0.5, // Not stored, use default
    }));
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private extractKeywords(text: string, minLength = 4): Set<string> {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word =>
        word.length >= minLength &&
        !STOP_WORDS.has(word) &&
        !/^\d+$/.test(word)
      );

    return new Set(words);
  }

  private jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 && set2.size === 0) return 0;

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  private generateThemeLabel(cards: HarvestCard[]): string {
    const wordFreq = new Map<string, number>();

    for (const card of cards) {
      const words = [...this.extractKeywords(card.content)];
      const seen = new Set<string>();

      for (const word of words) {
        if (!seen.has(word)) {
          seen.add(word);
          wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }
      }
    }

    const sorted = Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word);

    if (sorted.length === 0) {
      return 'Unnamed Theme';
    }

    return sorted
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' & ');
  }
}

// Singleton instance
let clusteringServiceInstance: ClusteringService | null = null;

export function getClusteringService(): ClusteringService {
  if (!clusteringServiceInstance) {
    clusteringServiceInstance = new ClusteringService();
  }
  return clusteringServiceInstance;
}

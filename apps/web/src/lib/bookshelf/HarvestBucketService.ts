/**
 * HarvestBucketService - Manages temporary staging for book content
 *
 * Features:
 * - Creates and manages harvest buckets
 * - Tracks passage curation (approve/reject/gem)
 * - Handles commit to book project
 * - Persists to localStorage (auto-cleanup after commit)
 */

import type {
  EntityURI,
  SourcePassage,
  HarvestConfig,
  BookProject,
} from '@humanizer/core';
import {
  type HarvestBucket,
  type HarvestStats,
  type NarrativeArc,
  type PassageLink,
  createHarvestBucket,
  createNarrativeArc,
  createPassageLink,
  isHarvestTerminal,
  getAllApproved,
} from '@humanizer/core';
import { bookshelfService } from './BookshelfService';

// ═══════════════════════════════════════════════════════════════════
// STORAGE KEYS
// ═══════════════════════════════════════════════════════════════════

const STORAGE_KEYS = {
  buckets: 'humanizer-harvest-buckets',
  arcs: 'humanizer-narrative-arcs',
  links: 'humanizer-passage-links',
};

// Auto-cleanup buckets older than 7 days
const BUCKET_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════
// HARVEST BUCKET SERVICE
// ═══════════════════════════════════════════════════════════════════

class HarvestBucketService {
  private buckets: Map<string, HarvestBucket> = new Map();
  private arcs: Map<string, NarrativeArc> = new Map();
  private links: Map<string, PassageLink> = new Map();
  private loaded = false;

  // ─────────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Load all harvest data from storage
   */
  initialize(): void {
    if (this.loaded) return;

    this.loadFromStorage();
    this.cleanupExpiredBuckets();

    this.loaded = true;
  }

  /**
   * Load from localStorage
   */
  private loadFromStorage(): void {
    try {
      // Load buckets
      const bucketsJson = localStorage.getItem(STORAGE_KEYS.buckets);
      if (bucketsJson) {
        const buckets = JSON.parse(bucketsJson) as HarvestBucket[];
        for (const bucket of buckets) {
          this.buckets.set(bucket.id, bucket);
        }
      }

      // Load arcs
      const arcsJson = localStorage.getItem(STORAGE_KEYS.arcs);
      if (arcsJson) {
        const arcs = JSON.parse(arcsJson) as NarrativeArc[];
        for (const arc of arcs) {
          this.arcs.set(arc.id, arc);
        }
      }

      // Load links
      const linksJson = localStorage.getItem(STORAGE_KEYS.links);
      if (linksJson) {
        const links = JSON.parse(linksJson) as PassageLink[];
        for (const link of links) {
          this.links.set(link.id, link);
        }
      }
    } catch (e) {
      console.error('Failed to load harvest data:', e);
    }
  }

  /**
   * Save to localStorage
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem(
        STORAGE_KEYS.buckets,
        JSON.stringify(Array.from(this.buckets.values()))
      );
      localStorage.setItem(
        STORAGE_KEYS.arcs,
        JSON.stringify(Array.from(this.arcs.values()))
      );
      localStorage.setItem(
        STORAGE_KEYS.links,
        JSON.stringify(Array.from(this.links.values()))
      );
    } catch (e) {
      console.error('Failed to save harvest data:', e);
    }
  }

  /**
   * Remove expired/terminal buckets
   */
  private cleanupExpiredBuckets(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, bucket] of this.buckets) {
      // Delete if terminal and older than expiry
      if (isHarvestTerminal(bucket)) {
        const age = now - (bucket.finalizedAt || bucket.createdAt);
        if (age > BUCKET_EXPIRY_MS) {
          toDelete.push(id);
        }
      }
    }

    for (const id of toDelete) {
      this.buckets.delete(id);
    }

    if (toDelete.length > 0) {
      this.saveToStorage();
      console.log(`[HarvestBucketService] Cleaned up ${toDelete.length} expired buckets`);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // BUCKET OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a new harvest bucket for a book
   */
  createBucket(
    bookUri: EntityURI,
    queries: string[],
    options?: {
      threadUri?: EntityURI;
      config?: Partial<HarvestConfig>;
      initiatedBy?: 'user' | 'aui';
    }
  ): HarvestBucket {
    const bucket = createHarvestBucket(bookUri, queries, options);
    this.buckets.set(bucket.id, bucket);
    this.saveToStorage();
    return bucket;
  }

  /**
   * Get a bucket by ID
   */
  getBucket(bucketId: string): HarvestBucket | undefined {
    return this.buckets.get(bucketId);
  }

  /**
   * Get all buckets for a book
   */
  getBucketsForBook(bookUri: EntityURI): HarvestBucket[] {
    return Array.from(this.buckets.values())
      .filter((b) => b.bookUri === bookUri)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get active (non-terminal) buckets for a book
   */
  getActiveBucketsForBook(bookUri: EntityURI): HarvestBucket[] {
    return this.getBucketsForBook(bookUri).filter((b) => !isHarvestTerminal(b));
  }

  /**
   * Update a bucket
   */
  updateBucket(
    bucketId: string,
    updates: Partial<HarvestBucket>
  ): HarvestBucket | undefined {
    const bucket = this.buckets.get(bucketId);
    if (!bucket) return undefined;

    const updated: HarvestBucket = {
      ...bucket,
      ...updates,
      id: bucket.id, // Don't allow ID change
      updatedAt: Date.now(),
    };

    this.buckets.set(bucketId, updated);
    this.saveToStorage();
    return updated;
  }

  /**
   * Delete a bucket
   */
  deleteBucket(bucketId: string): boolean {
    const deleted = this.buckets.delete(bucketId);
    if (deleted) {
      this.saveToStorage();
    }
    return deleted;
  }

  // ─────────────────────────────────────────────────────────────────
  // PASSAGE CURATION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Add a passage to candidates
   */
  addCandidate(bucketId: string, passage: SourcePassage): HarvestBucket | undefined {
    const bucket = this.buckets.get(bucketId);
    if (!bucket || isHarvestTerminal(bucket)) return undefined;

    // Check for duplicates
    const isDuplicate = this.checkDuplicate(bucket, passage);
    if (isDuplicate) {
      const updated = this.updateBucket(bucketId, {
        duplicateIds: [...bucket.duplicateIds, passage.id],
        stats: {
          ...bucket.stats,
          duplicates: bucket.stats.duplicates + 1,
        },
      });
      return updated;
    }

    const updatedCandidates = [...bucket.candidates, passage];
    const avgSimilarity = this.calculateAvgSimilarity(updatedCandidates);

    return this.updateBucket(bucketId, {
      candidates: updatedCandidates,
      stats: {
        ...bucket.stats,
        totalCandidates: updatedCandidates.length,
        avgSimilarity,
      },
    });
  }

  /**
   * Add multiple passages to candidates
   */
  addCandidates(bucketId: string, passages: SourcePassage[]): HarvestBucket | undefined {
    let bucket = this.buckets.get(bucketId);
    if (!bucket || isHarvestTerminal(bucket)) return undefined;

    for (const passage of passages) {
      bucket = this.addCandidate(bucketId, passage);
      if (!bucket) break;
    }

    return bucket;
  }

  /**
   * Check if a passage is a duplicate
   */
  private checkDuplicate(bucket: HarvestBucket, passage: SourcePassage): boolean {
    if (!bucket.config.dedupeByContent) return false;

    const threshold = bucket.config.dedupeThreshold || 0.9;

    // Check against existing candidates
    for (const existing of bucket.candidates) {
      if (existing.id === passage.id) return true;

      // Simple text similarity check (can be enhanced with semantic similarity)
      const similarity = this.textSimilarity(existing.text, passage.text);
      if (similarity >= threshold) return true;
    }

    // Check against approved/gems
    for (const existing of [...bucket.approved, ...bucket.gems]) {
      if (existing.id === passage.id) return true;
      const similarity = this.textSimilarity(existing.text, passage.text);
      if (similarity >= threshold) return true;
    }

    return false;
  }

  /**
   * Simple text similarity (Jaccard on words)
   */
  private textSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Calculate average similarity score
   */
  private calculateAvgSimilarity(passages: SourcePassage[]): number {
    const withSimilarity = passages.filter((p) => p.similarity !== undefined);
    if (withSimilarity.length === 0) return 0;

    const sum = withSimilarity.reduce((acc, p) => acc + (p.similarity || 0), 0);
    return sum / withSimilarity.length;
  }

  /**
   * Approve a passage
   */
  approvePassage(bucketId: string, passageId: string): HarvestBucket | undefined {
    const bucket = this.buckets.get(bucketId);
    if (!bucket || isHarvestTerminal(bucket)) return undefined;

    const passage = bucket.candidates.find((p) => p.id === passageId);
    if (!passage) return undefined;

    // Update passage curation status
    const approvedPassage: SourcePassage = {
      ...passage,
      curation: {
        ...passage.curation,
        status: 'approved',
        curatedAt: Date.now(),
        curatedBy: 'user',
      },
    };

    return this.updateBucket(bucketId, {
      candidates: bucket.candidates.filter((p) => p.id !== passageId),
      approved: [...bucket.approved, approvedPassage],
      stats: {
        ...bucket.stats,
        reviewed: bucket.stats.reviewed + 1,
        approved: bucket.stats.approved + 1,
        approvedWordCount: bucket.stats.approvedWordCount + (passage.wordCount || 0),
      },
    });
  }

  /**
   * Mark a passage as gem
   */
  markAsGem(bucketId: string, passageId: string): HarvestBucket | undefined {
    const bucket = this.buckets.get(bucketId);
    if (!bucket || isHarvestTerminal(bucket)) return undefined;

    // Check if in candidates or approved
    let passage = bucket.candidates.find((p) => p.id === passageId);
    let fromCandidates = true;

    if (!passage) {
      passage = bucket.approved.find((p) => p.id === passageId);
      fromCandidates = false;
    }

    if (!passage) return undefined;

    // Update passage curation status
    const gemPassage: SourcePassage = {
      ...passage,
      curation: {
        ...passage.curation,
        status: 'gem',
        curatedAt: Date.now(),
        curatedBy: 'user',
      },
    };

    const updates: Partial<HarvestBucket> = {
      gems: [...bucket.gems, gemPassage],
      stats: {
        ...bucket.stats,
        gems: bucket.stats.gems + 1,
      },
    };

    if (fromCandidates) {
      updates.candidates = bucket.candidates.filter((p) => p.id !== passageId);
      updates.stats = {
        ...updates.stats!,
        reviewed: bucket.stats.reviewed + 1,
        approved: bucket.stats.approved + 1,
        approvedWordCount: bucket.stats.approvedWordCount + (passage.wordCount || 0),
      };
    } else {
      updates.approved = bucket.approved.filter((p) => p.id !== passageId);
    }

    return this.updateBucket(bucketId, updates);
  }

  /**
   * Reject a passage
   */
  rejectPassage(
    bucketId: string,
    passageId: string,
    reason?: string
  ): HarvestBucket | undefined {
    const bucket = this.buckets.get(bucketId);
    if (!bucket || isHarvestTerminal(bucket)) return undefined;

    const passage = bucket.candidates.find((p) => p.id === passageId);
    if (!passage) return undefined;

    // Update passage curation status
    const rejectedPassage: SourcePassage = {
      ...passage,
      curation: {
        ...passage.curation,
        status: 'rejected',
        curatedAt: Date.now(),
        curatedBy: 'user',
        notes: reason,
      },
    };

    return this.updateBucket(bucketId, {
      candidates: bucket.candidates.filter((p) => p.id !== passageId),
      rejected: [...bucket.rejected, rejectedPassage],
      stats: {
        ...bucket.stats,
        reviewed: bucket.stats.reviewed + 1,
        rejected: bucket.stats.rejected + 1,
      },
    });
  }

  /**
   * Move a passage back to candidates (undo approval/rejection)
   */
  moveToCandidates(bucketId: string, passageId: string): HarvestBucket | undefined {
    const bucket = this.buckets.get(bucketId);
    if (!bucket || isHarvestTerminal(bucket)) return undefined;

    // Find passage in approved, gems, or rejected
    let passage: SourcePassage | undefined;
    let source: 'approved' | 'gems' | 'rejected' | undefined;

    passage = bucket.approved.find((p) => p.id === passageId);
    if (passage) source = 'approved';

    if (!passage) {
      passage = bucket.gems.find((p) => p.id === passageId);
      if (passage) source = 'gems';
    }

    if (!passage) {
      passage = bucket.rejected.find((p) => p.id === passageId);
      if (passage) source = 'rejected';
    }

    if (!passage || !source) return undefined;

    // Reset curation status
    const candidatePassage: SourcePassage = {
      ...passage,
      curation: {
        ...passage.curation,
        status: 'candidate',
        curatedAt: undefined,
        curatedBy: undefined,
      },
    };

    const updates: Partial<HarvestBucket> = {
      candidates: [...bucket.candidates, candidatePassage],
      stats: {
        ...bucket.stats,
        reviewed: bucket.stats.reviewed - 1,
      },
    };

    if (source === 'approved') {
      updates.approved = bucket.approved.filter((p) => p.id !== passageId);
      updates.stats = {
        ...updates.stats!,
        approved: bucket.stats.approved - 1,
        approvedWordCount: bucket.stats.approvedWordCount - (passage.wordCount || 0),
      };
    } else if (source === 'gems') {
      updates.gems = bucket.gems.filter((p) => p.id !== passageId);
      updates.stats = {
        ...updates.stats!,
        approved: bucket.stats.approved - 1,
        gems: bucket.stats.gems - 1,
        approvedWordCount: bucket.stats.approvedWordCount - (passage.wordCount || 0),
      };
    } else {
      updates.rejected = bucket.rejected.filter((p) => p.id !== passageId);
      updates.stats = {
        ...updates.stats!,
        rejected: bucket.stats.rejected - 1,
      };
    }

    return this.updateBucket(bucketId, updates);
  }

  // ─────────────────────────────────────────────────────────────────
  // BUCKET LIFECYCLE
  // ─────────────────────────────────────────────────────────────────

  /**
   * Mark bucket as ready for review
   */
  finishCollecting(bucketId: string): HarvestBucket | undefined {
    const bucket = this.buckets.get(bucketId);
    if (!bucket || bucket.status !== 'collecting') return undefined;

    return this.updateBucket(bucketId, {
      status: 'reviewing',
      completedAt: Date.now(),
    });
  }

  /**
   * Stage bucket (ready to commit)
   */
  stageBucket(bucketId: string): HarvestBucket | undefined {
    const bucket = this.buckets.get(bucketId);
    if (!bucket || bucket.status !== 'reviewing') return undefined;

    if (bucket.approved.length === 0 && bucket.gems.length === 0) {
      console.warn('[HarvestBucketService] Cannot stage empty bucket');
      return undefined;
    }

    return this.updateBucket(bucketId, {
      status: 'staged',
    });
  }

  /**
   * Commit bucket to book project
   */
  commitBucket(bucketId: string): BookProject | undefined {
    const bucket = this.buckets.get(bucketId);
    if (!bucket || bucket.status !== 'staged') {
      console.warn('[HarvestBucketService] Bucket not staged:', bucket?.status);
      return undefined;
    }

    // Get the book
    const book = bookshelfService.getBook(bucket.bookUri);
    if (!book) {
      console.error('[HarvestBucketService] Book not found:', bucket.bookUri);
      return undefined;
    }

    // Merge approved passages into book
    const allApproved = getAllApproved(bucket);
    const newPassages = [...book.passages, ...allApproved];

    // Update book stats
    const gemCount = bucket.gems.length;
    const approvedCount = allApproved.length;

    const updatedBook = bookshelfService.updateBook(bucket.bookUri, {
      passages: newPassages,
      stats: {
        ...book.stats,
        totalPassages: newPassages.length,
        approvedPassages: book.stats.approvedPassages + approvedCount,
        gems: book.stats.gems + gemCount,
      },
    });

    if (updatedBook) {
      // Mark bucket as committed
      this.updateBucket(bucketId, {
        status: 'committed',
        finalizedAt: Date.now(),
      });

      console.log(
        `[HarvestBucketService] Committed ${approvedCount} passages (${gemCount} gems) to ${bucket.bookUri}`
      );
    }

    return updatedBook;
  }

  /**
   * Discard bucket without committing
   */
  discardBucket(bucketId: string): boolean {
    const bucket = this.buckets.get(bucketId);
    if (!bucket || isHarvestTerminal(bucket)) return false;

    this.updateBucket(bucketId, {
      status: 'discarded',
      finalizedAt: Date.now(),
    });

    return true;
  }

  // ─────────────────────────────────────────────────────────────────
  // NARRATIVE ARC OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a narrative arc for a book
   */
  createArc(
    bookUri: EntityURI,
    thesis: string,
    options?: {
      arcType?: NarrativeArc['arcType'];
      proposedBy?: 'user' | 'aui';
    }
  ): NarrativeArc {
    const arc = createNarrativeArc(bookUri, thesis, options);
    this.arcs.set(arc.id, arc);
    this.saveToStorage();
    return arc;
  }

  /**
   * Get arc by ID
   */
  getArc(arcId: string): NarrativeArc | undefined {
    return this.arcs.get(arcId);
  }

  /**
   * Get all arcs for a book
   */
  getArcsForBook(bookUri: EntityURI): NarrativeArc[] {
    return Array.from(this.arcs.values())
      .filter((a) => a.bookUri === bookUri)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Update an arc
   */
  updateArc(arcId: string, updates: Partial<NarrativeArc>): NarrativeArc | undefined {
    const arc = this.arcs.get(arcId);
    if (!arc) return undefined;

    const updated: NarrativeArc = {
      ...arc,
      ...updates,
      id: arc.id,
      updatedAt: Date.now(),
    };

    this.arcs.set(arcId, updated);
    this.saveToStorage();
    return updated;
  }

  /**
   * Approve an arc
   */
  approveArc(arcId: string, feedback?: string): NarrativeArc | undefined {
    return this.updateArc(arcId, {
      evaluation: {
        status: 'approved',
        evaluatedAt: Date.now(),
        feedback,
      },
    });
  }

  /**
   * Reject an arc
   */
  rejectArc(arcId: string, feedback: string): NarrativeArc | undefined {
    return this.updateArc(arcId, {
      evaluation: {
        status: 'rejected',
        evaluatedAt: Date.now(),
        feedback,
      },
    });
  }

  /**
   * Delete an arc
   */
  deleteArc(arcId: string): boolean {
    const deleted = this.arcs.delete(arcId);
    if (deleted) {
      this.saveToStorage();
    }
    return deleted;
  }

  // ─────────────────────────────────────────────────────────────────
  // PASSAGE LINK OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a passage link
   */
  createLink(
    passageId: string,
    chapterId: string,
    position: number,
    options?: {
      sectionId?: string;
      usageType?: PassageLink['usageType'];
      createdBy?: 'user' | 'aui';
    }
  ): PassageLink {
    const link = createPassageLink(passageId, chapterId, position, options);
    this.links.set(link.id, link);
    this.saveToStorage();
    return link;
  }

  /**
   * Get links for a chapter
   */
  getLinksForChapter(chapterId: string): PassageLink[] {
    return Array.from(this.links.values())
      .filter((l) => l.chapterId === chapterId)
      .sort((a, b) => a.position - b.position);
  }

  /**
   * Get links for a passage
   */
  getLinksForPassage(passageId: string): PassageLink[] {
    return Array.from(this.links.values()).filter((l) => l.passageId === passageId);
  }

  /**
   * Delete a link
   */
  deleteLink(linkId: string): boolean {
    const deleted = this.links.delete(linkId);
    if (deleted) {
      this.saveToStorage();
    }
    return deleted;
  }

  /**
   * Get orphaned passages (not linked to any chapter)
   */
  getOrphanedPassages(bookUri: EntityURI): SourcePassage[] {
    const book = bookshelfService.getBook(bookUri);
    if (!book) return [];

    const linkedIds = new Set(Array.from(this.links.values()).map((l) => l.passageId));

    return book.passages.filter((p) => !linkedIds.has(p.id));
  }
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════════

export const harvestBucketService = new HarvestBucketService();
export default harvestBucketService;

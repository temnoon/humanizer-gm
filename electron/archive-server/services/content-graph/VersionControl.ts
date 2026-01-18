/**
 * VersionControl - Git-like versioning for content nodes
 *
 * Provides version history, diffing, reverting, and forking operations
 * for content in the Universal Content Graph.
 */

import type Database from 'better-sqlite3';
import { randomUUID, createHash } from 'crypto';
import type { ContentNode, ContentVersion } from '@humanizer/core';
import { ContentGraphDatabase } from './ContentGraphDatabase.js';

/**
 * Diff result between two content versions
 */
export interface ContentDiff {
  /** Original version */
  from: ContentNode;

  /** New version */
  to: ContentNode;

  /** Text changes */
  textChanges: TextChange[];

  /** Metadata changes */
  metadataChanges: MetadataChange[];

  /** Summary statistics */
  stats: {
    /** Characters added */
    added: number;
    /** Characters removed */
    removed: number;
    /** Net change */
    netChange: number;
    /** Similarity score (0-1) */
    similarity: number;
  };
}

/**
 * A single text change
 */
export interface TextChange {
  /** Change type */
  type: 'add' | 'remove' | 'replace';

  /** Position in original text */
  position: number;

  /** Length in original text (for remove/replace) */
  originalLength?: number;

  /** Original text (for remove/replace) */
  originalText?: string;

  /** New text (for add/replace) */
  newText?: string;
}

/**
 * A metadata change
 */
export interface MetadataChange {
  /** Field path */
  field: string;

  /** Change type */
  type: 'add' | 'remove' | 'modify';

  /** Old value */
  oldValue?: unknown;

  /** New value */
  newValue?: unknown;
}

/**
 * Version tree node
 */
export interface VersionTreeNode {
  /** Version ID */
  id: string;

  /** Version number */
  number: number;

  /** Parent version ID */
  parentId?: string;

  /** Child versions */
  children: VersionTreeNode[];

  /** Operation that created this version */
  operation?: string;

  /** When created */
  createdAt: number;

  /** Is this the current/latest version */
  isCurrent: boolean;
}

/**
 * VersionControl - Manages content versioning
 */
export class VersionControl {
  private db: Database.Database;
  private graphDb: ContentGraphDatabase;

  constructor(db: Database.Database, graphDb: ContentGraphDatabase) {
    this.db = db;
    this.graphDb = graphDb;
  }

  // ===========================================================================
  // VERSION HISTORY
  // ===========================================================================

  /**
   * Get version history for a content node
   */
  getHistory(nodeId: string): ContentVersion[] {
    const node = this.graphDb.getNode(nodeId);
    if (!node) return [];

    return this.graphDb.getVersionHistory(node.version.rootId);
  }

  /**
   * Get all versions of a content node
   */
  getAllVersions(nodeId: string): ContentNode[] {
    const node = this.graphDb.getNode(nodeId);
    if (!node) return [];

    return this.graphDb.getAllVersions(node.version.rootId);
  }

  /**
   * Get the version tree for a content node
   */
  getVersionTree(nodeId: string): VersionTreeNode | null {
    const node = this.graphDb.getNode(nodeId);
    if (!node) return null;

    const allVersions = this.graphDb.getAllVersions(node.version.rootId);
    if (allVersions.length === 0) return null;

    // Build tree
    const nodeMap = new Map<string, VersionTreeNode>();
    let root: VersionTreeNode | null = null;

    // Create tree nodes
    for (const version of allVersions) {
      const treeNode: VersionTreeNode = {
        id: version.id,
        number: version.version.number,
        parentId: version.version.parentId,
        children: [],
        operation: version.version.operation,
        createdAt: version.metadata.createdAt,
        isCurrent: version.id === nodeId,
      };
      nodeMap.set(version.id, treeNode);

      if (!version.version.parentId) {
        root = treeNode;
      }
    }

    // Link children to parents
    for (const treeNode of nodeMap.values()) {
      if (treeNode.parentId) {
        const parent = nodeMap.get(treeNode.parentId);
        if (parent) {
          parent.children.push(treeNode);
        }
      }
    }

    // Sort children by version number
    const sortChildren = (node: VersionTreeNode) => {
      node.children.sort((a, b) => a.number - b.number);
      for (const child of node.children) {
        sortChildren(child);
      }
    };

    if (root) {
      sortChildren(root);
    }

    return root;
  }

  /**
   * Get the latest version of a content node
   */
  getLatestVersion(nodeId: string): ContentNode | null {
    const node = this.graphDb.getNode(nodeId);
    if (!node) return null;

    const row = this.db.prepare(`
      SELECT * FROM content_nodes
      WHERE root_id = ?
      ORDER BY version_number DESC
      LIMIT 1
    `).get(node.version.rootId) as { id: string } | undefined;

    if (!row) return null;
    return this.graphDb.getNode(row.id);
  }

  /**
   * Get a specific version by number
   */
  getVersion(nodeId: string, versionNumber: number): ContentNode | null {
    const node = this.graphDb.getNode(nodeId);
    if (!node) return null;

    const row = this.db.prepare(`
      SELECT * FROM content_nodes
      WHERE root_id = ? AND version_number = ?
    `).get(node.version.rootId, versionNumber) as { id: string } | undefined;

    if (!row) return null;
    return this.graphDb.getNode(row.id);
  }

  // ===========================================================================
  // DIFFING
  // ===========================================================================

  /**
   * Compare two content nodes
   */
  diff(fromId: string, toId: string): ContentDiff | null {
    const from = this.graphDb.getNode(fromId);
    const to = this.graphDb.getNode(toId);

    if (!from || !to) return null;

    // Calculate text changes
    const textChanges = this.calculateTextChanges(from.content.text, to.content.text);

    // Calculate metadata changes
    const metadataChanges = this.calculateMetadataChanges(from.metadata, to.metadata);

    // Calculate stats
    const added = textChanges
      .filter(c => c.type === 'add' || c.type === 'replace')
      .reduce((sum, c) => sum + (c.newText?.length || 0), 0);

    const removed = textChanges
      .filter(c => c.type === 'remove' || c.type === 'replace')
      .reduce((sum, c) => sum + (c.originalLength || 0), 0);

    const similarity = this.calculateSimilarity(from.content.text, to.content.text);

    return {
      from,
      to,
      textChanges,
      metadataChanges,
      stats: {
        added,
        removed,
        netChange: added - removed,
        similarity,
      },
    };
  }

  /**
   * Calculate text changes using simple diff algorithm
   */
  private calculateTextChanges(original: string, modified: string): TextChange[] {
    const changes: TextChange[] = [];

    // Simple line-based diff
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    let position = 0;
    let i = 0;
    let j = 0;

    while (i < originalLines.length || j < modifiedLines.length) {
      if (i >= originalLines.length) {
        // Rest are additions
        changes.push({
          type: 'add',
          position,
          newText: modifiedLines.slice(j).join('\n'),
        });
        break;
      }

      if (j >= modifiedLines.length) {
        // Rest are deletions
        changes.push({
          type: 'remove',
          position,
          originalLength: originalLines.slice(i).join('\n').length,
          originalText: originalLines.slice(i).join('\n'),
        });
        break;
      }

      if (originalLines[i] === modifiedLines[j]) {
        // Lines match
        position += originalLines[i].length + 1;
        i++;
        j++;
      } else {
        // Lines differ - find next match
        let foundMatch = false;
        for (let lookAhead = 1; lookAhead < 5 && !foundMatch; lookAhead++) {
          if (i + lookAhead < originalLines.length &&
              originalLines[i + lookAhead] === modifiedLines[j]) {
            // Deletion
            const deletedText = originalLines.slice(i, i + lookAhead).join('\n');
            changes.push({
              type: 'remove',
              position,
              originalLength: deletedText.length,
              originalText: deletedText,
            });
            i += lookAhead;
            foundMatch = true;
          } else if (j + lookAhead < modifiedLines.length &&
                     originalLines[i] === modifiedLines[j + lookAhead]) {
            // Addition
            const addedText = modifiedLines.slice(j, j + lookAhead).join('\n');
            changes.push({
              type: 'add',
              position,
              newText: addedText,
            });
            j += lookAhead;
            foundMatch = true;
          }
        }

        if (!foundMatch) {
          // Replace
          changes.push({
            type: 'replace',
            position,
            originalLength: originalLines[i].length,
            originalText: originalLines[i],
            newText: modifiedLines[j],
          });
          position += originalLines[i].length + 1;
          i++;
          j++;
        }
      }
    }

    return changes;
  }

  /**
   * Calculate metadata changes
   */
  private calculateMetadataChanges(
    original: ContentNode['metadata'],
    modified: ContentNode['metadata']
  ): MetadataChange[] {
    const changes: MetadataChange[] = [];

    const compareValues = (
      path: string,
      oldVal: unknown,
      newVal: unknown
    ) => {
      if (oldVal === undefined && newVal !== undefined) {
        changes.push({ field: path, type: 'add', newValue: newVal });
      } else if (oldVal !== undefined && newVal === undefined) {
        changes.push({ field: path, type: 'remove', oldValue: oldVal });
      } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({
          field: path,
          type: 'modify',
          oldValue: oldVal,
          newValue: newVal,
        });
      }
    };

    // Compare top-level fields
    compareValues('title', original.title, modified.title);
    compareValues('author', original.author, modified.author);
    compareValues('language', original.language, modified.language);
    compareValues('tags', original.tags, modified.tags);
    compareValues('wordCount', original.wordCount, modified.wordCount);

    return changes;
  }

  /**
   * Calculate similarity score between two texts
   */
  private calculateSimilarity(text1: string, text2: string): number {
    if (text1 === text2) return 1.0;
    if (!text1 || !text2) return 0.0;

    // Jaccard similarity on words
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  // ===========================================================================
  // VERSION OPERATIONS
  // ===========================================================================

  /**
   * Revert to a previous version
   *
   * Creates a new version with the content from the target version.
   */
  revert(
    nodeId: string,
    toVersionNumber: number,
    operatorId?: string
  ): ContentNode | null {
    const current = this.graphDb.getNode(nodeId);
    const target = this.getVersion(nodeId, toVersionNumber);

    if (!current || !target) return null;

    // Create new version with target's content
    return this.graphDb.updateNode(
      current.id,
      {
        content: target.content,
        metadata: {
          ...current.metadata,
          tags: target.metadata.tags,
        },
      },
      `revert-to-v${toVersionNumber}`,
      operatorId
    );
  }

  /**
   * Fork a content node (create a new root)
   *
   * Creates a new content lineage branching from this version.
   */
  fork(nodeId: string, operatorId?: string): ContentNode | null {
    const source = this.graphDb.getNode(nodeId);
    if (!source) return null;

    // Create new node with fresh root
    const forked = this.graphDb.createNode({
      text: source.content.text,
      format: source.content.format,
      rendered: source.content.rendered,
      title: source.metadata.title ? `${source.metadata.title} (Fork)` : undefined,
      author: source.metadata.author,
      createdAt: Date.now(),
      tags: [...source.metadata.tags],
      sourceType: 'transform',
      adapter: 'version-control',
      sourceMetadata: {
        forkedFrom: source.id,
        forkedFromUri: source.uri,
      },
    });

    // Create fork-of link
    this.graphDb.createLink({
      sourceId: forked.id,
      targetId: source.id,
      type: 'fork-of',
      createdBy: operatorId,
    });

    return forked;
  }

  /**
   * Merge changes from one version into another
   *
   * Simple merge that takes all changes from source to target.
   */
  merge(
    targetId: string,
    sourceId: string,
    operatorId?: string
  ): ContentNode | null {
    const target = this.graphDb.getNode(targetId);
    const source = this.graphDb.getNode(sourceId);

    if (!target || !source) return null;

    // For now, simple merge just takes the source content
    // A more sophisticated merge would use the diff
    const merged = this.graphDb.updateNode(
      target.id,
      {
        content: {
          ...target.content,
          text: source.content.text,
          rendered: source.content.rendered,
        },
      },
      `merge-from-${source.id.slice(0, 8)}`,
      operatorId
    );

    if (merged) {
      // Create link showing merge
      this.graphDb.createLink({
        sourceId: merged.id,
        targetId: source.id,
        type: 'derived-from',
        metadata: { operation: 'merge' },
        createdBy: operatorId,
      });
    }

    return merged;
  }

  // ===========================================================================
  // CLEANUP
  // ===========================================================================

  /**
   * Prune old versions, keeping only the N most recent
   */
  pruneVersions(rootId: string, keepCount: number = 10): number {
    const result = this.db.prepare(`
      DELETE FROM content_nodes
      WHERE root_id = ?
        AND version_number NOT IN (
          SELECT version_number FROM content_nodes
          WHERE root_id = ?
          ORDER BY version_number DESC
          LIMIT ?
        )
    `).run(rootId, rootId, keepCount);

    return result.changes;
  }

  /**
   * Get version count for a content root
   */
  getVersionCount(nodeId: string): number {
    const node = this.graphDb.getNode(nodeId);
    if (!node) return 0;

    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM content_nodes WHERE root_id = ?
    `).get(node.version.rootId) as { count: number };

    return result.count;
  }

  /**
   * Find content nodes with many versions (candidates for pruning)
   */
  findHighVersionCounts(threshold: number = 20, limit: number = 50): Array<{
    rootId: string;
    versionCount: number;
    latestTitle?: string;
  }> {
    const rows = this.db.prepare(`
      SELECT root_id, COUNT(*) as version_count, MAX(title) as latest_title
      FROM content_nodes
      GROUP BY root_id
      HAVING version_count >= ?
      ORDER BY version_count DESC
      LIMIT ?
    `).all(threshold, limit) as Array<{
      root_id: string;
      version_count: number;
      latest_title: string | null;
    }>;

    return rows.map(row => ({
      rootId: row.root_id,
      versionCount: row.version_count,
      latestTitle: row.latest_title ?? undefined,
    }));
  }
}

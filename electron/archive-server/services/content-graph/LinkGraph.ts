/**
 * LinkGraph - Advanced link operations for the Universal Content Graph
 *
 * Provides graph traversal, pathfinding, and relationship analysis
 * on top of the basic link operations in ContentGraphDatabase.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type {
  ContentNode,
  ContentLink,
  LinkType,
  CreateContentLinkOptions,
} from '@humanizer/core';
import { ContentGraphDatabase } from './ContentGraphDatabase.js';

/**
 * Graph traversal result
 */
export interface TraversalResult {
  /** Nodes found during traversal */
  nodes: ContentNode[];

  /** Links traversed */
  links: ContentLink[];

  /** Traversal depth reached */
  maxDepth: number;

  /** Total nodes visited (including duplicates) */
  nodesVisited: number;
}

/**
 * Path between two nodes
 */
export interface NodePath {
  /** Start node */
  from: ContentNode;

  /** End node */
  to: ContentNode;

  /** Nodes along the path (including start and end) */
  nodes: ContentNode[];

  /** Links along the path */
  links: ContentLink[];

  /** Path length (number of hops) */
  length: number;
}

/**
 * Link statistics for a node
 */
export interface LinkStats {
  /** Total outgoing links */
  outgoing: number;

  /** Total incoming links */
  incoming: number;

  /** Breakdown by link type */
  byType: Record<string, { outgoing: number; incoming: number }>;

  /** Most connected neighbors */
  topNeighbors: Array<{ nodeId: string; linkCount: number }>;
}

/**
 * Cluster of related nodes
 */
export interface ContentCluster {
  /** Cluster ID */
  id: string;

  /** Central/seed node */
  center: ContentNode;

  /** All nodes in cluster */
  nodes: ContentNode[];

  /** Internal links */
  links: ContentLink[];

  /** Cluster coherence score (0-1) */
  coherence: number;
}

/**
 * LinkGraph - Graph operations for content relationships
 */
export class LinkGraph {
  private db: Database.Database;
  private graphDb: ContentGraphDatabase;

  constructor(db: Database.Database, graphDb: ContentGraphDatabase) {
    this.db = db;
    this.graphDb = graphDb;
  }

  // ===========================================================================
  // TRAVERSAL OPERATIONS
  // ===========================================================================

  /**
   * Get all derivatives of a content node (forward traversal of derived-from)
   *
   * Returns all nodes that were created from this node through transformations.
   */
  getDerivatives(nodeId: string, maxDepth: number = 10): TraversalResult {
    return this.traverse(nodeId, ['derived-from'], 'incoming', maxDepth);
  }

  /**
   * Get lineage of a content node (backward traversal of derived-from)
   *
   * Returns all source nodes that this node was derived from.
   */
  getLineage(nodeId: string, maxDepth: number = 10): TraversalResult {
    return this.traverse(nodeId, ['derived-from'], 'outgoing', maxDepth);
  }

  /**
   * Get all related nodes (any relationship type)
   */
  getRelated(nodeId: string, maxDepth: number = 2): TraversalResult {
    return this.traverse(nodeId, undefined, 'both', maxDepth);
  }

  /**
   * Traverse the graph from a starting node
   */
  traverse(
    startNodeId: string,
    linkTypes?: LinkType[],
    direction: 'outgoing' | 'incoming' | 'both' = 'both',
    maxDepth: number = 10
  ): TraversalResult {
    const visited = new Set<string>();
    const nodes: ContentNode[] = [];
    const links: ContentLink[] = [];
    let nodesVisited = 0;

    const startNode = this.graphDb.getNode(startNodeId);
    if (!startNode) {
      return { nodes: [], links: [], maxDepth: 0, nodesVisited: 0 };
    }

    const queue: Array<{ nodeId: string; depth: number }> = [
      { nodeId: startNodeId, depth: 0 },
    ];

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      nodesVisited++;

      if (visited.has(nodeId) || depth > maxDepth) {
        continue;
      }
      visited.add(nodeId);

      const node = this.graphDb.getNode(nodeId);
      if (node && nodeId !== startNodeId) {
        nodes.push(node);
      }

      // Get links based on direction
      let nodeLinks: ContentLink[] = [];
      if (direction === 'outgoing' || direction === 'both') {
        nodeLinks = nodeLinks.concat(this.graphDb.getLinksFrom(nodeId, linkTypes));
      }
      if (direction === 'incoming' || direction === 'both') {
        nodeLinks = nodeLinks.concat(this.graphDb.getLinksTo(nodeId, linkTypes));
      }

      for (const link of nodeLinks) {
        if (!links.some(l => l.id === link.id)) {
          links.push(link);
        }

        // Queue the connected node
        const nextNodeId = link.sourceId === nodeId ? link.targetId : link.sourceId;
        if (!visited.has(nextNodeId)) {
          queue.push({ nodeId: nextNodeId, depth: depth + 1 });
        }
      }
    }

    return {
      nodes,
      links,
      maxDepth: Math.max(0, ...Array.from(visited).map(() => 0)),
      nodesVisited,
    };
  }

  // ===========================================================================
  // PATHFINDING
  // ===========================================================================

  /**
   * Find shortest path between two nodes
   */
  findPath(
    fromId: string,
    toId: string,
    linkTypes?: LinkType[],
    maxDepth: number = 10
  ): NodePath | null {
    const fromNode = this.graphDb.getNode(fromId);
    const toNode = this.graphDb.getNode(toId);

    if (!fromNode || !toNode) {
      return null;
    }

    // BFS for shortest path
    const visited = new Set<string>();
    const parents = new Map<string, { nodeId: string; link: ContentLink }>();
    const queue: string[] = [fromId];
    visited.add(fromId);

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      if (currentId === toId) {
        // Reconstruct path
        return this.reconstructPath(fromNode, toNode, parents);
      }

      // Check depth limit
      let depth = 0;
      let checkId = currentId;
      while (parents.has(checkId)) {
        depth++;
        checkId = parents.get(checkId)!.nodeId;
      }
      if (depth >= maxDepth) continue;

      // Get all neighbors
      const outgoing = this.graphDb.getLinksFrom(currentId, linkTypes);
      const incoming = this.graphDb.getLinksTo(currentId, linkTypes);

      for (const link of [...outgoing, ...incoming]) {
        const neighborId = link.sourceId === currentId ? link.targetId : link.sourceId;
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          parents.set(neighborId, { nodeId: currentId, link });
          queue.push(neighborId);
        }
      }
    }

    return null;
  }

  /**
   * Find all paths between two nodes (up to maxPaths)
   */
  findAllPaths(
    fromId: string,
    toId: string,
    maxPaths: number = 5,
    maxDepth: number = 5
  ): NodePath[] {
    const fromNode = this.graphDb.getNode(fromId);
    const toNode = this.graphDb.getNode(toId);

    if (!fromNode || !toNode) {
      return [];
    }

    const paths: NodePath[] = [];
    const currentPath: string[] = [];
    const currentLinks: ContentLink[] = [];

    const dfs = (nodeId: string, depth: number) => {
      if (paths.length >= maxPaths || depth > maxDepth) {
        return;
      }

      currentPath.push(nodeId);

      if (nodeId === toId) {
        // Found a path
        paths.push({
          from: fromNode,
          to: toNode,
          nodes: this.graphDb.getNodes(currentPath),
          links: [...currentLinks],
          length: currentPath.length - 1,
        });
      } else {
        // Continue exploring
        const outgoing = this.graphDb.getLinksFrom(nodeId);
        const incoming = this.graphDb.getLinksTo(nodeId);

        for (const link of [...outgoing, ...incoming]) {
          const neighborId = link.sourceId === nodeId ? link.targetId : link.sourceId;
          if (!currentPath.includes(neighborId)) {
            currentLinks.push(link);
            dfs(neighborId, depth + 1);
            currentLinks.pop();
          }
        }
      }

      currentPath.pop();
    };

    dfs(fromId, 0);
    return paths;
  }

  /**
   * Reconstruct path from BFS parents map
   */
  private reconstructPath(
    fromNode: ContentNode,
    toNode: ContentNode,
    parents: Map<string, { nodeId: string; link: ContentLink }>
  ): NodePath {
    const nodeIds: string[] = [toNode.id];
    const links: ContentLink[] = [];

    let currentId = toNode.id;
    while (parents.has(currentId)) {
      const parent = parents.get(currentId)!;
      nodeIds.unshift(parent.nodeId);
      links.unshift(parent.link);
      currentId = parent.nodeId;
    }

    return {
      from: fromNode,
      to: toNode,
      nodes: this.graphDb.getNodes(nodeIds),
      links,
      length: nodeIds.length - 1,
    };
  }

  // ===========================================================================
  // ANALYSIS
  // ===========================================================================

  /**
   * Get link statistics for a node
   */
  getLinkStats(nodeId: string): LinkStats {
    const outgoing = this.graphDb.getLinksFrom(nodeId);
    const incoming = this.graphDb.getLinksTo(nodeId);

    // Count by type
    const byType: Record<string, { outgoing: number; incoming: number }> = {};

    for (const link of outgoing) {
      if (!byType[link.type]) {
        byType[link.type] = { outgoing: 0, incoming: 0 };
      }
      byType[link.type].outgoing++;
    }

    for (const link of incoming) {
      if (!byType[link.type]) {
        byType[link.type] = { outgoing: 0, incoming: 0 };
      }
      byType[link.type].incoming++;
    }

    // Find most connected neighbors
    const neighborCounts = new Map<string, number>();
    for (const link of [...outgoing, ...incoming]) {
      const neighborId = link.sourceId === nodeId ? link.targetId : link.sourceId;
      neighborCounts.set(neighborId, (neighborCounts.get(neighborId) || 0) + 1);
    }

    const topNeighbors = Array.from(neighborCounts.entries())
      .map(([nodeId, linkCount]) => ({ nodeId, linkCount }))
      .sort((a, b) => b.linkCount - a.linkCount)
      .slice(0, 10);

    return {
      outgoing: outgoing.length,
      incoming: incoming.length,
      byType,
      topNeighbors,
    };
  }

  /**
   * Find strongly connected nodes (potential clusters)
   */
  findClusters(minSize: number = 3, maxClusters: number = 10): ContentCluster[] {
    const clusters: ContentCluster[] = [];
    const assigned = new Set<string>();

    // Get all nodes with high connectivity
    const rows = this.db.prepare(`
      SELECT source_id as node_id, COUNT(*) as link_count
      FROM content_links
      GROUP BY source_id
      HAVING link_count >= ?
      ORDER BY link_count DESC
      LIMIT ?
    `).all(minSize, maxClusters * 2) as { node_id: string; link_count: number }[];

    for (const row of rows) {
      if (assigned.has(row.node_id) || clusters.length >= maxClusters) {
        continue;
      }

      const centerNode = this.graphDb.getNode(row.node_id);
      if (!centerNode) continue;

      // Get closely connected nodes
      const traversal = this.traverse(row.node_id, undefined, 'both', 2);
      const clusterNodes = [centerNode, ...traversal.nodes].filter(
        n => !assigned.has(n.id)
      );

      if (clusterNodes.length >= minSize) {
        // Mark as assigned
        for (const node of clusterNodes) {
          assigned.add(node.id);
        }

        // Calculate coherence (internal links / possible links)
        const nodeIds = new Set(clusterNodes.map(n => n.id));
        const internalLinks = traversal.links.filter(
          l => nodeIds.has(l.sourceId) && nodeIds.has(l.targetId)
        );
        const possibleLinks = clusterNodes.length * (clusterNodes.length - 1);
        const coherence = possibleLinks > 0
          ? internalLinks.length / possibleLinks
          : 0;

        clusters.push({
          id: randomUUID(),
          center: centerNode,
          nodes: clusterNodes,
          links: internalLinks,
          coherence,
        });
      }
    }

    return clusters.sort((a, b) => b.coherence - a.coherence);
  }

  // ===========================================================================
  // LINK MANAGEMENT
  // ===========================================================================

  /**
   * Create a bidirectional link pair
   *
   * For many link types, we want both directions stored.
   */
  createBidirectionalLink(
    sourceId: string,
    targetId: string,
    forwardType: LinkType,
    reverseType: LinkType,
    options?: Partial<CreateContentLinkOptions>
  ): { forward: ContentLink; reverse: ContentLink } {
    const forward = this.graphDb.createLink({
      sourceId,
      targetId,
      type: forwardType,
      ...options,
    });

    const reverse = this.graphDb.createLink({
      sourceId: targetId,
      targetId: sourceId,
      type: reverseType,
      ...options,
    });

    return { forward, reverse };
  }

  /**
   * Create a derived-from link with automatic reverse link
   */
  createDerivationLink(
    derivedNodeId: string,
    sourceNodeId: string,
    operation?: string,
    createdBy?: string
  ): ContentLink {
    return this.graphDb.createLink({
      sourceId: derivedNodeId,
      targetId: sourceNodeId,
      type: 'derived-from',
      createdBy,
      metadata: operation ? { operation } : undefined,
    });
  }

  /**
   * Create harvest links (content harvested into a book/chapter)
   */
  createHarvestLinks(
    contentNodeId: string,
    targetId: string,
    options?: {
      sourceAnchor?: { start: number; end: number; text?: string };
      createdBy?: string;
    }
  ): { harvest: ContentLink; placed: ContentLink } {
    const harvest = this.graphDb.createLink({
      sourceId: contentNodeId,
      targetId,
      type: 'harvested-into',
      sourceAnchor: options?.sourceAnchor,
      createdBy: options?.createdBy,
    });

    const placed = this.graphDb.createLink({
      sourceId: targetId,
      targetId: contentNodeId,
      type: 'placed-in',
      createdBy: options?.createdBy,
    });

    return { harvest, placed };
  }

  /**
   * Remove all links between two nodes
   */
  removeAllLinksBetween(nodeId1: string, nodeId2: string): number {
    const result = this.db.prepare(`
      DELETE FROM content_links
      WHERE (source_id = ? AND target_id = ?)
         OR (source_id = ? AND target_id = ?)
    `).run(nodeId1, nodeId2, nodeId2, nodeId1);

    return result.changes;
  }

  /**
   * Get nodes with no links (orphans)
   */
  findOrphans(limit: number = 100): ContentNode[] {
    const rows = this.db.prepare(`
      SELECT cn.* FROM content_nodes cn
      LEFT JOIN content_links cl_out ON cn.id = cl_out.source_id
      LEFT JOIN content_links cl_in ON cn.id = cl_in.target_id
      WHERE cl_out.id IS NULL AND cl_in.id IS NULL
      LIMIT ?
    `).all(limit) as { id: string }[];

    return this.graphDb.getNodes(rows.map(r => r.id));
  }

  /**
   * Get the most connected nodes
   */
  getMostConnected(limit: number = 20): Array<{ node: ContentNode; linkCount: number }> {
    const rows = this.db.prepare(`
      SELECT node_id, SUM(cnt) as total FROM (
        SELECT source_id as node_id, COUNT(*) as cnt FROM content_links GROUP BY source_id
        UNION ALL
        SELECT target_id as node_id, COUNT(*) as cnt FROM content_links GROUP BY target_id
      )
      GROUP BY node_id
      ORDER BY total DESC
      LIMIT ?
    `).all(limit) as { node_id: string; total: number }[];

    return rows.map(row => {
      const node = this.graphDb.getNode(row.node_id);
      return node ? { node, linkCount: row.total } : null;
    }).filter((r): r is { node: ContentNode; linkCount: number } => r !== null);
  }
}

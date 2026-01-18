/**
 * MetadataDiscoveryService - Agent-driven metadata discovery for adaptive search
 *
 * Introspects the SQLite database to find filterable fields dynamically:
 * - Fields with non-null values
 * - Distinct value counts
 * - Top values with counts
 * - Date ranges, numeric ranges
 *
 * Different users with different archives get different filter options.
 */

import type Database from 'better-sqlite3';
import { DatabaseOperations } from './DatabaseOperations.js';

// =============================================================================
// Types
// =============================================================================

export type FacetType = 'enum' | 'date_range' | 'numeric_range' | 'boolean';
export type FacetSource = 'conversations' | 'content_items' | 'content_blocks' | 'messages';

export interface TopValue {
  value: string;
  count: number;
}

export interface DateRange {
  min: number;  // Unix timestamp
  max: number;  // Unix timestamp
}

export interface NumericRange {
  min: number;
  max: number;
}

export interface FacetDefinition {
  field: string;
  label: string;
  type: FacetType;
  source: FacetSource;
  distinctCount: number;
  topValues?: TopValue[];
  range?: DateRange | NumericRange;
  coverage: number;  // Percentage of records with non-null value (0-100)
}

export interface DiscoveryResult {
  facets: FacetDefinition[];
  discoveredAt: number;
  totalRecords: {
    conversations: number;
    contentItems: number;
    contentBlocks: number;
    messages: number;
  };
}

// =============================================================================
// Field Configuration - What to discover
// =============================================================================

interface FieldConfig {
  field: string;
  label: string;
  type: FacetType;
  source: FacetSource;
  column: string;
  table: string;
  minCoverage?: number;  // Minimum % coverage to include (default 5%)
  maxDistinct?: number;  // Max distinct values for enum type (default 50)
}

const DISCOVERABLE_FIELDS: FieldConfig[] = [
  // Content Blocks
  {
    field: 'gizmo_id',
    label: 'Custom GPT',
    type: 'enum',
    source: 'content_blocks',
    column: 'gizmo_id',
    table: 'content_blocks',
    minCoverage: 1,
  },
  {
    field: 'block_type',
    label: 'Content Type',
    type: 'enum',
    source: 'content_blocks',
    column: 'block_type',
    table: 'content_blocks',
  },
  {
    field: 'language',
    label: 'Programming Language',
    type: 'enum',
    source: 'content_blocks',
    column: 'language',
    table: 'content_blocks',
    minCoverage: 1,
  },

  // Content Items (Facebook, etc.)
  {
    field: 'source',
    label: 'Source',
    type: 'enum',
    source: 'content_items',
    column: 'source',
    table: 'content_items',
  },
  {
    field: 'content_type',
    label: 'Content Type',
    type: 'enum',
    source: 'content_items',
    column: 'type',
    table: 'content_items',
  },
  {
    field: 'author_name',
    label: 'Author',
    type: 'enum',
    source: 'content_items',
    column: 'author_name',
    table: 'content_items',
    maxDistinct: 100,  // May have many authors
  },
  {
    field: 'is_own_content',
    label: 'My Content',
    type: 'boolean',
    source: 'content_items',
    column: 'is_own_content',
    table: 'content_items',
  },
  {
    field: 'content_created_at',
    label: 'Date Created',
    type: 'date_range',
    source: 'content_items',
    column: 'created_at',
    table: 'content_items',
  },

  // Conversations
  {
    field: 'conversation_created_at',
    label: 'Conversation Date',
    type: 'date_range',
    source: 'conversations',
    column: 'created_at',
    table: 'conversations',
  },
  {
    field: 'message_count',
    label: 'Message Count',
    type: 'numeric_range',
    source: 'conversations',
    column: 'message_count',
    table: 'conversations',
  },
  {
    field: 'is_interesting',
    label: 'Marked Interesting',
    type: 'boolean',
    source: 'conversations',
    column: 'is_interesting',
    table: 'conversations',
  },

  // Messages
  {
    field: 'role',
    label: 'Message Role',
    type: 'enum',
    source: 'messages',
    column: 'role',
    table: 'messages',
  },
];

// =============================================================================
// MetadataDiscoveryService
// =============================================================================

export class MetadataDiscoveryService extends DatabaseOperations {
  private cache: DiscoveryResult | null = null;
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL = 60 * 60 * 1000;  // 1 hour

  constructor(db: Database.Database, vecLoaded: boolean) {
    super(db, vecLoaded);
  }

  /**
   * Discover all available facets for filtering
   * Results are cached for 1 hour
   */
  discoverFacets(forceRefresh = false): DiscoveryResult {
    const now = Date.now();

    // Return cached results if valid
    if (!forceRefresh && this.cache && now < this.cacheExpiry) {
      return this.cache;
    }

    console.log('[MetadataDiscoveryService] Discovering facets...');

    // Get total record counts
    const totalRecords = this.getTotalRecords();

    // Discover each field
    const facets: FacetDefinition[] = [];

    for (const config of DISCOVERABLE_FIELDS) {
      try {
        const facet = this.discoverField(config, totalRecords);
        if (facet) {
          facets.push(facet);
        }
      } catch (err) {
        console.warn(`[MetadataDiscoveryService] Error discovering ${config.field}:`, err);
      }
    }

    // Sort by coverage (most useful first)
    facets.sort((a, b) => b.coverage - a.coverage);

    const result: DiscoveryResult = {
      facets,
      discoveredAt: now,
      totalRecords,
    };

    // Cache results
    this.cache = result;
    this.cacheExpiry = now + this.CACHE_TTL;

    console.log(`[MetadataDiscoveryService] Discovered ${facets.length} facets`);
    return result;
  }

  /**
   * Get total record counts for all tables
   */
  private getTotalRecords(): DiscoveryResult['totalRecords'] {
    const counts = {
      conversations: 0,
      contentItems: 0,
      contentBlocks: 0,
      messages: 0,
    };

    try {
      const convRow = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number };
      counts.conversations = convRow?.count || 0;
    } catch {
      // Table may not exist
    }

    try {
      const itemRow = this.db.prepare('SELECT COUNT(*) as count FROM content_items').get() as { count: number };
      counts.contentItems = itemRow?.count || 0;
    } catch {
      // Table may not exist
    }

    try {
      const blockRow = this.db.prepare('SELECT COUNT(*) as count FROM content_blocks').get() as { count: number };
      counts.contentBlocks = blockRow?.count || 0;
    } catch {
      // Table may not exist
    }

    try {
      const msgRow = this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
      counts.messages = msgRow?.count || 0;
    } catch {
      // Table may not exist
    }

    return counts;
  }

  /**
   * Discover a single field's facet information
   */
  private discoverField(
    config: FieldConfig,
    totalRecords: DiscoveryResult['totalRecords']
  ): FacetDefinition | null {
    const { field, label, type, source, column, table } = config;
    const minCoverage = config.minCoverage ?? 5;
    const maxDistinct = config.maxDistinct ?? 50;

    // Get total count for this table
    let totalCount = 0;
    switch (source) {
      case 'conversations':
        totalCount = totalRecords.conversations;
        break;
      case 'content_items':
        totalCount = totalRecords.contentItems;
        break;
      case 'content_blocks':
        totalCount = totalRecords.contentBlocks;
        break;
      case 'messages':
        totalCount = totalRecords.messages;
        break;
    }

    // Skip if table is empty
    if (totalCount === 0) {
      return null;
    }

    // Check if table exists by attempting a simple query
    try {
      this.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    } catch {
      return null;  // Table doesn't exist
    }

    // Count non-null values
    const nonNullResult = this.db.prepare(`
      SELECT COUNT(*) as count FROM ${table} WHERE ${column} IS NOT NULL
    `).get() as { count: number };

    const nonNullCount = nonNullResult?.count || 0;
    const coverage = (nonNullCount / totalCount) * 100;

    // Skip if below minimum coverage
    if (coverage < minCoverage) {
      return null;
    }

    // Build facet based on type
    switch (type) {
      case 'enum':
        return this.discoverEnumFacet(field, label, source, table, column, coverage, nonNullCount, maxDistinct);

      case 'date_range':
        return this.discoverDateRangeFacet(field, label, source, table, column, coverage);

      case 'numeric_range':
        return this.discoverNumericRangeFacet(field, label, source, table, column, coverage);

      case 'boolean':
        return this.discoverBooleanFacet(field, label, source, table, column, coverage, totalCount);

      default:
        return null;
    }
  }

  /**
   * Discover an enum facet (discrete values)
   */
  private discoverEnumFacet(
    field: string,
    label: string,
    source: FacetSource,
    table: string,
    column: string,
    coverage: number,
    nonNullCount: number,
    maxDistinct: number
  ): FacetDefinition | null {
    // Count distinct values
    const distinctResult = this.db.prepare(`
      SELECT COUNT(DISTINCT ${column}) as count FROM ${table} WHERE ${column} IS NOT NULL
    `).get() as { count: number };

    const distinctCount = distinctResult?.count || 0;

    // Skip if too many distinct values (not useful for filtering)
    if (distinctCount > maxDistinct) {
      console.log(`[MetadataDiscoveryService] Skipping ${field}: ${distinctCount} distinct values > ${maxDistinct}`);
      return null;
    }

    // Get top values with counts
    const topValuesResult = this.db.prepare(`
      SELECT ${column} as value, COUNT(*) as count
      FROM ${table}
      WHERE ${column} IS NOT NULL
      GROUP BY ${column}
      ORDER BY count DESC
      LIMIT 50
    `).all() as Array<{ value: string; count: number }>;

    const topValues: TopValue[] = topValuesResult.map(row => ({
      value: String(row.value),
      count: row.count,
    }));

    return {
      field,
      label,
      type: 'enum',
      source,
      distinctCount,
      topValues,
      coverage: Math.round(coverage * 10) / 10,
    };
  }

  /**
   * Discover a date range facet
   */
  private discoverDateRangeFacet(
    field: string,
    label: string,
    source: FacetSource,
    table: string,
    column: string,
    coverage: number
  ): FacetDefinition | null {
    const rangeResult = this.db.prepare(`
      SELECT MIN(${column}) as min, MAX(${column}) as max
      FROM ${table}
      WHERE ${column} IS NOT NULL
    `).get() as { min: number | null; max: number | null };

    if (!rangeResult?.min || !rangeResult?.max) {
      return null;
    }

    return {
      field,
      label,
      type: 'date_range',
      source,
      distinctCount: 0,  // Not applicable for ranges
      range: {
        min: rangeResult.min,
        max: rangeResult.max,
      } as DateRange,
      coverage: Math.round(coverage * 10) / 10,
    };
  }

  /**
   * Discover a numeric range facet
   */
  private discoverNumericRangeFacet(
    field: string,
    label: string,
    source: FacetSource,
    table: string,
    column: string,
    coverage: number
  ): FacetDefinition | null {
    const rangeResult = this.db.prepare(`
      SELECT MIN(${column}) as min, MAX(${column}) as max
      FROM ${table}
      WHERE ${column} IS NOT NULL
    `).get() as { min: number | null; max: number | null };

    if (rangeResult?.min === null || rangeResult?.max === null) {
      return null;
    }

    // Skip if range is trivial (all same value)
    if (rangeResult.min === rangeResult.max) {
      return null;
    }

    return {
      field,
      label,
      type: 'numeric_range',
      source,
      distinctCount: 0,  // Not applicable for ranges
      range: {
        min: rangeResult.min,
        max: rangeResult.max,
      } as NumericRange,
      coverage: Math.round(coverage * 10) / 10,
    };
  }

  /**
   * Discover a boolean facet
   */
  private discoverBooleanFacet(
    field: string,
    label: string,
    source: FacetSource,
    table: string,
    column: string,
    coverage: number,
    totalCount: number
  ): FacetDefinition | null {
    // Count true vs false
    const trueResult = this.db.prepare(`
      SELECT COUNT(*) as count FROM ${table} WHERE ${column} = 1
    `).get() as { count: number };

    const falseResult = this.db.prepare(`
      SELECT COUNT(*) as count FROM ${table} WHERE ${column} = 0 OR ${column} IS NULL
    `).get() as { count: number };

    const trueCount = trueResult?.count || 0;
    const falseCount = falseResult?.count || 0;

    // Skip if all values are the same (not useful for filtering)
    if (trueCount === 0 || falseCount === 0) {
      return null;
    }

    return {
      field,
      label,
      type: 'boolean',
      source,
      distinctCount: 2,
      topValues: [
        { value: 'true', count: trueCount },
        { value: 'false', count: falseCount },
      ],
      coverage: Math.round(coverage * 10) / 10,
    };
  }

  /**
   * Invalidate the cache (e.g., after import)
   */
  invalidateCache(): void {
    this.cache = null;
    this.cacheExpiry = 0;
    console.log('[MetadataDiscoveryService] Cache invalidated');
  }

  /**
   * Get a specific facet's current values (for refreshing a single filter)
   */
  getFacetValues(field: string): TopValue[] | null {
    const config = DISCOVERABLE_FIELDS.find(f => f.field === field);
    if (!config || config.type !== 'enum') {
      return null;
    }

    try {
      const result = this.db.prepare(`
        SELECT ${config.column} as value, COUNT(*) as count
        FROM ${config.table}
        WHERE ${config.column} IS NOT NULL
        GROUP BY ${config.column}
        ORDER BY count DESC
        LIMIT 100
      `).all() as Array<{ value: string; count: number }>;

      return result.map(row => ({
        value: String(row.value),
        count: row.count,
      }));
    } catch {
      return null;
    }
  }
}

/**
 * QueryCompiler - Convert FilterTree AST to API query parameters
 *
 * Takes a parsed FilterTree and produces a CompiledQuery object
 * that can be sent to the archive-server API.
 */

import type {
  FilterNode,
  FilterTree,
  FilterGroupNode,
  CatuskotiFilterNode,
  RegexFilterNode,
  PhraseFilterNode,
  WildcardFilterNode,
  ComparisonFilterNode,
  SavedStackRefNode,
  CompiledQuery,
  RegexPattern,
} from './types';

import type { CatuskotiFilter } from '../../components/catuskoti/types';

// =============================================================================
// COMPILER
// =============================================================================

export interface CompileOptions {
  /** Pagination limit */
  limit?: number;
  /** Pagination offset */
  offset?: number;
  /** Sort field */
  orderBy?: string;
  /** Sort direction */
  orderDirection?: 'asc' | 'desc';
}

/**
 * Compile a FilterTree into API query parameters
 */
export function compileFilterTree(tree: FilterTree, options: CompileOptions = {}): CompiledQuery {
  const result: CompiledQuery = {
    limit: options.limit,
    offset: options.offset,
    orderBy: options.orderBy,
    orderDirection: options.orderDirection,
  };

  if (!tree.root) {
    return result;
  }

  // Collect all filters by type
  const collector = new FilterCollector();
  collector.collect(tree.root);

  // Apply collected filters to result
  applySourceFilters(result, collector);
  applyContentFilters(result, collector);
  applyMetadataFilters(result, collector);
  applyDateFilters(result, collector);
  applyNumericFilters(result, collector);

  return result;
}

/**
 * Convert a FilterTree back to CatuskotiFilter[] for compatibility
 */
export function filterTreeToCatuskotiFilters(tree: FilterTree): CatuskotiFilter[] {
  if (!tree.root) return [];

  const collector = new FilterCollector();
  collector.collect(tree.root);

  const filters: CatuskotiFilter[] = [];

  // Convert source filters
  for (const filter of collector.catuskotiFilters) {
    if (filter.category === 'source') {
      filters.push({
        id: `source:${filter.value}`,
        label: filter.value,
        state: filter.state,
        count: 0,
        category: 'source',
        value: filter.value,
      });
    }
  }

  return filters;
}

/**
 * Convert CatuskotiFilter[] to a FilterTree
 */
export function catuskotiFiltersToTree(filters: CatuskotiFilter[]): FilterTree {
  const activeFilters = filters.filter(f => f.state !== 'neutral');

  if (activeFilters.length === 0) {
    return {
      root: null,
      originalQuery: '',
      parseErrors: [],
      parseWarnings: [],
    };
  }

  const nodes: FilterNode[] = activeFilters.map(f => ({
    type: 'CATUSKOTI' as const,
    category: f.category as 'source' | 'format' | 'date' | 'words' | 'tags' | 'quality' | 'sim' | 'content',
    value: f.value,
    state: f.state,
  }));

  const root: FilterNode = nodes.length === 1
    ? nodes[0]
    : {
        type: 'AND',
        children: nodes,
      };

  // Generate query string
  const queryParts = activeFilters.map(f => {
    const op = f.state === 'is' ? '+' : f.state === 'is-not' ? '-' : f.state === 'both' ? '~' : '?';
    return `${op}${f.category}:${f.value}`;
  });

  return {
    root,
    originalQuery: queryParts.join(' & '),
    parseErrors: [],
    parseWarnings: [],
  };
}

// =============================================================================
// FILTER COLLECTOR
// =============================================================================

/**
 * Walks the AST and collects filters by type
 */
class FilterCollector {
  catuskotiFilters: CatuskotiFilterNode[] = [];
  regexFilters: RegexFilterNode[] = [];
  phraseFilters: PhraseFilterNode[] = [];
  wildcardFilters: WildcardFilterNode[] = [];
  comparisonFilters: ComparisonFilterNode[] = [];
  stackRefs: SavedStackRefNode[] = [];

  // Track OR groups for complex queries
  orGroups: FilterGroupNode[] = [];

  // Track negations
  negatedFilters: FilterNode[] = [];

  collect(node: FilterNode, negated = false): void {
    switch (node.type) {
      case 'AND': {
        const group = node as FilterGroupNode;
        const isNegated = negated || group.negated;
        for (const child of group.children) {
          this.collect(child, isNegated);
        }
        break;
      }

      case 'OR': {
        const group = node as FilterGroupNode;
        this.orGroups.push(group);
        // For OR groups, collect children but track the OR structure
        for (const child of group.children) {
          this.collect(child, negated || group.negated);
        }
        break;
      }

      case 'CATUSKOTI': {
        const filter = node as CatuskotiFilterNode;
        if (negated) {
          this.negatedFilters.push(filter);
        } else {
          this.catuskotiFilters.push(filter);
        }
        break;
      }

      case 'REGEX': {
        const filter = node as RegexFilterNode;
        if (negated) {
          this.negatedFilters.push(filter);
        } else {
          this.regexFilters.push(filter);
        }
        break;
      }

      case 'PHRASE': {
        const filter = node as PhraseFilterNode;
        if (negated) {
          this.negatedFilters.push(filter);
        } else {
          this.phraseFilters.push(filter);
        }
        break;
      }

      case 'WILDCARD': {
        const filter = node as WildcardFilterNode;
        if (negated) {
          this.negatedFilters.push(filter);
        } else {
          this.wildcardFilters.push(filter);
        }
        break;
      }

      case 'COMPARISON': {
        const filter = node as ComparisonFilterNode;
        if (negated) {
          this.negatedFilters.push(filter);
        } else {
          this.comparisonFilters.push(filter);
        }
        break;
      }

      case 'STACK_REF': {
        const ref = node as SavedStackRefNode;
        this.stackRefs.push(ref);
        // If resolved, collect the resolved tree
        if (ref.resolved) {
          this.collect(ref.resolved, negated);
        }
        break;
      }
    }
  }
}

// =============================================================================
// FILTER APPLICATION
// =============================================================================

function applySourceFilters(result: CompiledQuery, collector: FilterCollector): void {
  const includeTypes: string[] = [];
  const excludeTypes: string[] = [];
  const spanningTypes: string[] = [];
  const uncategorizedTypes: string[] = [];

  for (const filter of collector.catuskotiFilters) {
    if (filter.category !== 'source') continue;

    switch (filter.state) {
      case 'is':
        includeTypes.push(filter.value);
        break;
      case 'is-not':
        excludeTypes.push(filter.value);
        break;
      case 'both':
        spanningTypes.push(filter.value);
        break;
      case 'neither':
        uncategorizedTypes.push(filter.value);
        break;
    }
  }

  if (includeTypes.length > 0) result.sourceTypes = includeTypes;
  if (excludeTypes.length > 0) result.excludeSourceTypes = excludeTypes;
  if (spanningTypes.length > 0) result.spanningSourceTypes = spanningTypes;
  if (uncategorizedTypes.length > 0) result.uncategorizedSourceTypes = uncategorizedTypes;
}

function applyContentFilters(result: CompiledQuery, collector: FilterCollector): void {
  // Regex patterns
  if (collector.regexFilters.length > 0) {
    result.regexPatterns = collector.regexFilters.map(f => ({
      pattern: f.pattern,
      flags: f.flags,
      field: f.field,
    }));
  }

  // Phrase searches
  if (collector.phraseFilters.length > 0) {
    result.phrases = collector.phraseFilters.map(f => f.phrase);
  }

  // Wildcard patterns
  if (collector.wildcardFilters.length > 0) {
    result.wildcards = collector.wildcardFilters.map(f => f.pattern);
  }

  // Content category searches become searchQuery
  const contentFilters = collector.catuskotiFilters.filter(
    f => f.category === 'content' && f.state === 'is'
  );
  if (contentFilters.length > 0) {
    const terms = contentFilters.map(f => f.value);
    result.searchQuery = terms.join(' ');
  }
}

function applyMetadataFilters(result: CompiledQuery, collector: FilterCollector): void {
  const includeTags: string[] = [];
  const excludeTags: string[] = [];

  for (const filter of collector.catuskotiFilters) {
    if (filter.category !== 'tags') continue;

    switch (filter.state) {
      case 'is':
        includeTags.push(filter.value);
        break;
      case 'is-not':
        excludeTags.push(filter.value);
        break;
    }
  }

  if (includeTags.length > 0) result.tags = includeTags;
  if (excludeTags.length > 0) result.excludeTags = excludeTags;
}

function applyDateFilters(result: CompiledQuery, collector: FilterCollector): void {
  for (const filter of collector.comparisonFilters) {
    if (filter.category !== 'date') continue;

    // Parse date string to timestamp
    const parseDate = (dateStr: string | number): number => {
      if (typeof dateStr === 'number') return dateStr;
      const date = new Date(dateStr);
      return date.getTime();
    };

    if (!result.dateRange) {
      result.dateRange = {};
    }

    switch (filter.operator) {
      case '>':
      case '>=':
        result.dateRange.start = parseDate(filter.value);
        break;
      case '<':
      case '<=':
        result.dateRange.end = parseDate(filter.value);
        break;
      case '=':
        // Exact date - expand to full day
        const exactDate = new Date(filter.value as string);
        result.dateRange.start = exactDate.setHours(0, 0, 0, 0);
        result.dateRange.end = exactDate.setHours(23, 59, 59, 999);
        break;
      case '..':
        result.dateRange.start = parseDate(filter.value);
        if (filter.endValue) {
          result.dateRange.end = parseDate(filter.endValue);
        }
        break;
    }
  }

  // Also handle date category in catuskoti filters
  for (const filter of collector.catuskotiFilters) {
    if (filter.category !== 'date') continue;

    if (!result.dateRange) {
      result.dateRange = {};
    }

    // Parse year or date value
    const value = filter.value;
    if (/^\d{4}$/.test(value)) {
      // Just year - expand to full year
      const year = parseInt(value);
      result.dateRange.start = new Date(year, 0, 1).getTime();
      result.dateRange.end = new Date(year, 11, 31, 23, 59, 59).getTime();
    } else {
      // Full date
      const date = new Date(value);
      if (filter.state === 'is') {
        result.dateRange.start = date.getTime();
        result.dateRange.end = new Date(date.getTime() + 24 * 60 * 60 * 1000).getTime();
      }
    }
  }
}

function applyNumericFilters(result: CompiledQuery, collector: FilterCollector): void {
  for (const filter of collector.comparisonFilters) {
    const value = typeof filter.value === 'string' ? parseFloat(filter.value) : filter.value;

    switch (filter.category) {
      case 'words':
        switch (filter.operator) {
          case '>':
          case '>=':
            result.minWords = value;
            break;
          case '<':
          case '<=':
            result.maxWords = value;
            break;
          case '=':
            result.minWords = value;
            result.maxWords = value;
            break;
          case '..':
            result.minWords = value;
            if (filter.endValue) {
              result.maxWords = typeof filter.endValue === 'string'
                ? parseFloat(filter.endValue)
                : filter.endValue;
            }
            break;
        }
        break;

      case 'quality':
        if (filter.operator === '>' || filter.operator === '>=') {
          result.minQuality = value;
        }
        break;

      case 'sim':
        if (filter.operator === '>' || filter.operator === '>=') {
          result.minSimilarity = value;
        }
        break;
    }
  }
}

// =============================================================================
// QUERY STRING GENERATION
// =============================================================================

/**
 * Generate a query string from a CompiledQuery
 */
export function compiledQueryToString(query: CompiledQuery): string {
  const parts: string[] = [];

  // Source filters
  if (query.sourceTypes?.length) {
    parts.push(...query.sourceTypes.map(s => `+source:${s}`));
  }
  if (query.excludeSourceTypes?.length) {
    parts.push(...query.excludeSourceTypes.map(s => `-source:${s}`));
  }
  if (query.spanningSourceTypes?.length) {
    parts.push(...query.spanningSourceTypes.map(s => `~source:${s}`));
  }
  if (query.uncategorizedSourceTypes?.length) {
    parts.push(...query.uncategorizedSourceTypes.map(s => `?source:${s}`));
  }

  // Content filters
  if (query.searchQuery) {
    parts.push(query.searchQuery);
  }
  if (query.phrases?.length) {
    parts.push(...query.phrases.map(p => `"${p}"`));
  }
  if (query.wildcards?.length) {
    parts.push(...query.wildcards);
  }
  if (query.regexPatterns?.length) {
    parts.push(...query.regexPatterns.map(r => `/${r.pattern}/${r.flags}`));
  }

  // Tag filters
  if (query.tags?.length) {
    parts.push(...query.tags.map(t => `+tags:${t}`));
  }
  if (query.excludeTags?.length) {
    parts.push(...query.excludeTags.map(t => `-tags:${t}`));
  }

  // Date filters
  if (query.dateRange) {
    if (query.dateRange.start && query.dateRange.end) {
      const start = new Date(query.dateRange.start).toISOString().split('T')[0];
      const end = new Date(query.dateRange.end).toISOString().split('T')[0];
      parts.push(`date:${start}..${end}`);
    } else if (query.dateRange.start) {
      const start = new Date(query.dateRange.start).toISOString().split('T')[0];
      parts.push(`date:>${start}`);
    } else if (query.dateRange.end) {
      const end = new Date(query.dateRange.end).toISOString().split('T')[0];
      parts.push(`date:<${end}`);
    }
  }

  // Numeric filters
  if (query.minWords !== undefined && query.maxWords !== undefined) {
    parts.push(`words:${query.minWords}..${query.maxWords}`);
  } else if (query.minWords !== undefined) {
    parts.push(`words:>${query.minWords}`);
  } else if (query.maxWords !== undefined) {
    parts.push(`words:<${query.maxWords}`);
  }

  if (query.minQuality !== undefined) {
    parts.push(`quality:>${query.minQuality}`);
  }

  if (query.minSimilarity !== undefined) {
    parts.push(`sim:>${query.minSimilarity}`);
  }

  return parts.join(' & ');
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate a regex pattern
 */
export function validateRegexPattern(pattern: string): { valid: boolean; error?: string } {
  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}

/**
 * Check if a compiled query has any active filters
 */
export function hasActiveFilters(query: CompiledQuery): boolean {
  return !!(
    query.sourceTypes?.length ||
    query.excludeSourceTypes?.length ||
    query.spanningSourceTypes?.length ||
    query.uncategorizedSourceTypes?.length ||
    query.searchQuery ||
    query.phrases?.length ||
    query.wildcards?.length ||
    query.regexPatterns?.length ||
    query.tags?.length ||
    query.excludeTags?.length ||
    query.dateRange?.start ||
    query.dateRange?.end ||
    query.minWords !== undefined ||
    query.maxWords !== undefined ||
    query.minQuality !== undefined ||
    query.minSimilarity !== undefined
  );
}

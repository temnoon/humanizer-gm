/**
 * Advanced Query Language - Type Definitions
 *
 * TECO-inspired query language with:
 * - Progressive refinement (drill-down with history)
 * - Boolean groups (nested AND/OR/NOT logic)
 * - Saved stacks (named filter combinations)
 * - Regular expressions (pattern matching)
 */

import type { CatuskotiState, CatuskotiFilter } from '../../components/catuskoti/types';

// =============================================================================
// TOKEN TYPES
// =============================================================================

export type TokenType =
  | 'INCLUDE'         // +
  | 'EXCLUDE'         // -
  | 'BOTH'            // ~
  | 'NEITHER'         // ?
  | 'AND'             // &
  | 'OR'              // |
  | 'NOT'             // !
  | 'LPAREN'          // (
  | 'RPAREN'          // )
  | 'COLON'           // :
  | 'GREATER'         // >
  | 'LESS'            // <
  | 'EQUAL'           // =
  | 'RANGE'           // ..
  | 'REGEX'           // /pattern/
  | 'STACK_REF'       // @name
  | 'QUOTED'          // "exact phrase"
  | 'WILDCARD'        // conscio*
  | 'IDENTIFIER'      // bare word
  | 'NUMBER'          // 123
  | 'DATE'            // 2024-01-15
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  position: number;
  length: number;
}

// =============================================================================
// AST NODE TYPES
// =============================================================================

/**
 * Filter categories matching API capabilities
 */
export type FilterCategory =
  | 'source'      // chatgpt, claude, facebook, etc.
  | 'format'      // text, markdown, conversation
  | 'date'        // date ranges
  | 'words'       // word count ranges
  | 'tags'        // user tags
  | 'quality'     // SIC score threshold
  | 'sim'         // similarity threshold
  | 'content';    // content search (default)

/**
 * Comparison operators for numeric/date filters
 */
export type ComparisonOp = '>' | '<' | '=' | '>=' | '<=' | '..';

/**
 * Base AST node type
 */
export interface BaseFilterNode {
  type: string;
}

/**
 * Catuskoti filter leaf node - single filter with state
 */
export interface CatuskotiFilterNode extends BaseFilterNode {
  type: 'CATUSKOTI';
  category: FilterCategory;
  value: string;
  state: CatuskotiState;
}

/**
 * Regex pattern filter leaf node
 */
export interface RegexFilterNode extends BaseFilterNode {
  type: 'REGEX';
  pattern: string;
  flags: string;
  field?: 'content' | 'title' | 'tags';
}

/**
 * Exact phrase match filter
 */
export interface PhraseFilterNode extends BaseFilterNode {
  type: 'PHRASE';
  phrase: string;
  field?: 'content' | 'title' | 'tags';
}

/**
 * Wildcard pattern filter
 */
export interface WildcardFilterNode extends BaseFilterNode {
  type: 'WILDCARD';
  pattern: string;
  field?: 'content' | 'title' | 'tags';
}

/**
 * Comparison filter for numeric/date values
 */
export interface ComparisonFilterNode extends BaseFilterNode {
  type: 'COMPARISON';
  category: FilterCategory;
  operator: ComparisonOp;
  value: string | number;
  endValue?: string | number; // For range (..)
}

/**
 * Reference to a saved filter stack
 */
export interface SavedStackRefNode extends BaseFilterNode {
  type: 'STACK_REF';
  name: string;
  resolved?: FilterNode; // Expanded at runtime
}

/**
 * Boolean group node (AND/OR)
 */
export interface FilterGroupNode extends BaseFilterNode {
  type: 'AND' | 'OR';
  children: FilterNode[];
  negated?: boolean; // NOT(group)
}

/**
 * All possible filter node types
 */
export type FilterNode =
  | CatuskotiFilterNode
  | RegexFilterNode
  | PhraseFilterNode
  | WildcardFilterNode
  | ComparisonFilterNode
  | SavedStackRefNode
  | FilterGroupNode;

// =============================================================================
// FILTER TREE
// =============================================================================

/**
 * Complete filter tree with metadata
 */
export interface FilterTree {
  root: FilterNode | null;
  originalQuery: string;
  parseErrors: ParseError[];
  parseWarnings: string[];
}

/**
 * Parse error with position info
 */
export interface ParseError {
  message: string;
  position: number;
  length: number;
}

// =============================================================================
// SAVED STACKS
// =============================================================================

/**
 * A saved filter stack (named query)
 */
export interface SavedStack {
  id: string;
  name: string;              // e.g., "philosophy"
  query: string;             // Original query text
  tree: FilterTree;          // Compiled tree
  description?: string;      // User description
  resultCount?: number;      // Last known count
  createdAt: number;
  updatedAt: number;
  lastUsed?: number;
  syncedToArchive: boolean;  // Whether synced to server
  keyboardShortcut?: number; // 1-9 for Ctrl+N shortcuts
}

// =============================================================================
// REFINEMENT HISTORY
// =============================================================================

/**
 * Single refinement step in drill-down history
 */
export interface RefinementStep {
  id: string;
  query: string;
  tree: FilterTree;
  resultCount: number;
  timestamp: number;
  label: string;             // Short display label
}

/**
 * Complete refinement history
 */
export interface RefinementHistory {
  steps: RefinementStep[];
  currentIndex: number;
}

// =============================================================================
// COMPILED QUERY
// =============================================================================

/**
 * Compiled query ready for API submission
 */
export interface CompiledQuery {
  // Source filters
  sourceTypes?: string[];
  excludeSourceTypes?: string[];
  spanningSourceTypes?: string[];    // 'both' state
  uncategorizedSourceTypes?: string[]; // 'neither' state

  // Content search
  searchQuery?: string;
  regexPatterns?: RegexPattern[];
  phrases?: string[];
  wildcards?: string[];

  // Metadata filters
  tags?: string[];
  excludeTags?: string[];

  // Date filters
  dateRange?: {
    start?: number;
    end?: number;
  };

  // Numeric filters
  minWords?: number;
  maxWords?: number;
  minQuality?: number;
  minSimilarity?: number;

  // Pagination
  limit?: number;
  offset?: number;

  // Sorting
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

/**
 * Regex pattern with field targeting
 */
export interface RegexPattern {
  pattern: string;
  flags: string;
  field?: 'content' | 'title' | 'tags';
}

// =============================================================================
// QUERY PARSER OPTIONS
// =============================================================================

/**
 * Options for query parsing
 */
export interface QueryParserOptions {
  /** Saved stacks for @name resolution */
  savedStacks?: Map<string, SavedStack>;

  /** Default category when none specified */
  defaultCategory?: FilterCategory;

  /** Whether to allow regex patterns */
  allowRegex?: boolean;

  /** Whether to validate category names */
  strictCategories?: boolean;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Mapping from catuskoti state to query operator symbol
 */
export const CATUSKOTI_OPERATORS: Record<CatuskotiState, string> = {
  'neutral': '',
  'is': '+',
  'is-not': '-',
  'both': '~',
  'neither': '?',
};

/**
 * Reverse mapping from symbol to catuskoti state
 */
export const OPERATOR_TO_STATE: Record<string, CatuskotiState> = {
  '+': 'is',
  '-': 'is-not',
  '~': 'both',
  '?': 'neither',
};

/**
 * Valid category prefixes
 */
export const CATEGORY_PREFIXES: FilterCategory[] = [
  'source',
  'format',
  'date',
  'words',
  'tags',
  'quality',
  'sim',
  'content',
];

/**
 * Source type values
 */
export const SOURCE_VALUES = [
  'chatgpt',
  'claude',
  'gemini',
  'facebook',
  'facebook-post',
  'facebook-comment',
  'facebook-message',
  'twitter',
  'discord',
  'slack',
  'email',
  'markdown',
  'text',
  'pdf',
  'html',
  'notebook',
  'obsidian',
  'notion',
  'transform',
  'compose',
  'import',
  'file',
  'url',
  'passage',
] as const;

/**
 * Format type values
 */
export const FORMAT_VALUES = [
  'text',
  'markdown',
  'html',
  'conversation',
  'json',
  'code',
  'latex',
] as const;

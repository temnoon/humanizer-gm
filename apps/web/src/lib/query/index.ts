/**
 * Advanced Query Language - Public API
 *
 * Usage:
 *   import { parseQuery, compileFilterTree, SavedStacksStore } from '@/lib/query';
 *
 *   const tree = parseQuery('+source:chatgpt & /conscious/');
 *   const compiled = compileFilterTree(tree, { limit: 50 });
 */

// Types
export type {
  Token,
  TokenType,
  FilterNode,
  FilterTree,
  ParseError,
  CatuskotiFilterNode,
  RegexFilterNode,
  PhraseFilterNode,
  WildcardFilterNode,
  ComparisonFilterNode,
  SavedStackRefNode,
  FilterGroupNode,
  FilterCategory,
  ComparisonOp,
  CompiledQuery,
  RegexPattern,
  SavedStack,
  RefinementStep,
  RefinementHistory,
  QueryParserOptions,
} from './types';

// Constants
export {
  CATUSKOTI_OPERATORS,
  OPERATOR_TO_STATE,
  CATEGORY_PREFIXES,
  SOURCE_VALUES,
  FORMAT_VALUES,
} from './types';

// Parser
export {
  QueryParser,
  parseQuery,
  tokenize,
  flattenFilterTree,
  countFilterNodes,
  getLeafFilters,
  filterTreeToString,
} from './QueryParser';

// Compiler
export {
  compileFilterTree,
  filterTreeToCatuskotiFilters,
  catuskotiFiltersToTree,
  compiledQueryToString,
  validateRegexPattern,
  hasActiveFilters,
} from './QueryCompiler';

export type { CompileOptions } from './QueryCompiler';

// Saved Stacks
export {
  SavedStacksStore,
  getSavedStacksStore,
  exportStacks,
  importStacks,
} from './SavedStacks';

/**
 * Content Graph - Frontend Integration
 *
 * React context and hooks for Universal Content Graph.
 */

// Context and provider
export {
  ContentGraphProvider,
  useContentGraph,
  useContentGraphAPI,
  type ContentGraphAPI,
} from './ContentGraphContext.js';

// Specialized hooks
export {
  useContentNode,
  useContentNodes,
  useContentSearch,
  useContentLinks,
  useDerivatives,
  useLineage,
  useVersionHistory,
  useRelatedNodes,
  useCreateNode,
  useCreateLink,
  useNodesBySource,
} from './useContentGraph.js';

// UCG Search Agent
export {
  ucgAgentSearch,
  ucgQuickSearch,
  type UCGSearchNode,
  type UCGSearchResult,
  type UCGSearchConfig,
  type UCGSearchProgress,
  type UCGSearchStats,
  type QualityScore,
  type ExpandedContext,
} from './ucg-search-agent.js';

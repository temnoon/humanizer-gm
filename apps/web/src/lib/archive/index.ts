/**
 * Archive Module
 *
 * Exports for interacting with the ChatGPT archive
 */

// Types
export type {
  ArchiveConversation,
  ArchiveConversationFull,
  ArchiveNode,
  ArchiveMessage,
  FlatMessage,
  ConversationListResponse,
  MessagePart,
} from './types';

// Service functions
export {
  fetchConversations,
  fetchConversation,
  getMessages,
  formatDate,
  getYearMonth,
  groupConversationsByMonth,
  checkArchiveHealth,
  getCurrentArchive,
  // Container normalization
  conversationToContainer,
  messageToContainer,
  facebookMediaToContainer,
  facebookContentToContainer,
  textToContainer,
} from './service';

// Archive health hook
export {
  useArchiveHealth,
  needsEmbeddings,
  isOllamaAvailable,
  type ArchiveHealth,
  type ArchiveHealthStats,
  type ArchiveHealthServices,
  type IndexingProgress,
} from './useArchiveHealth';

// Filter context (adaptive search)
export {
  FilterProvider,
  useFilters,
  useFacet,
  useFilterValue,
  describeFilterValue,
  isFacetUseful,
  type FacetDefinition,
  type FacetType,
  type FacetSource,
  type TopValue,
  type DateRange,
  type NumericRange,
  type FilterValue,
  type EnumFilterValue,
  type DateRangeFilterValue,
  type NumericRangeFilterValue,
  type BooleanFilterValue,
  type FilterSpec,
  type FilterContextValue,
  type DiscoveryResult,
} from './FilterContext';

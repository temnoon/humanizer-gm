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

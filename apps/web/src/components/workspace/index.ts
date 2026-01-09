/**
 * Workspace Components
 *
 * Components for the main workspace pane
 */

// Main workspace
export { MainWorkspace, type MainWorkspaceProps, type WorkspaceViewMode } from './MainWorkspace';

// Core content views
export { BookContentView, type BookContent, type BookContentType } from './BookContentView';
export { ContainerWorkspace } from './ContainerWorkspace';

// Analysis and highlighting
export { HighlightableText, SentenceHighlightableText } from './HighlightableText';
export { AnalyzableMarkdown, AnalyzableMarkdownWithMetrics } from './AnalyzableMarkdown';
export { DiffView } from './DiffView';

// Welcome and onboarding
export { WelcomeScreen } from './WelcomeScreen';

// Data structure inspection
export { StructureInspector } from './StructureInspector';

// Harvest review
export {
  HarvestWorkspaceView,
  type HarvestConversation,
  type ConversationMessage,
  type StagedMessage,
} from './HarvestWorkspaceView';

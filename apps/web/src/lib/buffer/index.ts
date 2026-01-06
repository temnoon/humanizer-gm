/**
 * Buffer System
 *
 * Immutable content graph with named buffers, operation pipelines,
 * and archive import.
 *
 * Usage:
 *
 * ```tsx
 * import { BufferProvider, useBuffers } from './lib/buffer';
 *
 * function App() {
 *   return (
 *     <BufferProvider>
 *       <MyComponent />
 *     </BufferProvider>
 *   );
 * }
 *
 * function MyComponent() {
 *   const {
 *     activeContent,
 *     applyOperator,
 *     importText,
 *     undo,
 *     redo,
 *   } = useBuffers();
 *
 *   return <div>{JSON.stringify(activeContent)}</div>;
 * }
 * ```
 */

// Types
export type {
  ContentItem,
  ContentItemMetadata,
  ContentNode,
  ContentNodeMetadata,
  Operation,
  OperationType,
  ArchiveSource,
  ArchiveSourceType,
  Buffer,
  Pipeline,
  PipelineStep,
  OperatorDefinition,
  OperatorParam,
  GraphState,
  BufferEvent,
} from './types';

// Core classes
export { ContentGraph } from './graph';
export { BufferManager } from './buffers';
export { PipelineRunner, PipelineStorage } from './pipeline';
export { ArchiveConnector, parseChatGPTExport } from './archive';
export type { Archive, ArchiveConversation, ArchiveMessage } from './archive';

// Operators
export { operatorRegistry } from './operators';

// Workspace Pins
export {
  PinManager,
  resolvePinContent,
  resolveAllPins,
} from './pins';
export type {
  WorkspacePin,
  PinnedContent,
  PinEvent,
} from './pins';

// React integration
export { BufferProvider, useBuffers } from './BufferContext';

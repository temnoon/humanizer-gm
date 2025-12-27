/**
 * Agent Bus Module
 *
 * Inter-agent communication layer.
 */

export {
  type MessageBus,
  type PublishOptions,
  type BusStats,
  InMemoryMessageBus,
  getMessageBus,
  setMessageBus,
} from './message-bus';

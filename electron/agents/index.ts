/**
 * Agent Council
 *
 * The "House of Houses" - multi-agent coordination system
 * for advancing Book and Node projects.
 *
 * ## Architecture
 *
 * - **Message Bus**: Pub/sub and request/response communication
 * - **Agent Registry**: Agent lifecycle and discovery
 * - **House Agents**: Specialized agents for different domains
 * - **Task Queue**: Priority-based task assignment and execution
 * - **State Store**: SQLite persistence for council state
 * - **Orchestrator**: Session management, signoffs, and coordination
 *
 * ## Quick Start
 *
 * ```typescript
 * import { council, getModelMasterAgent } from './agents';
 *
 * // Initialize the council
 * await council.initialize();
 *
 * // Start a session
 * const session = await council.startSession('project-123');
 *
 * // Call an AI capability via Model Master
 * const response = await council.call('translation', 'Hello world', {
 *   params: { targetLanguage: 'es' },
 * });
 *
 * // Submit a task
 * const taskId = await council.assignTask({
 *   type: 'harvest-thread',
 *   payload: { threadId: 'thread-1' },
 * });
 *
 * // End session
 * await council.endSession(session.id, 'Completed harvest');
 *
 * // Shutdown
 * await council.shutdown();
 * ```
 */

// ═══════════════════════════════════════════════════════════════════
// CORE EXPORTS
// ═══════════════════════════════════════════════════════════════════

// Runtime types and base class
export * from './runtime';

// Message bus
export * from './bus';

// House agents
export * from './houses';

// Task queue
export * from './tasks';

// State store
export * from './state';

// Council orchestrator
export * from './council';

// ═══════════════════════════════════════════════════════════════════
// COUNCIL FACADE
// ═══════════════════════════════════════════════════════════════════

import { getMessageBus } from './bus';
import { getAgentRegistry } from './runtime';
import {
  getModelMasterAgent,
  getProjectManagerAgent,
  getCuratorAgent,
  getBuilderAgent,
  getHarvesterAgent,
  getReviewerAgent,
} from './houses';
import { getTaskQueue } from './tasks';
import { getAgentStore } from './state';
import { getCouncilOrchestrator, type CouncilSession, type SignoffRequestParams, type OrchestratorStats } from './council';
import type { AgentTask, CouncilEvent, CouncilEventListener, Unsubscribe } from './runtime/types';

/**
 * Council facade for easy initialization and management
 */
export const council = {
  // ─────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────────

  /**
   * Initialize the council and all agents
   *
   * The council consists of 6 house agents that supervise book production:
   *
   * - **Model Master**: AI capability wrapper, routes to Ollama/cloud LLMs
   * - **Project Manager**: Orchestrates project lifecycle (planning → mastering)
   * - **Curator**: Content quality assessment, gem discovery, redundancy detection
   * - **Builder**: Chapter composition, transitions, narrative structure
   * - **Harvester**: Archive search, connection discovery, source diversification
   * - **Reviewer**: Quality reviews, humanization checks, publication signoff
   */
  async initialize(): Promise<void> {
    console.log('[Council] Initializing house agents...');

    const registry = getAgentRegistry();
    const orchestrator = getCouncilOrchestrator();

    // Register all house agents for book production supervision
    await registry.register(getModelMasterAgent());
    await registry.register(getProjectManagerAgent());
    await registry.register(getCuratorAgent());
    await registry.register(getBuilderAgent());
    await registry.register(getHarvesterAgent());
    await registry.register(getReviewerAgent());

    console.log('[Council] Registered 6 house agents');

    // Initialize orchestrator (which initializes agents)
    await orchestrator.initialize();

    console.log('[Council] Initialized - ready to supervise book production');
  },

  /**
   * Shutdown the council and all agents
   */
  async shutdown(): Promise<void> {
    console.log('[Council] Shutting down...');
    const orchestrator = getCouncilOrchestrator();
    await orchestrator.shutdown();
    console.log('[Council] Shutdown complete');
  },

  // ─────────────────────────────────────────────────────────────────
  // ACCESSORS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get the message bus
   */
  get bus() {
    return getMessageBus();
  },

  /**
   * Get the agent registry
   */
  get registry() {
    return getAgentRegistry();
  },

  /**
   * Get the task queue
   */
  get queue() {
    return getTaskQueue();
  },

  /**
   * Get the state store
   */
  get store() {
    return getAgentStore();
  },

  /**
   * Get the orchestrator
   */
  get orchestrator() {
    return getCouncilOrchestrator();
  },

  /**
   * Quick access to Model Master
   */
  get modelMaster() {
    return getModelMasterAgent();
  },

  // ─────────────────────────────────────────────────────────────────
  // AI CAPABILITIES
  // ─────────────────────────────────────────────────────────────────

  /**
   * Call an AI capability (convenience method)
   */
  async call(capability: string, input: string, options?: {
    params?: Record<string, unknown>;
    userId?: string;
  }) {
    return getModelMasterAgent().callCapability(capability, input, options);
  },

  // ─────────────────────────────────────────────────────────────────
  // SESSIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Start a new council session
   */
  async startSession(projectId?: string): Promise<CouncilSession> {
    return getCouncilOrchestrator().startSession(projectId);
  },

  /**
   * End a council session
   */
  async endSession(sessionId: string, summary?: string): Promise<void> {
    return getCouncilOrchestrator().endSession(sessionId, summary);
  },

  /**
   * Get the active session for a project
   */
  getActiveSession(projectId?: string): CouncilSession | undefined {
    return getCouncilOrchestrator().getActiveSession(projectId);
  },

  // ─────────────────────────────────────────────────────────────────
  // TASKS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Assign a task to an agent
   */
  async assignTask(task: Omit<AgentTask, 'id'>, options?: {
    priority?: number;
    timeoutMs?: number;
    maxRetries?: number;
    dependsOn?: string[];
    sessionId?: string;
  }): Promise<string> {
    return getCouncilOrchestrator().assignTask(task, options);
  },

  /**
   * Get task status
   */
  getTaskStatus(taskId: string) {
    return getCouncilOrchestrator().getTaskStatus(taskId);
  },

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string, reason?: string): Promise<void> {
    return getCouncilOrchestrator().cancelTask(taskId, reason);
  },

  // ─────────────────────────────────────────────────────────────────
  // SIGNOFFS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Request a signoff for a change
   */
  async requestSignoff(request: SignoffRequestParams) {
    return getCouncilOrchestrator().requestSignoff(request);
  },

  /**
   * Get pending signoffs
   */
  getPendingSignoffs(projectId?: string) {
    return getCouncilOrchestrator().getPendingSignoffs(projectId);
  },

  // ─────────────────────────────────────────────────────────────────
  // PROPOSALS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get pending proposals
   */
  getPendingProposals(projectId?: string) {
    return getCouncilOrchestrator().getPendingProposals(projectId);
  },

  /**
   * Approve a proposal
   */
  async approveProposal(proposalId: string): Promise<void> {
    return getCouncilOrchestrator().approveProposal(proposalId, 'user');
  },

  /**
   * Reject a proposal
   */
  async rejectProposal(proposalId: string): Promise<void> {
    return getCouncilOrchestrator().rejectProposal(proposalId, 'user');
  },

  // ─────────────────────────────────────────────────────────────────
  // EVENTS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Subscribe to council events
   */
  onEvent(listener: CouncilEventListener): Unsubscribe {
    return getCouncilOrchestrator().onEvent(listener);
  },

  // ─────────────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────────────

  /**
   * List all registered agents
   */
  listAgents() {
    return getAgentRegistry().list();
  },

  /**
   * Get health of all agents
   */
  async getHealth() {
    return getAgentRegistry().getAllHealth();
  },

  /**
   * Get orchestrator statistics
   */
  getStats(): OrchestratorStats {
    return getCouncilOrchestrator().getStats();
  },
};

// Default export
export default council;

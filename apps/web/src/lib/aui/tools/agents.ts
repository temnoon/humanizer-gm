/**
 * AUI Tools - Agent Operations
 *
 * Handles agent council interactions:
 * - List available agents
 * - Get agent status
 * - List pending proposals
 * - Request work from agents
 */

import type { AUIToolResult } from './types';
import { getAgentBridge } from '../agent-bridge';

// ═══════════════════════════════════════════════════════════════════
// AGENT TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * List available agents in the council
 */
export function executeListAgents(): AUIToolResult {
  try {
    const bridge = getAgentBridge();
    const agents = bridge.getAgents();
    const isConnected = bridge.isConnected();

    if (!isConnected) {
      return {
        success: true,
        message: 'Agent council not connected (running in standalone mode)',
        data: { connected: false, agents: [] },
      };
    }

    const statusEmoji: Record<string, string> = {
      idle: '🟢',
      working: '🔵',
      waiting: '🟡',
      error: '🔴',
      disabled: '⚫',
    };

    return {
      success: true,
      message: `${agents.length} agent(s) available`,
      data: {
        connected: true,
        agents: agents.map(a => ({
          id: a.id,
          name: a.name,
          house: a.house,
          status: `${statusEmoji[a.status] || '?'} ${a.status}`,
          capabilities: a.capabilities,
        })),
      },
      teaching: {
        whatHappened: `Found ${agents.length} agents in the council`,
        guiPath: ['Settings', 'Agent Council', 'View Agents'],
        why: 'Agents assist with harvesting, curating, building, and reviewing your book content.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to list agents',
    };
  }
}

/**
 * Get status of a specific agent
 */
export function executeGetAgentStatus(params: Record<string, unknown>): AUIToolResult {
  const { agentId } = params as { agentId?: string };

  if (!agentId) {
    return { success: false, error: 'Missing agentId parameter' };
  }

  try {
    const bridge = getAgentBridge();
    const agents = bridge.getAgents();
    const agent = agents.find(a => a.id === agentId);

    if (!agent) {
      return {
        success: false,
        error: `Agent not found: ${agentId}. Available: ${agents.map(a => a.id).join(', ')}`,
      };
    }

    const statusEmoji: Record<string, string> = {
      idle: '🟢 Ready',
      working: '🔵 Working',
      waiting: '🟡 Waiting for approval',
      error: '🔴 Error',
      disabled: '⚫ Disabled',
    };

    return {
      success: true,
      message: `${agent.name}: ${statusEmoji[agent.status] || agent.status}`,
      data: {
        id: agent.id,
        name: agent.name,
        house: agent.house,
        status: agent.status,
        statusDescription: statusEmoji[agent.status] || agent.status,
        capabilities: agent.capabilities,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to get agent status',
    };
  }
}

/**
 * List pending proposals from agents
 */
export function executeListPendingProposals(): AUIToolResult {
  try {
    const bridge = getAgentBridge();
    const proposals = bridge.getPendingProposals();

    if (proposals.length === 0) {
      return {
        success: true,
        message: 'No pending agent proposals',
        data: { proposals: [] },
      };
    }

    const urgencyEmoji: Record<string, string> = {
      low: '📋',
      normal: '📝',
      high: '⚡',
      critical: '🚨',
    };

    return {
      success: true,
      message: `${proposals.length} pending proposal(s)`,
      data: {
        proposals: proposals.map(p => ({
          id: p.id,
          agent: p.agentName,
          urgency: `${urgencyEmoji[p.urgency] || ''} ${p.urgency}`,
          action: p.actionType,
          title: p.title,
          description: p.description,
          createdAt: new Date(p.createdAt).toLocaleTimeString(),
          expiresAt: p.expiresAt ? new Date(p.expiresAt).toLocaleTimeString() : null,
        })),
      },
      teaching: {
        whatHappened: `Found ${proposals.length} proposals awaiting your decision`,
        guiPath: ['AUI Chat', 'View proposal', 'Approve or Reject'],
        why: 'Agents propose actions that may need your approval. Review and approve to let them proceed.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to list proposals',
    };
  }
}

/**
 * Request work from a specific agent
 */
export async function executeRequestAgent(params: Record<string, unknown>): Promise<AUIToolResult> {
  const { agentId, taskType, payload, projectId } = params as {
    agentId?: string;
    taskType?: string;
    payload?: Record<string, unknown>;
    projectId?: string;
  };

  if (!agentId) {
    return { success: false, error: 'Missing agentId parameter' };
  }

  if (!taskType) {
    return { success: false, error: 'Missing taskType parameter' };
  }

  try {
    const bridge = getAgentBridge();

    // Verify agent exists
    const agents = bridge.getAgents();
    const agent = agents.find(a => a.id === agentId);

    if (!agent) {
      return {
        success: false,
        error: `Agent not found: ${agentId}. Available: ${agents.map(a => a.id).join(', ')}`,
      };
    }

    // Request work
    const result = await bridge.requestAgentWork(agentId, taskType, payload || {}, projectId);

    if ('error' in result) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      message: `Requested ${taskType} from ${agent.name}`,
      data: {
        taskId: result.taskId,
        agent: agentId,
        taskType,
      },
      teaching: {
        whatHappened: `Dispatched a "${taskType}" task to ${agent.name}`,
        guiPath: ['AUI Chat', 'View pending proposals', 'Approve when ready'],
        why: 'The agent will work on your request and may propose actions for your approval.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to request agent work',
    };
  }
}

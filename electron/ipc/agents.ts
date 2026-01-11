/**
 * Agent Council IPC Handlers
 *
 * Handles agent listing, proposals, tasks, and session management
 * for the House Council system.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getCouncilOrchestrator, type CouncilOrchestrator } from '../agents/council/orchestrator';
import { getAgentRegistry } from '../agents/runtime/registry';

/**
 * Initialize and register all Agent Council IPC handlers
 * @param getMainWindow - Function to get the current main window (for events)
 */
export function registerAgentHandlers(getMainWindow: () => BrowserWindow | null) {
  // Initialize orchestrator
  const orchestrator = getCouncilOrchestrator();
  const agentRegistry = getAgentRegistry();

  // Initialize orchestrator (will start agents)
  orchestrator.initialize().catch((err) => {
    console.error('Failed to initialize agent orchestrator:', err);
  });

  // Forward orchestrator events to renderer
  orchestrator.onEvent((event) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const timestamp = Date.now();

    switch (event.type) {
      case 'proposal:created':
        // Transform proposal to renderer format
        const proposal = (
          event as {
            proposal?: {
              id: string;
              agentId: string;
              actionType: string;
              title: string;
              description?: string;
              payload?: unknown;
              projectId?: string;
              urgency?: string;
              createdAt: number;
              expiresAt?: number;
              status: string;
            };
          }
        ).proposal;
        if (proposal) {
          const agent = agentRegistry.get(proposal.agentId);
          mainWindow.webContents.send('agents:proposal', {
            type: 'proposal:received',
            proposal: {
              id: proposal.id,
              agentId: proposal.agentId,
              agentName: agent?.name || proposal.agentId,
              actionType: proposal.actionType,
              title: proposal.title,
              description: proposal.description,
              payload: proposal.payload,
              urgency: proposal.urgency || 'normal',
              projectId: proposal.projectId,
              createdAt: proposal.createdAt,
              expiresAt: proposal.expiresAt,
              status: proposal.status,
            },
            timestamp,
          });
        }
        break;

      case 'proposal:approved':
      case 'proposal:rejected':
        mainWindow.webContents.send('agents:proposal', {
          type: event.type,
          proposalId: (event as { proposalId?: string }).proposalId,
          timestamp,
        });
        break;

      case 'session:started':
      case 'session:ended':
      case 'session:paused':
      case 'session:resumed':
        mainWindow.webContents.send('agents:session', {
          type: event.type,
          sessionId: (event as { sessionId?: string }).sessionId,
          projectId: (event as { projectId?: string }).projectId,
          timestamp,
        });
        break;
    }
  });

  // Agent IPC handlers
  ipcMain.handle('agents:list', () => {
    const agents = agentRegistry.list();
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      house: a.house,
      status: a.status,
      capabilities: a.capabilities || [],
    }));
  });

  ipcMain.handle('agents:get', (_e, agentId: string) => {
    const agent = agentRegistry.get(agentId);
    if (!agent) return null;
    return {
      id: agent.id,
      name: agent.name,
      house: agent.house,
      status: agent.status,
      capabilities: agent.capabilities || [],
    };
  });

  // Proposal handlers
  ipcMain.handle('agents:proposals:pending', (_e, projectId?: string) => {
    const proposals = orchestrator.getPendingProposals(projectId);
    return proposals.map((p) => {
      const agent = agentRegistry.get(p.agentId);
      return {
        id: p.id,
        agentId: p.agentId,
        agentName: agent?.name || p.agentId,
        actionType: p.actionType,
        title: p.title,
        description: p.description,
        payload: p.payload,
        urgency: p.urgency || 'normal',
        projectId: p.projectId,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt,
        status: p.status,
      };
    });
  });

  ipcMain.handle('agents:proposals:approve', async (_e, proposalId: string) => {
    try {
      await orchestrator.approveProposal(proposalId, 'user');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('agents:proposals:reject', async (_e, proposalId: string, reason?: string) => {
    try {
      await orchestrator.rejectProposal(proposalId, 'user');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Task handlers
  ipcMain.handle(
    'agents:task:request',
    async (_e, request: { agentId: string; taskType: string; payload: unknown; projectId?: string }) => {
      try {
        const taskId = await orchestrator.assignTask({
          targetAgent: request.agentId,
          type: request.taskType,
          payload: request.payload,
          projectId: request.projectId,
          priority: 5, // Default medium priority
        });
        return { taskId };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  ipcMain.handle('agents:task:status', (_e, taskId: string) => {
    const task = orchestrator.getTaskStatus(taskId);
    if (!task) return { status: 'not_found' };
    return {
      status: task.status,
      result: task.result,
      error: task.error,
    };
  });

  // Session handlers
  ipcMain.handle('agents:session:start', async (_e, projectId?: string) => {
    const session = await orchestrator.startSession(projectId);
    return { sessionId: session.id };
  });

  ipcMain.handle('agents:session:end', async (_e, sessionId: string, summary?: string) => {
    await orchestrator.endSession(sessionId, summary);
    return { success: true };
  });

  // Stats
  ipcMain.handle('agents:stats', () => {
    const stats = orchestrator.getStats();
    return {
      activeSessions: stats.activeSessions,
      pendingProposals: stats.pendingProposals,
      registeredAgents: stats.registeredAgents,
      activeAgents: stats.activeAgents,
    };
  });

  console.log('Agent council initialized');
}

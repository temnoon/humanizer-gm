/**
 * Project Manager Agent
 *
 * The orchestrator of book projects. Tracks project lifecycle,
 * coordinates other agents, and advances projects through phases.
 *
 * Phases: planning → harvesting → curating → drafting → mastering → complete
 */

import { AgentBase } from '../runtime/agent-base';
import type { AgentMessage, HouseType, ProjectPhase } from '../runtime/types';

export interface ProjectStatus {
  projectId: string;
  phase: ProjectPhase;
  progress: number;
  threads: { id: string; passageCount: number; status: 'active' | 'complete' }[];
  chapters: { id: string; status: 'draft' | 'review' | 'approved' }[];
  nextActions: string[];
  blockers: string[];
}

export class ProjectManagerAgent extends AgentBase {
  readonly id = 'project-manager';
  readonly name = 'The Project Manager';
  readonly house: HouseType = 'project-manager';
  readonly capabilities = [
    'get-status',
    'advance-phase',
    'assign-work',
    'track-progress',
    'coordinate-agents',
  ];

  protected async onInitialize(): Promise<void> {
    this.log('info', 'Project Manager ready to coordinate');
    this.subscribe('project:*');
    this.subscribe('chapter:*');
    this.subscribe('thread:*');
  }

  protected async onShutdown(): Promise<void> {
    this.log('info', 'Project Manager retiring');
  }

  protected async onMessage(message: AgentMessage): Promise<unknown> {
    switch (message.type) {
      case 'get-status':
        return this.getProjectStatus(message.payload as { projectId: string });
      case 'advance-phase':
        return this.advancePhase(message.payload as { projectId: string });
      case 'assign-work':
        return this.assignWork(message.payload as AssignWorkRequest);
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  private async getProjectStatus(request: { projectId: string }): Promise<ProjectStatus> {
    // Would integrate with BookProjectService
    return {
      projectId: request.projectId,
      phase: 'planning',
      progress: 0,
      threads: [],
      chapters: [],
      nextActions: ['Define threads', 'Set persona'],
      blockers: [],
    };
  }

  private async advancePhase(request: { projectId: string }): Promise<{ newPhase: ProjectPhase }> {
    await this.proposeAction(
      'advance-phase',
      `Advance project to next phase`,
      `Move project from current phase to the next stage in the workflow`,
      request,
      { projectId: request.projectId, requiresApproval: true }
    );
    return { newPhase: 'harvesting' };
  }

  private async assignWork(request: AssignWorkRequest): Promise<void> {
    const { projectId, agentId, taskType, payload } = request;
    await this.bus.request(agentId, { type: taskType, payload: { ...payload, projectId } });
  }
}

interface AssignWorkRequest {
  projectId: string;
  agentId: string;
  taskType: string;
  payload: Record<string, unknown>;
}

let _projectManager: ProjectManagerAgent | null = null;
export function getProjectManagerAgent(): ProjectManagerAgent {
  if (!_projectManager) _projectManager = new ProjectManagerAgent();
  return _projectManager;
}

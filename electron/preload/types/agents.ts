/**
 * Agent Types
 *
 * Types for Agent Council and AgentMaster
 */

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'error' | 'disabled';

export interface AgentInfo {
  id: string;
  name: string;
  house: string;
  status: AgentStatus;
  capabilities: string[];
}

export interface AgentProposal {
  id: string;
  agentId: string;
  agentName: string;
  actionType: string;
  title: string;
  description?: string;
  payload: unknown;
  urgency: 'low' | 'normal' | 'high' | 'critical';
  projectId?: string;
  createdAt: number;
  expiresAt?: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto';
}

export interface AgentEvent {
  type: string;
  proposal?: AgentProposal;
  agent?: AgentInfo;
  taskId?: string;
  error?: string;
  timestamp: number;
}

export interface AgentTaskRequest {
  agentId: string;
  taskType: string;
  payload: unknown;
  projectId?: string;
}

export interface AgentAPI {
  // Agent queries
  listAgents: () => Promise<AgentInfo[]>;
  getAgent: (agentId: string) => Promise<AgentInfo | null>;

  // Proposal management
  getPendingProposals: (projectId?: string) => Promise<AgentProposal[]>;
  approveProposal: (proposalId: string) => Promise<{ success: boolean; error?: string }>;
  rejectProposal: (proposalId: string, reason?: string) => Promise<{ success: boolean }>;

  // Task dispatch
  requestTask: (request: AgentTaskRequest) => Promise<{ taskId?: string; error?: string }>;
  getTaskStatus: (taskId: string) => Promise<{ status: string; result?: unknown; error?: string }>;

  // Session management
  startSession: (projectId?: string) => Promise<{ sessionId: string }>;
  endSession: (sessionId: string, summary?: string) => Promise<{ success: boolean }>;

  // Stats
  getStats: () => Promise<{
    activeSessions: number;
    pendingProposals: number;
    registeredAgents: number;
    activeAgents: number;
  }>;

  // Event subscriptions
  onProposal: (callback: (event: AgentEvent) => void) => () => void;
  onAgentStatus: (callback: (event: AgentEvent) => void) => () => void;
  onSessionEvent: (callback: (event: AgentEvent) => void) => () => void;
}

export type MemoryTier = 'tiny' | 'standard' | 'full';

export interface DeviceProfile {
  tier: MemoryTier;
  ramGB: number;
  preferLocal: boolean;
  detectedAt: number;
  userOverride?: boolean;
}

export interface TierInfo {
  tier: MemoryTier;
  description: string;
  recommendedModels: string[];
  profile?: DeviceProfile;
}

export interface AgentMasterAPI {
  // Get current device profile (includes tier)
  getProfile: () => Promise<DeviceProfile>;

  // Set tier override for testing (e.g., simulate 8GB device on 32GB machine)
  setTier: (tier: MemoryTier) => Promise<TierInfo>;

  // Clear tier override and use auto-detection
  clearOverride: () => Promise<TierInfo>;

  // Get info about a specific tier
  getTierInfo: (tier: MemoryTier) => Promise<TierInfo>;

  // List available capabilities
  getCapabilities: () => Promise<string[]>;
}

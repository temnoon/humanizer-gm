/**
 * Agent State Store
 *
 * SQLite-based persistence for agent council state.
 * Handles agents, tasks, proposals, signoffs, and sessions.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('better-sqlite3') as typeof import('better-sqlite3');
type DatabaseInstance = import('better-sqlite3').Database;
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

import type {
  Agent,
  AgentInfo,
  AgentStatus,
  AgentTask,
  TaskStatus,
  Proposal,
  ProposalStatus,
  HouseType,
} from '../runtime/types';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface StoredAgent {
  id: string;
  house: HouseType;
  name: string;
  status: AgentStatus;
  capabilities: string[];
  config?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface StoredTask {
  id: string;
  type: string;
  agentId?: string;
  projectId?: string;
  payload?: unknown;
  status: TaskStatus;
  priority: number;
  createdAt: number;
  assignedAt?: number;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  retries: number;
  maxRetries: number;
  timeoutMs: number;
}

export interface StoredProposal {
  id: string;
  agentId: string;
  projectId?: string;
  actionType: string;
  title: string;
  description?: string;
  payload?: unknown;
  status: ProposalStatus;
  requiresApproval: boolean;
  urgency: 'low' | 'normal' | 'high' | 'critical';
  createdAt: number;
  decidedAt?: number;
  decidedBy?: string;
  expiresAt?: number;
}

export interface StoredSignoff {
  id: string;
  projectId: string;
  changeType: string;
  changeId?: string;
  title: string;
  description?: string;
  payload?: unknown;
  requiredAgents: string[];
  votes: Record<string, 'approve' | 'reject' | 'abstain'>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  strictness: 'none' | 'advisory' | 'required' | 'blocking';
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

export interface StoredSession {
  id: string;
  projectId?: string;
  status: 'active' | 'paused' | 'completed';
  startedAt: number;
  endedAt?: number;
  summary?: string;
  stats?: Record<string, unknown>;
}

export interface AgentLogEntry {
  id: number;
  agentId: string;
  eventType: 'info' | 'warn' | 'error' | 'task' | 'proposal';
  projectId?: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface StoredProjectCouncilConfig {
  projectId: string;
  signoffStrictness: 'none' | 'advisory' | 'required' | 'blocking';
  enabledAgents: string[];
  phaseConfig?: Record<string, 'none' | 'advisory' | 'required' | 'blocking'>;
  autoApprove?: {
    passageHarvest?: boolean;
    minorChapterEdits?: boolean;
    pyramidRebuilds?: boolean;
  };
  createdAt: number;
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════════
// STORE INTERFACE
// ═══════════════════════════════════════════════════════════════════

export interface AgentStore {
  // Agents
  saveAgent(agent: StoredAgent): void;
  getAgent(id: string): StoredAgent | undefined;
  listAgents(): StoredAgent[];
  updateAgentStatus(id: string, status: AgentStatus): void;
  deleteAgent(id: string): void;

  // Agent State (key-value)
  setState(agentId: string, key: string, value: unknown): void;
  getState<T = unknown>(agentId: string, key: string): T | undefined;
  getAllState(agentId: string): Record<string, unknown>;
  deleteState(agentId: string, key: string): void;

  // Tasks
  createTask(task: Omit<StoredTask, 'createdAt'>): StoredTask;
  getTask(id: string): StoredTask | undefined;
  listTasks(filter?: TaskFilter): StoredTask[];
  updateTask(id: string, updates: Partial<StoredTask>): void;
  deleteTask(id: string): void;
  getNextPendingTask(agentId?: string): StoredTask | undefined;

  // Proposals
  createProposal(proposal: Omit<StoredProposal, 'createdAt'>): StoredProposal;
  getProposal(id: string): StoredProposal | undefined;
  listProposals(filter?: ProposalFilter): StoredProposal[];
  updateProposal(id: string, updates: Partial<StoredProposal>): void;
  deleteProposal(id: string): void;

  // Signoffs
  createSignoff(signoff: Omit<StoredSignoff, 'createdAt'>): StoredSignoff;
  getSignoff(id: string): StoredSignoff | undefined;
  listSignoffs(filter?: SignoffFilter): StoredSignoff[];
  updateSignoff(id: string, updates: Partial<StoredSignoff>): void;
  recordVote(signoffId: string, agentId: string, vote: 'approve' | 'reject' | 'abstain'): void;

  // Sessions
  createSession(projectId?: string): StoredSession;
  getSession(id: string): StoredSession | undefined;
  getActiveSession(projectId?: string): StoredSession | undefined;
  updateSession(id: string, updates: Partial<StoredSession>): void;
  endSession(id: string, summary?: string): void;
  addTaskToSession(sessionId: string, taskId: string): void;
  getSessionTasks(sessionId: string): StoredTask[];

  // Logging
  log(entry: Omit<AgentLogEntry, 'id' | 'createdAt'>): void;
  getLogs(filter?: LogFilter): AgentLogEntry[];

  // Project Config
  getProjectConfig(projectId: string): StoredProjectCouncilConfig | undefined;
  saveProjectConfig(config: Omit<StoredProjectCouncilConfig, 'createdAt' | 'updatedAt'>): void;

  // Maintenance
  vacuum(): void;
  getStats(): StoreStats;
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  agentId?: string;
  projectId?: string;
  type?: string;
  limit?: number;
}

export interface ProposalFilter {
  status?: ProposalStatus | ProposalStatus[];
  agentId?: string;
  projectId?: string;
  limit?: number;
}

export interface SignoffFilter {
  status?: string | string[];
  projectId?: string;
  strictness?: string;
  limit?: number;
}

export interface LogFilter {
  agentId?: string;
  projectId?: string;
  eventType?: string | string[];
  since?: number;
  limit?: number;
}

export interface StoreStats {
  agents: number;
  tasks: { total: number; pending: number; running: number; completed: number; failed: number };
  proposals: { total: number; pending: number };
  signoffs: { total: number; pending: number };
  sessions: { total: number; active: number };
  logs: number;
  dbSizeBytes: number;
}

// ═══════════════════════════════════════════════════════════════════
// SQLITE IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════

export class SQLiteAgentStore implements AgentStore {
  private db: DatabaseInstance;
  private schemaPath: string;

  constructor(dbPath?: string) {
    // Default path in user data directory
    const userDataPath = app?.getPath?.('userData') || process.cwd();
    const actualDbPath = dbPath || path.join(userDataPath, 'agent-council.db');

    // Ensure directory exists
    const dir = path.dirname(actualDbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(actualDbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Initialize schema
    this.schemaPath = path.join(__dirname, 'schema.sql');
    this.initSchema();
  }

  private initSchema(): void {
    const schema = fs.readFileSync(this.schemaPath, 'utf-8');
    this.db.exec(schema);
  }

  // ─────────────────────────────────────────────────────────────────
  // AGENTS
  // ─────────────────────────────────────────────────────────────────

  saveAgent(agent: StoredAgent): void {
    const stmt = this.db.prepare(`
      INSERT INTO agents (id, house, name, status, capabilities, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        house = excluded.house,
        name = excluded.name,
        status = excluded.status,
        capabilities = excluded.capabilities,
        config = excluded.config,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      agent.id,
      agent.house,
      agent.name,
      agent.status,
      JSON.stringify(agent.capabilities),
      agent.config ? JSON.stringify(agent.config) : null,
      agent.createdAt,
      agent.updatedAt
    );
  }

  getAgent(id: string): StoredAgent | undefined {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as DbAgentRow | undefined;
    return row ? this.rowToAgent(row) : undefined;
  }

  listAgents(): StoredAgent[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY name').all() as DbAgentRow[];
    return rows.map(row => this.rowToAgent(row));
  }

  updateAgentStatus(id: string, status: AgentStatus): void {
    this.db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id);
  }

  deleteAgent(id: string): void {
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  }

  private rowToAgent(row: DbAgentRow): StoredAgent {
    return {
      id: row.id,
      house: row.house as HouseType,
      name: row.name,
      status: row.status as AgentStatus,
      capabilities: JSON.parse(row.capabilities || '[]'),
      config: row.config ? JSON.parse(row.config) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // AGENT STATE
  // ─────────────────────────────────────────────────────────────────

  setState(agentId: string, key: string, value: unknown): void {
    this.db.prepare(`
      INSERT INTO agent_state (agent_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(agentId, key, JSON.stringify(value), Date.now());
  }

  getState<T = unknown>(agentId: string, key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM agent_state WHERE agent_id = ? AND key = ?')
      .get(agentId, key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }

  getAllState(agentId: string): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value FROM agent_state WHERE agent_id = ?')
      .all(agentId) as Array<{ key: string; value: string }>;
    const state: Record<string, unknown> = {};
    for (let i = 0; i < rows.length; i++) {
      state[rows[i].key] = JSON.parse(rows[i].value);
    }
    return state;
  }

  deleteState(agentId: string, key: string): void {
    this.db.prepare('DELETE FROM agent_state WHERE agent_id = ? AND key = ?').run(agentId, key);
  }

  // ─────────────────────────────────────────────────────────────────
  // TASKS
  // ─────────────────────────────────────────────────────────────────

  createTask(task: Omit<StoredTask, 'createdAt'>): StoredTask {
    const createdAt = Date.now();
    this.db.prepare(`
      INSERT INTO tasks (id, type, agent_id, project_id, payload, status, priority, created_at, timeout_ms, max_retries, retries)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.type,
      task.agentId || null,
      task.projectId || null,
      task.payload ? JSON.stringify(task.payload) : null,
      task.status,
      task.priority,
      createdAt,
      task.timeoutMs,
      task.maxRetries,
      task.retries
    );
    return { ...task, createdAt };
  }

  getTask(id: string): StoredTask | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as DbTaskRow | undefined;
    return row ? this.rowToTask(row) : undefined;
  }

  listTasks(filter?: TaskFilter): StoredTask[] {
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }
    if (filter?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(filter.agentId);
    }
    if (filter?.projectId) {
      sql += ' AND project_id = ?';
      params.push(filter.projectId);
    }
    if (filter?.type) {
      sql += ' AND type = ?';
      params.push(filter.type);
    }

    sql += ' ORDER BY priority DESC, created_at ASC';

    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as DbTaskRow[];
    return rows.map(row => this.rowToTask(row));
  }

  updateTask(id: string, updates: Partial<StoredTask>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.agentId !== undefined) {
      fields.push('agent_id = ?');
      values.push(updates.agentId);
    }
    if (updates.assignedAt !== undefined) {
      fields.push('assigned_at = ?');
      values.push(updates.assignedAt);
    }
    if (updates.startedAt !== undefined) {
      fields.push('started_at = ?');
      values.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      fields.push('completed_at = ?');
      values.push(updates.completedAt);
    }
    if (updates.result !== undefined) {
      fields.push('result = ?');
      values.push(JSON.stringify(updates.result));
    }
    if (updates.error !== undefined) {
      fields.push('error = ?');
      values.push(updates.error);
    }
    if (updates.retries !== undefined) {
      fields.push('retries = ?');
      values.push(updates.retries);
    }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteTask(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  getNextPendingTask(agentId?: string): StoredTask | undefined {
    let sql = `
      SELECT * FROM tasks
      WHERE status = 'pending'
    `;
    const params: unknown[] = [];

    if (agentId) {
      sql += ' AND (agent_id = ? OR agent_id IS NULL)';
      params.push(agentId);
    }

    sql += ' ORDER BY priority DESC, created_at ASC LIMIT 1';

    const row = this.db.prepare(sql).get(...params) as DbTaskRow | undefined;
    return row ? this.rowToTask(row) : undefined;
  }

  private rowToTask(row: DbTaskRow): StoredTask {
    return {
      id: row.id,
      type: row.type,
      agentId: row.agent_id || undefined,
      projectId: row.project_id || undefined,
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      status: row.status as TaskStatus,
      priority: row.priority,
      createdAt: row.created_at,
      assignedAt: row.assigned_at || undefined,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error || undefined,
      retries: row.retries,
      maxRetries: row.max_retries,
      timeoutMs: row.timeout_ms,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // PROPOSALS
  // ─────────────────────────────────────────────────────────────────

  createProposal(proposal: Omit<StoredProposal, 'createdAt'>): StoredProposal {
    const createdAt = Date.now();
    this.db.prepare(`
      INSERT INTO proposals (id, agent_id, project_id, action_type, title, description, payload, status, requires_approval, urgency, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      proposal.id,
      proposal.agentId,
      proposal.projectId || null,
      proposal.actionType,
      proposal.title,
      proposal.description || null,
      proposal.payload ? JSON.stringify(proposal.payload) : null,
      proposal.status,
      proposal.requiresApproval ? 1 : 0,
      proposal.urgency,
      createdAt,
      proposal.expiresAt || null
    );
    return { ...proposal, createdAt };
  }

  getProposal(id: string): StoredProposal | undefined {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as DbProposalRow | undefined;
    return row ? this.rowToProposal(row) : undefined;
  }

  listProposals(filter?: ProposalFilter): StoredProposal[] {
    let sql = 'SELECT * FROM proposals WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }
    if (filter?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(filter.agentId);
    }
    if (filter?.projectId) {
      sql += ' AND project_id = ?';
      params.push(filter.projectId);
    }

    sql += ' ORDER BY created_at DESC';

    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as DbProposalRow[];
    return rows.map(row => this.rowToProposal(row));
  }

  updateProposal(id: string, updates: Partial<StoredProposal>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.decidedAt !== undefined) {
      fields.push('decided_at = ?');
      values.push(updates.decidedAt);
    }
    if (updates.decidedBy !== undefined) {
      fields.push('decided_by = ?');
      values.push(updates.decidedBy);
    }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE proposals SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteProposal(id: string): void {
    this.db.prepare('DELETE FROM proposals WHERE id = ?').run(id);
  }

  private rowToProposal(row: DbProposalRow): StoredProposal {
    return {
      id: row.id,
      agentId: row.agent_id,
      projectId: row.project_id || undefined,
      actionType: row.action_type,
      title: row.title,
      description: row.description || undefined,
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      status: row.status as ProposalStatus,
      requiresApproval: row.requires_approval === 1,
      urgency: row.urgency as 'low' | 'normal' | 'high' | 'critical',
      createdAt: row.created_at,
      decidedAt: row.decided_at || undefined,
      decidedBy: row.decided_by || undefined,
      expiresAt: row.expires_at || undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // SIGNOFFS
  // ─────────────────────────────────────────────────────────────────

  createSignoff(signoff: Omit<StoredSignoff, 'createdAt'>): StoredSignoff {
    const createdAt = Date.now();
    this.db.prepare(`
      INSERT INTO signoffs (id, project_id, change_type, change_id, title, description, payload, required_agents, votes, status, strictness, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      signoff.id,
      signoff.projectId,
      signoff.changeType,
      signoff.changeId || null,
      signoff.title,
      signoff.description || null,
      signoff.payload ? JSON.stringify(signoff.payload) : null,
      JSON.stringify(signoff.requiredAgents),
      JSON.stringify(signoff.votes),
      signoff.status,
      signoff.strictness,
      createdAt
    );
    return { ...signoff, createdAt };
  }

  getSignoff(id: string): StoredSignoff | undefined {
    const row = this.db.prepare('SELECT * FROM signoffs WHERE id = ?').get(id) as DbSignoffRow | undefined;
    return row ? this.rowToSignoff(row) : undefined;
  }

  listSignoffs(filter?: SignoffFilter): StoredSignoff[] {
    let sql = 'SELECT * FROM signoffs WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }
    if (filter?.projectId) {
      sql += ' AND project_id = ?';
      params.push(filter.projectId);
    }
    if (filter?.strictness) {
      sql += ' AND strictness = ?';
      params.push(filter.strictness);
    }

    sql += ' ORDER BY created_at DESC';

    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as DbSignoffRow[];
    return rows.map(row => this.rowToSignoff(row));
  }

  updateSignoff(id: string, updates: Partial<StoredSignoff>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.votes !== undefined) {
      fields.push('votes = ?');
      values.push(JSON.stringify(updates.votes));
    }
    if (updates.resolvedAt !== undefined) {
      fields.push('resolved_at = ?');
      values.push(updates.resolvedAt);
    }
    if (updates.resolvedBy !== undefined) {
      fields.push('resolved_by = ?');
      values.push(updates.resolvedBy);
    }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE signoffs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  recordVote(signoffId: string, agentId: string, vote: 'approve' | 'reject' | 'abstain'): void {
    const signoff = this.getSignoff(signoffId);
    if (!signoff) return;

    const votes = { ...signoff.votes, [agentId]: vote };
    this.updateSignoff(signoffId, { votes });
  }

  private rowToSignoff(row: DbSignoffRow): StoredSignoff {
    return {
      id: row.id,
      projectId: row.project_id,
      changeType: row.change_type,
      changeId: row.change_id || undefined,
      title: row.title,
      description: row.description || undefined,
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      requiredAgents: JSON.parse(row.required_agents),
      votes: JSON.parse(row.votes || '{}'),
      status: row.status as 'pending' | 'approved' | 'rejected' | 'expired',
      strictness: row.strictness as 'none' | 'advisory' | 'required' | 'blocking',
      createdAt: row.created_at,
      resolvedAt: row.resolved_at || undefined,
      resolvedBy: row.resolved_by || undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // SESSIONS
  // ─────────────────────────────────────────────────────────────────

  createSession(projectId?: string): StoredSession {
    const id = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startedAt = Date.now();

    this.db.prepare(`
      INSERT INTO council_sessions (id, project_id, status, started_at)
      VALUES (?, ?, 'active', ?)
    `).run(id, projectId || null, startedAt);

    return { id, projectId, status: 'active', startedAt };
  }

  getSession(id: string): StoredSession | undefined {
    const row = this.db.prepare('SELECT * FROM council_sessions WHERE id = ?').get(id) as DbSessionRow | undefined;
    return row ? this.rowToSession(row) : undefined;
  }

  getActiveSession(projectId?: string): StoredSession | undefined {
    let sql = "SELECT * FROM council_sessions WHERE status = 'active'";
    const params: unknown[] = [];

    if (projectId) {
      sql += ' AND project_id = ?';
      params.push(projectId);
    }

    sql += ' ORDER BY started_at DESC LIMIT 1';

    const row = this.db.prepare(sql).get(...params) as DbSessionRow | undefined;
    return row ? this.rowToSession(row) : undefined;
  }

  updateSession(id: string, updates: Partial<StoredSession>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.endedAt !== undefined) {
      fields.push('ended_at = ?');
      values.push(updates.endedAt);
    }
    if (updates.summary !== undefined) {
      fields.push('summary = ?');
      values.push(updates.summary);
    }
    if (updates.stats !== undefined) {
      fields.push('stats = ?');
      values.push(JSON.stringify(updates.stats));
    }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE council_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  endSession(id: string, summary?: string): void {
    this.updateSession(id, {
      status: 'completed',
      endedAt: Date.now(),
      summary,
    });
  }

  addTaskToSession(sessionId: string, taskId: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO session_tasks (session_id, task_id)
      VALUES (?, ?)
    `).run(sessionId, taskId);
  }

  getSessionTasks(sessionId: string): StoredTask[] {
    const rows = this.db.prepare(`
      SELECT t.* FROM tasks t
      JOIN session_tasks st ON t.id = st.task_id
      WHERE st.session_id = ?
      ORDER BY t.created_at ASC
    `).all(sessionId) as DbTaskRow[];
    return rows.map(row => this.rowToTask(row));
  }

  private rowToSession(row: DbSessionRow): StoredSession {
    return {
      id: row.id,
      projectId: row.project_id || undefined,
      status: row.status as 'active' | 'paused' | 'completed',
      startedAt: row.started_at,
      endedAt: row.ended_at || undefined,
      summary: row.summary || undefined,
      stats: row.stats ? JSON.parse(row.stats) : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // LOGGING
  // ─────────────────────────────────────────────────────────────────

  log(entry: Omit<AgentLogEntry, 'id' | 'createdAt'>): void {
    this.db.prepare(`
      INSERT INTO agent_log (agent_id, event_type, project_id, message, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entry.agentId,
      entry.eventType,
      entry.projectId || null,
      entry.message,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      Date.now()
    );
  }

  getLogs(filter?: LogFilter): AgentLogEntry[] {
    let sql = 'SELECT * FROM agent_log WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(filter.agentId);
    }
    if (filter?.projectId) {
      sql += ' AND project_id = ?';
      params.push(filter.projectId);
    }
    if (filter?.eventType) {
      const types = Array.isArray(filter.eventType) ? filter.eventType : [filter.eventType];
      sql += ` AND event_type IN (${types.map(() => '?').join(',')})`;
      params.push(...types);
    }
    if (filter?.since) {
      sql += ' AND created_at >= ?';
      params.push(filter.since);
    }

    sql += ' ORDER BY created_at DESC';

    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as DbLogRow[];
    return rows.map(row => ({
      id: row.id,
      agentId: row.agent_id,
      eventType: row.event_type as 'info' | 'warn' | 'error' | 'task' | 'proposal',
      projectId: row.project_id || undefined,
      message: row.message,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    }));
  }

  // ─────────────────────────────────────────────────────────────────
  // PROJECT CONFIG
  // ─────────────────────────────────────────────────────────────────

  getProjectConfig(projectId: string): StoredProjectCouncilConfig | undefined {
    const row = this.db.prepare('SELECT * FROM project_council_config WHERE project_id = ?')
      .get(projectId) as DbProjectConfigRow | undefined;

    if (!row) return undefined;

    return {
      projectId: row.project_id,
      signoffStrictness: row.signoff_strictness as StoredProjectCouncilConfig['signoffStrictness'],
      enabledAgents: JSON.parse(row.enabled_agents || '[]'),
      phaseConfig: row.phase_config ? JSON.parse(row.phase_config) : undefined,
      autoApprove: row.auto_approve ? JSON.parse(row.auto_approve) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  saveProjectConfig(config: Omit<StoredProjectCouncilConfig, 'createdAt' | 'updatedAt'>): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO project_council_config (project_id, signoff_strictness, enabled_agents, phase_config, auto_approve, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        signoff_strictness = excluded.signoff_strictness,
        enabled_agents = excluded.enabled_agents,
        phase_config = excluded.phase_config,
        auto_approve = excluded.auto_approve,
        updated_at = excluded.updated_at
    `).run(
      config.projectId,
      config.signoffStrictness,
      JSON.stringify(config.enabledAgents),
      config.phaseConfig ? JSON.stringify(config.phaseConfig) : null,
      config.autoApprove ? JSON.stringify(config.autoApprove) : null,
      now,
      now
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // MAINTENANCE
  // ─────────────────────────────────────────────────────────────────

  vacuum(): void {
    this.db.exec('VACUUM');
  }

  getStats(): StoreStats {
    const agents = (this.db.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number }).count;

    const taskStats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM tasks
    `).get() as { total: number; pending: number; running: number; completed: number; failed: number };

    const proposalStats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM proposals
    `).get() as { total: number; pending: number };

    const signoffStats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM signoffs
    `).get() as { total: number; pending: number };

    const sessionStats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active
      FROM council_sessions
    `).get() as { total: number; active: number };

    const logs = (this.db.prepare('SELECT COUNT(*) as count FROM agent_log').get() as { count: number }).count;

    // Get database file size
    const dbPath = this.db.name;
    const dbStats = fs.statSync(dbPath);

    return {
      agents,
      tasks: taskStats,
      proposals: proposalStats,
      signoffs: signoffStats,
      sessions: sessionStats,
      logs,
      dbSizeBytes: dbStats.size,
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

// ═══════════════════════════════════════════════════════════════════
// DB ROW TYPES
// ═══════════════════════════════════════════════════════════════════

interface DbAgentRow {
  id: string;
  house: string;
  name: string;
  status: string;
  capabilities: string | null;
  config: string | null;
  created_at: number;
  updated_at: number;
}

interface DbTaskRow {
  id: string;
  type: string;
  agent_id: string | null;
  project_id: string | null;
  payload: string | null;
  status: string;
  priority: number;
  created_at: number;
  assigned_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  error: string | null;
  retries: number;
  max_retries: number;
  timeout_ms: number;
}

interface DbProposalRow {
  id: string;
  agent_id: string;
  project_id: string | null;
  action_type: string;
  title: string;
  description: string | null;
  payload: string | null;
  status: string;
  requires_approval: number;
  urgency: string;
  created_at: number;
  decided_at: number | null;
  decided_by: string | null;
  expires_at: number | null;
}

interface DbSignoffRow {
  id: string;
  project_id: string;
  change_type: string;
  change_id: string | null;
  title: string;
  description: string | null;
  payload: string | null;
  required_agents: string;
  votes: string | null;
  status: string;
  strictness: string;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
}

interface DbSessionRow {
  id: string;
  project_id: string | null;
  status: string;
  started_at: number;
  ended_at: number | null;
  summary: string | null;
  stats: string | null;
}

interface DbLogRow {
  id: number;
  agent_id: string;
  event_type: string;
  project_id: string | null;
  message: string;
  metadata: string | null;
  created_at: number;
}

interface DbProjectConfigRow {
  project_id: string;
  signoff_strictness: string;
  enabled_agents: string | null;
  phase_config: string | null;
  auto_approve: string | null;
  created_at: number;
  updated_at: number;
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════

let _store: AgentStore | null = null;

/**
 * Get the singleton agent store
 */
export function getAgentStore(): AgentStore {
  if (!_store) {
    _store = new SQLiteAgentStore();
  }
  return _store;
}

/**
 * Set a custom store (for testing)
 */
export function setAgentStore(store: AgentStore): void {
  _store = store;
}

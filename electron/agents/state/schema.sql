-- Agent Council SQLite Schema
-- Persistent state for agents, tasks, proposals, and signoffs
--
-- Version: 1.0
-- Created: December 2025

-- ═══════════════════════════════════════════════════════════════════
-- AGENT REGISTRY
-- ═══════════════════════════════════════════════════════════════════

-- Registered agents
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  house TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'idle',  -- idle, working, waiting, error, disabled
  capabilities TEXT,  -- JSON array
  config TEXT,  -- JSON - agent-specific config
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Agent state (per-agent key-value store)
CREATE TABLE IF NOT EXISTS agent_state (
  agent_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,  -- JSON
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (agent_id, key),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Agent activity log
CREATE TABLE IF NOT EXISTS agent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- info, warn, error, task, proposal
  project_id TEXT,
  message TEXT,
  metadata TEXT,  -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════
-- TASK QUEUE
-- ═══════════════════════════════════════════════════════════════════

-- Task queue for agent work items
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  agent_id TEXT,  -- Assigned agent (null = unassigned)
  project_id TEXT,
  payload TEXT,  -- JSON
  status TEXT DEFAULT 'pending',  -- pending, assigned, running, completed, failed, cancelled
  priority INTEGER DEFAULT 0,  -- Higher = more important
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  assigned_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  result TEXT,  -- JSON - result data
  error TEXT,  -- Error message if failed
  retries INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  timeout_ms INTEGER DEFAULT 60000,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
);

-- Task dependencies (for DAG execution)
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL,
  depends_on TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on) REFERENCES tasks(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════
-- PROPOSALS
-- ═══════════════════════════════════════════════════════════════════

-- Proposals awaiting approval
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  project_id TEXT,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  payload TEXT,  -- JSON
  status TEXT DEFAULT 'pending',  -- pending, approved, rejected, expired, auto
  requires_approval INTEGER DEFAULT 1,  -- 0 = auto-approved
  urgency TEXT DEFAULT 'normal',  -- low, normal, high, critical
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  decided_at INTEGER,
  decided_by TEXT,  -- user ID or 'auto'
  expires_at INTEGER,  -- Auto-expire time
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Proposal votes (for multi-agent consensus)
CREATE TABLE IF NOT EXISTS proposal_votes (
  proposal_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  vote TEXT NOT NULL,  -- approve, reject, abstain
  reason TEXT,
  voted_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (proposal_id, agent_id),
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════
-- SIGNOFF WORKFLOW
-- ═══════════════════════════════════════════════════════════════════

-- Signoff requests for changes
CREATE TABLE IF NOT EXISTS signoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  change_type TEXT NOT NULL,  -- chapter-draft, passage-harvest, style-change, etc.
  change_id TEXT,  -- Reference to the change (chapter ID, etc.)
  title TEXT NOT NULL,
  description TEXT,
  payload TEXT,  -- JSON - change details
  required_agents TEXT,  -- JSON array of agent IDs
  votes TEXT,  -- JSON object { agentId: 'approve'|'reject'|'abstain' }
  status TEXT DEFAULT 'pending',  -- pending, approved, rejected, expired
  strictness TEXT DEFAULT 'advisory',  -- none, advisory, required, blocking
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  resolved_at INTEGER,
  resolved_by TEXT
);

-- ═══════════════════════════════════════════════════════════════════
-- COUNCIL SESSIONS
-- ═══════════════════════════════════════════════════════════════════

-- Council sessions (work periods)
CREATE TABLE IF NOT EXISTS council_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  status TEXT DEFAULT 'active',  -- active, paused, completed
  started_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  ended_at INTEGER,
  summary TEXT,  -- Session summary
  stats TEXT  -- JSON - session statistics
);

-- Session-task association
CREATE TABLE IF NOT EXISTS session_tasks (
  session_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (session_id, task_id),
  FOREIGN KEY (session_id) REFERENCES council_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════
-- PROJECT COUNCIL CONFIG
-- ═══════════════════════════════════════════════════════════════════

-- Per-project council configuration
CREATE TABLE IF NOT EXISTS project_council_config (
  project_id TEXT PRIMARY KEY,
  signoff_strictness TEXT DEFAULT 'advisory',  -- none, advisory, required, blocking
  enabled_agents TEXT,  -- JSON array of enabled agent IDs
  phase_config TEXT,  -- JSON - per-phase signoff overrides
  auto_approve TEXT,  -- JSON - auto-approval settings
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ═══════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════

-- Agents
CREATE INDEX IF NOT EXISTS idx_agents_house ON agents(house);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

-- Agent state
CREATE INDEX IF NOT EXISTS idx_agent_state_updated ON agent_state(updated_at);

-- Agent log
CREATE INDEX IF NOT EXISTS idx_agent_log_agent ON agent_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_log_project ON agent_log(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_log_type ON agent_log(event_type);
CREATE INDEX IF NOT EXISTS idx_agent_log_created ON agent_log(created_at);

-- Tasks
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

-- Proposals
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_agent ON proposals(agent_id);
CREATE INDEX IF NOT EXISTS idx_proposals_project ON proposals(project_id);
CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at);

-- Signoffs
CREATE INDEX IF NOT EXISTS idx_signoffs_project ON signoffs(project_id);
CREATE INDEX IF NOT EXISTS idx_signoffs_status ON signoffs(status);
CREATE INDEX IF NOT EXISTS idx_signoffs_created ON signoffs(created_at);

-- Sessions
CREATE INDEX IF NOT EXISTS idx_sessions_project ON council_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON council_sessions(status);

-- Chat Service Schema
-- SQLite database for AUI conversation persistence

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  message_count INTEGER DEFAULT 0,
  tags TEXT, -- JSON array
  archived INTEGER DEFAULT 0,
  project_id TEXT,
  preview TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  tool_results TEXT, -- JSON array of ToolResult
  metadata TEXT, -- JSON object
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Tool execution log
CREATE TABLE IF NOT EXISTS tool_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  params TEXT, -- JSON object
  success INTEGER NOT NULL,
  result TEXT,
  error TEXT,
  agent_id TEXT, -- If routed to an agent
  execution_time_ms INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- LLM call log (for debugging/analytics)
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  success INTEGER NOT NULL,
  error TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_started ON conversations(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(archived);
CREATE INDEX IF NOT EXISTS idx_tool_executions_message ON tool_executions(message_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_tool ON tool_executions(tool_name);
CREATE INDEX IF NOT EXISTS idx_llm_calls_conversation ON llm_calls(conversation_id);

-- Full-text search for messages
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
  INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

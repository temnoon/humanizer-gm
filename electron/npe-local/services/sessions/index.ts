/**
 * Sessions Service
 *
 * Local CRUD operations for studio sessions.
 */

import { getDatabase, generateId } from '../database';

// ============================================================================
// Types
// ============================================================================

export interface SessionBuffer {
  bufferId: string;
  type: 'original' | 'transformation' | 'analysis' | 'edited';
  displayName: string;
  sourceBufferId?: string;
  sourceRef?: string;
  sourceSelection?: { start: number; end: number };
  tool?: string;
  settings?: Record<string, unknown>;
  text?: string;
  resultText?: string;
  analysisResult?: unknown;
  metadata?: Record<string, unknown>;
  userEdits?: unknown[];
  isEdited: boolean;
  created: string;
}

export interface Session {
  sessionId: string;
  name: string;
  created: string;
  updated: string;
  sourceArchive: string;
  sourceMessageId?: string;
  buffers: SessionBuffer[];
  activeBufferId: string;
  viewMode: 'split' | 'single-original' | 'single-transformed';
}

export interface CreateSessionInput {
  sessionId?: string;
  name: string;
  sourceArchive?: string;
  sourceMessageId?: string;
  viewMode?: 'split' | 'single-original' | 'single-transformed';
  activeBufferId?: string;
  buffers?: SessionBuffer[];
}

// ============================================================================
// CRUD Operations
// ============================================================================

export function createSession(input: CreateSessionInput, userId: string = 'local'): Session {
  const db = getDatabase();
  const sessionId = input.sessionId || generateId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO studio_sessions (id, user_id, name, source_archive, source_message_id, view_mode, active_buffer_id, buffers, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    userId,
    input.name,
    input.sourceArchive || 'main',
    input.sourceMessageId || null,
    input.viewMode || 'single-original',
    input.activeBufferId || null,
    JSON.stringify(input.buffers || []),
    now,
    now
  );

  return {
    sessionId,
    name: input.name,
    sourceArchive: input.sourceArchive || 'main',
    sourceMessageId: input.sourceMessageId,
    viewMode: input.viewMode || 'single-original',
    activeBufferId: input.activeBufferId || '',
    buffers: input.buffers || [],
    created: now,
    updated: now,
  };
}

export function listSessions(userId: string = 'local', limit: number = 50, offset: number = 0): Session[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT id, name, source_archive, source_message_id, view_mode, active_buffer_id, buffers, created_at, updated_at
    FROM studio_sessions
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, Math.min(limit, 100), offset) as any[];

  return rows.map(row => ({
    sessionId: row.id,
    name: row.name,
    sourceArchive: row.source_archive,
    sourceMessageId: row.source_message_id,
    viewMode: row.view_mode,
    activeBufferId: row.active_buffer_id || '',
    buffers: JSON.parse(row.buffers || '[]'),
    created: row.created_at,
    updated: row.updated_at,
  }));
}

export function getSession(sessionId: string, userId: string = 'local'): Session | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT id, name, source_archive, source_message_id, view_mode, active_buffer_id, buffers, created_at, updated_at
    FROM studio_sessions
    WHERE id = ? AND user_id = ?
  `).get(sessionId, userId) as any;

  if (!row) return null;

  return {
    sessionId: row.id,
    name: row.name,
    sourceArchive: row.source_archive,
    sourceMessageId: row.source_message_id,
    viewMode: row.view_mode,
    activeBufferId: row.active_buffer_id || '',
    buffers: JSON.parse(row.buffers || '[]'),
    created: row.created_at,
    updated: row.updated_at,
  };
}

export function updateSession(sessionId: string, updates: Partial<Session>, userId: string = 'local'): Session | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const existing = getSession(sessionId, userId);
  if (!existing) return null;

  db.prepare(`
    UPDATE studio_sessions SET
      name = ?,
      source_archive = ?,
      source_message_id = ?,
      view_mode = ?,
      active_buffer_id = ?,
      buffers = ?,
      updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    updates.name ?? existing.name,
    updates.sourceArchive ?? existing.sourceArchive,
    updates.sourceMessageId ?? existing.sourceMessageId ?? null,
    updates.viewMode ?? existing.viewMode,
    updates.activeBufferId ?? existing.activeBufferId ?? null,
    JSON.stringify(updates.buffers ?? existing.buffers),
    now,
    sessionId,
    userId
  );

  return getSession(sessionId, userId);
}

export function deleteSession(sessionId: string, userId: string = 'local'): boolean {
  const db = getDatabase();

  const result = db.prepare(`
    DELETE FROM studio_sessions WHERE id = ? AND user_id = ?
  `).run(sessionId, userId);

  return result.changes > 0;
}

export function renameSession(sessionId: string, name: string, userId: string = 'local'): Session | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const existing = getSession(sessionId, userId);
  if (!existing) return null;

  db.prepare(`
    UPDATE studio_sessions SET name = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(name, now, sessionId, userId);

  return getSession(sessionId, userId);
}

// ============================================================================
// Buffer Operations
// ============================================================================

export function addBuffer(sessionId: string, buffer: SessionBuffer, userId: string = 'local'): Session | null {
  const session = getSession(sessionId, userId);
  if (!session) return null;

  const buffers = [...session.buffers, buffer];
  return updateSession(sessionId, { buffers }, userId);
}

export function updateBuffer(sessionId: string, bufferId: string, updates: Partial<SessionBuffer>, userId: string = 'local'): Session | null {
  const session = getSession(sessionId, userId);
  if (!session) return null;

  const buffers = session.buffers.map(b =>
    b.bufferId === bufferId ? { ...b, ...updates } : b
  );

  return updateSession(sessionId, { buffers }, userId);
}

export function removeBuffer(sessionId: string, bufferId: string, userId: string = 'local'): Session | null {
  const session = getSession(sessionId, userId);
  if (!session) return null;

  const buffers = session.buffers.filter(b => b.bufferId !== bufferId);

  // If we removed the active buffer, clear it or set to first buffer
  let activeBufferId = session.activeBufferId;
  if (activeBufferId === bufferId) {
    activeBufferId = buffers.length > 0 ? buffers[0].bufferId : '';
  }

  return updateSession(sessionId, { buffers, activeBufferId }, userId);
}

export function setActiveBuffer(sessionId: string, bufferId: string, userId: string = 'local'): Session | null {
  return updateSession(sessionId, { activeBufferId: bufferId }, userId);
}

/**
 * Audit Logging Middleware for Archive Server
 *
 * Logs security-relevant events for monitoring and forensics.
 * Stores logs in SQLite database for persistence and querying.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { getAuthContext } from './auth';

// Types
export interface AuditEntry {
  id: string;
  timestamp: number;
  userId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorCode?: string;
  metadata?: Record<string, unknown>;
  requestPath: string;
  requestMethod: string;
}

export type AuditAction =
  | 'read'
  | 'write'
  | 'delete'
  | 'search'
  | 'import'
  | 'auth_success'
  | 'auth_failure'
  | 'access_denied';

import type Database from 'better-sqlite3';

// Database reference (set on initialization)
let auditDb: Database.Database | null = null;

/**
 * Initialize audit logging with database connection
 */
export function initAuditLog(db: Database.Database): void {
  auditDb = db;
  console.log('[audit] Audit logging initialized');
}

/**
 * Log an audit entry directly (for non-middleware use cases)
 */
export function logAuditEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
  if (!auditDb) {
    console.warn('[audit] Audit database not initialized, skipping log');
    return;
  }

  try {
    auditDb.prepare(`
      INSERT INTO audit_log (
        id, timestamp, user_id, action, resource_type, resource_id,
        ip_address, user_agent, success, error_code, metadata,
        request_path, request_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      Date.now(),
      entry.userId,
      entry.action,
      entry.resourceType,
      entry.resourceId || null,
      entry.ipAddress || null,
      entry.userAgent || null,
      entry.success ? 1 : 0,
      entry.errorCode || null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.requestPath,
      entry.requestMethod
    );
  } catch (error) {
    console.error('[audit] Failed to log audit entry:', error);
  }
}

/**
 * Create audit logging middleware for specific actions
 */
export function auditLog(
  action: AuditAction,
  resourceType: string,
  options: {
    getResourceId?: (req: Request) => string | undefined;
    getMetadata?: (req: Request, res: Response) => Record<string, unknown> | undefined;
    logOnSuccess?: boolean;
    logOnFailure?: boolean;
  } = {}
): RequestHandler {
  const {
    getResourceId,
    getMetadata,
    logOnSuccess = true,
    logOnFailure = true,
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const authContext = getAuthContext(req);

    // Capture original send/json methods
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);

    // Helper to log the entry
    const logEntry = (body: unknown) => {
      const success = res.statusCode < 400;

      // Skip based on configuration
      if (success && !logOnSuccess) return;
      if (!success && !logOnFailure) return;

      let errorCode: string | undefined;
      if (!success && typeof body === 'object' && body !== null) {
        errorCode = (body as Record<string, unknown>).code as string;
      }

      logAuditEntry({
        userId: authContext?.userId || null,
        action,
        resourceType,
        resourceId: getResourceId?.(req),
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
        success,
        errorCode,
        metadata: getMetadata?.(req, res),
        requestPath: req.path,
        requestMethod: req.method,
      });
    };

    // Override send
    res.send = function(body: unknown) {
      logEntry(body);
      return originalSend(body);
    };

    // Override json
    res.json = function(body: unknown) {
      logEntry(body);
      return originalJson(body);
    };

    next();
  };
}

/**
 * Query audit logs (for admin use)
 */
export function queryAuditLogs(
  filters: {
    userId?: string;
    action?: AuditAction;
    resourceType?: string;
    startTime?: number;
    endTime?: number;
    success?: boolean;
  } = {},
  options: {
    limit?: number;
    offset?: number;
  } = {}
): AuditEntry[] {
  if (!auditDb) {
    console.warn('[audit] Audit database not initialized');
    return [];
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.userId) {
    conditions.push('user_id = ?');
    params.push(filters.userId);
  }
  if (filters.action) {
    conditions.push('action = ?');
    params.push(filters.action);
  }
  if (filters.resourceType) {
    conditions.push('resource_type = ?');
    params.push(filters.resourceType);
  }
  if (filters.startTime) {
    conditions.push('timestamp >= ?');
    params.push(filters.startTime);
  }
  if (filters.endTime) {
    conditions.push('timestamp <= ?');
    params.push(filters.endTime);
  }
  if (filters.success !== undefined) {
    conditions.push('success = ?');
    params.push(filters.success ? 1 : 0);
  }

  let sql = 'SELECT * FROM audit_log';
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY timestamp DESC';

  const limit = options.limit || 100;
  const offset = options.offset || 0;
  sql += ` LIMIT ${limit} OFFSET ${offset}`;

  try {
    const rows = auditDb.prepare(sql).all(...params) as Array<{
      id: string;
      timestamp: number;
      user_id: string | null;
      action: AuditAction;
      resource_type: string;
      resource_id: string | null;
      ip_address: string | null;
      user_agent: string | null;
      success: number;
      error_code: string | null;
      metadata: string | null;
      request_path: string;
      request_method: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id || undefined,
      ipAddress: row.ip_address || undefined,
      userAgent: row.user_agent || undefined,
      success: row.success === 1,
      errorCode: row.error_code || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      requestPath: row.request_path,
      requestMethod: row.request_method,
    }));
  } catch (error) {
    console.error('[audit] Failed to query audit logs:', error);
    return [];
  }
}

/**
 * Get audit statistics (for admin dashboard)
 */
export function getAuditStats(timeRangeMs: number = 24 * 60 * 60 * 1000): {
  totalRequests: number;
  failedRequests: number;
  uniqueUsers: number;
  topActions: Array<{ action: string; count: number }>;
} {
  if (!auditDb) {
    return { totalRequests: 0, failedRequests: 0, uniqueUsers: 0, topActions: [] };
  }

  const since = Date.now() - timeRangeMs;

  try {
    const total = auditDb.prepare(`
      SELECT COUNT(*) as count FROM audit_log WHERE timestamp >= ?
    `).all(since) as Array<{ count: number }>;

    const failed = auditDb.prepare(`
      SELECT COUNT(*) as count FROM audit_log WHERE timestamp >= ? AND success = 0
    `).all(since) as Array<{ count: number }>;

    const users = auditDb.prepare(`
      SELECT COUNT(DISTINCT user_id) as count FROM audit_log WHERE timestamp >= ? AND user_id IS NOT NULL
    `).all(since) as Array<{ count: number }>;

    const actions = auditDb.prepare(`
      SELECT action, COUNT(*) as count FROM audit_log
      WHERE timestamp >= ?
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `).all(since) as Array<{ action: string; count: number }>;

    return {
      totalRequests: total[0]?.count || 0,
      failedRequests: failed[0]?.count || 0,
      uniqueUsers: users[0]?.count || 0,
      topActions: actions,
    };
  } catch (error) {
    console.error('[audit] Failed to get audit stats:', error);
    return { totalRequests: 0, failedRequests: 0, uniqueUsers: 0, topActions: [] };
  }
}

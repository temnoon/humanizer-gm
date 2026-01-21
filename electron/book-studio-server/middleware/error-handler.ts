/**
 * Error Handling Middleware for Book Studio Server
 *
 * Provides centralized error handling with consistent response format,
 * error classification, and safe error logging.
 */

import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for Book Studio API errors
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 400 Bad Request - Invalid input
 */
export class BadRequestError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(400, message, 'BAD_REQUEST', details);
    this.name = 'BadRequestError';
  }
}

/**
 * 401 Unauthorized - Missing or invalid authentication
 */
export class UnauthorizedError extends ApiError {
  constructor(message = 'Authentication required') {
    super(401, message, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

/**
 * 403 Forbidden - Authenticated but not allowed
 */
export class ForbiddenError extends ApiError {
  constructor(message = 'Access denied') {
    super(403, message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

/**
 * 404 Not Found - Resource doesn't exist
 */
export class NotFoundError extends ApiError {
  constructor(resource: string) {
    super(404, `${resource} not found`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/**
 * 409 Conflict - Resource already exists or state conflict
 */
export class ConflictError extends ApiError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

/**
 * 422 Unprocessable Entity - Validation failed
 */
export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(422, message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

/**
 * 503 Service Unavailable - External service down
 */
export class ServiceUnavailableError extends ApiError {
  constructor(service: string, details?: unknown) {
    super(503, `${service} is unavailable`, 'SERVICE_UNAVAILABLE', details);
    this.name = 'ServiceUnavailableError';
  }
}

// ============================================================================
// Error Response Format
// ============================================================================

interface ErrorResponse {
  success: false;
  error: {
    message: string;
    code: string;
    details?: unknown;
  };
  timestamp: number;
}

function formatErrorResponse(
  message: string,
  code: string,
  details?: unknown
): ErrorResponse {
  const response: ErrorResponse = {
    success: false,
    error: {
      message,
      code,
    },
    timestamp: Date.now(),
  };

  if (details !== undefined) {
    response.error.details = details;
  }

  return response;
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Check if error is a database constraint error
 */
function isDatabaseConstraintError(err: Error): boolean {
  const message = err.message.toLowerCase();
  return (
    message.includes('unique constraint') ||
    message.includes('foreign key constraint') ||
    message.includes('not null constraint')
  );
}

/**
 * Check if error is a database connection error
 */
function isDatabaseConnectionError(err: Error): boolean {
  const message = err.message.toLowerCase();
  return (
    message.includes('database is locked') ||
    message.includes('sqlite_busy') ||
    message.includes('cannot open database')
  );
}

/**
 * Sanitize error message for safe client exposure
 * Removes internal paths and sensitive information
 */
function sanitizeErrorMessage(message: string): string {
  // Remove file paths
  let sanitized = message.replace(/\/[^\s]+\.(ts|js|json)/g, '[file]');

  // Remove stack traces embedded in messages
  sanitized = sanitized.replace(/at\s+.+\(.+\)/g, '');

  // Remove line/column numbers
  sanitized = sanitized.replace(/:\d+:\d+/g, '');

  return sanitized.trim();
}

// ============================================================================
// Error Handler Middleware
// ============================================================================

/**
 * Main error handling middleware
 * Should be registered last in the middleware chain
 */
export const errorHandler: ErrorRequestHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log error for debugging
  console.error('[book-studio-server] Error:', {
    name: err.name,
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  // Handle known API errors
  if (err instanceof ApiError) {
    res.status(err.statusCode).json(
      formatErrorResponse(err.message, err.code || 'API_ERROR', err.details)
    );
    return;
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
      code: e.code,
    }));
    res.status(400).json(
      formatErrorResponse('Validation failed', 'VALIDATION_ERROR', details)
    );
    return;
  }

  // Handle database constraint errors
  if (isDatabaseConstraintError(err)) {
    res.status(409).json(
      formatErrorResponse(
        'Operation conflicts with existing data',
        'DATABASE_CONSTRAINT'
      )
    );
    return;
  }

  // Handle database connection errors
  if (isDatabaseConnectionError(err)) {
    res.status(503).json(
      formatErrorResponse(
        'Database temporarily unavailable',
        'DATABASE_UNAVAILABLE'
      )
    );
    return;
  }

  // Handle JSON parsing errors
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json(
      formatErrorResponse('Invalid JSON in request body', 'INVALID_JSON')
    );
    return;
  }

  // Handle unknown errors - sanitize message for safety
  const safeMessage = sanitizeErrorMessage(err.message);
  res.status(500).json(
    formatErrorResponse(
      process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : safeMessage || 'Internal server error',
      'INTERNAL_ERROR'
    )
  );
};

/**
 * 404 handler for unmatched routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(
    formatErrorResponse(
      `Route not found: ${req.method} ${req.path}`,
      'ROUTE_NOT_FOUND'
    )
  );
}

/**
 * Async wrapper to catch errors in async route handlers
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Rate Limiting Middleware for Archive Server
 *
 * Provides request rate limiting to protect against abuse and DoS attacks.
 * Uses in-memory storage (suitable for single-instance Electron app).
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { getAuthContext } from './auth';
import { configService } from '../services/ConfigService';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Maximum requests per window
  keyGenerator?: (req: Request) => string;  // Custom key generator
  skipOnDev?: boolean;   // Skip rate limiting in development
}

// In-memory storage for rate limit tracking
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up old entries periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Default key generator - uses user ID if authenticated, otherwise IP
 */
function defaultKeyGenerator(req: Request): string {
  const authContext = getAuthContext(req);
  if (authContext?.userId) {
    return `user:${authContext.userId}`;
  }
  // Fallback to IP address
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

/**
 * Create a rate limiting middleware
 */
export function createRateLimit(config: RateLimitConfig): RequestHandler {
  const {
    windowMs,
    maxRequests,
    keyGenerator = defaultKeyGenerator,
    skipOnDev = true,
  } = config;

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip in development if configured
    if (skipOnDev && process.env.NODE_ENV === 'development') {
      return next();
    }

    const key = keyGenerator(req);
    const now = Date.now();

    // Get or create entry
    let entry = rateLimitStore.get(key);
    if (!entry || entry.resetTime < now) {
      entry = {
        count: 0,
        resetTime: now + windowMs,
      };
    }

    entry.count++;
    rateLimitStore.set(key, entry);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

    // Check if over limit
    if (entry.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil((entry.resetTime - now) / 1000));
      return res.status(429).json({
        error: 'Too many requests',
        code: 'RATE_LIMITED',
        retryAfter: Math.ceil((entry.resetTime - now) / 1000),
      });
    }

    next();
  };
}

// Pre-configured rate limiters for common use cases
// Uses lazy initialization to allow ConfigService to be initialized first

let _globalRateLimit: RequestHandler | null = null;
let _searchRateLimit: RequestHandler | null = null;
let _importRateLimit: RequestHandler | null = null;
let _authFailureRateLimit: RequestHandler | null = null;

/**
 * Get rate limit config, with fallbacks if not initialized
 */
function getRateLimitConfig() {
  try {
    return configService.getSection('rateLimit');
  } catch {
    // Fallback defaults if config not initialized
    return {
      searchMaxRequests: 120,
      searchWindowMs: 60000,
      importMaxRequests: 10,
      importWindowMs: 300000,
    };
  }
}

/**
 * Global rate limiter - 1000 requests per 15 minutes
 */
export function getGlobalRateLimit(): RequestHandler {
  if (!_globalRateLimit) {
    _globalRateLimit = createRateLimit({
      windowMs: 15 * 60 * 1000,  // 15 minutes
      maxRequests: 1000,
    });
  }
  return _globalRateLimit;
}
export const globalRateLimit: RequestHandler = (req, res, next) => getGlobalRateLimit()(req, res, next);

/**
 * Search rate limiter - uses config values
 * (increased for local Electron app with React StrictMode double-invocations)
 */
export function getSearchRateLimit(): RequestHandler {
  if (!_searchRateLimit) {
    const config = getRateLimitConfig();
    _searchRateLimit = createRateLimit({
      windowMs: config.searchWindowMs,
      maxRequests: config.searchMaxRequests,
    });
  }
  return _searchRateLimit;
}
export const searchRateLimit: RequestHandler = (req, res, next) => getSearchRateLimit()(req, res, next);

/**
 * Import rate limiter - uses config values
 * (imports are very expensive operations)
 */
export function getImportRateLimit(): RequestHandler {
  if (!_importRateLimit) {
    const config = getRateLimitConfig();
    _importRateLimit = createRateLimit({
      windowMs: config.importWindowMs,
      maxRequests: config.importMaxRequests,
    });
  }
  return _importRateLimit;
}
export const importRateLimit: RequestHandler = (req, res, next) => getImportRateLimit()(req, res, next);

/**
 * Auth failure rate limiter - 5 attempts per minute
 * (protects against brute force attacks)
 */
export function getAuthFailureRateLimit(): RequestHandler {
  if (!_authFailureRateLimit) {
    _authFailureRateLimit = createRateLimit({
      windowMs: 60 * 1000,  // 1 minute
      maxRequests: 5,
      keyGenerator: (req) => `auth:${req.ip || 'unknown'}`,
      skipOnDev: false,  // Always enforce for auth failures
    });
  }
  return _authFailureRateLimit;
}
export const authFailureRateLimit: RequestHandler = (req, res, next) => getAuthFailureRateLimit()(req, res, next);

/**
 * Reset all cached rate limiters (useful when config changes)
 */
export function resetRateLimiters(): void {
  _globalRateLimit = null;
  _searchRateLimit = null;
  _importRateLimit = null;
  _authFailureRateLimit = null;
}

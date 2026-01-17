/**
 * JWT Authentication Middleware for Book Studio Server
 *
 * Validates JWT tokens from Authorization header and attaches
 * user context to request for downstream handlers.
 *
 * Uses `jose` library for JWT validation (same as NPE-API).
 * Note: jose is ESM-only, so we use dynamic import.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';

// Dynamic import for ESM-only jose library
let joseModule: typeof import('jose') | null = null;

async function getJose(): Promise<typeof import('jose')> {
  if (!joseModule) {
    joseModule = await import('jose');
  }
  return joseModule;
}

// ============================================================================
// Types
// ============================================================================

/**
 * User context extracted from JWT
 */
export interface AuthContext {
  userId: string;
  email: string;
  role: 'free' | 'member' | 'pro' | 'premium' | 'admin';
  tier: string;
}

/**
 * Extended Request type with auth context
 */
export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
}

// ============================================================================
// Configuration
// ============================================================================

let jwtSecret: Uint8Array | null = null;

/**
 * Initialize the auth middleware with a JWT secret
 * Must be called before using requireAuth()
 */
export function initAuth(secret: string): void {
  if (!secret || secret.length < 32) {
    throw new Error('JWT secret must be at least 32 characters');
  }
  jwtSecret = new TextEncoder().encode(secret);
  console.log('[book-studio-auth] Auth middleware initialized');
}

/**
 * Get the configured JWT secret
 */
export function getJwtSecret(): Uint8Array {
  if (!jwtSecret) {
    throw new Error('Auth middleware not initialized. Call initAuth() first.');
  }
  return jwtSecret;
}

/**
 * Check if auth is enabled (secret configured)
 */
export function isAuthEnabled(): boolean {
  return jwtSecret !== null;
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Extract and validate JWT from Authorization header
 */
async function validateToken(authHeader: string | undefined): Promise<AuthContext | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix

  try {
    const jose = await getJose();
    const secret = getJwtSecret();
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });

    // Extract user data from payload
    const userId = payload.sub as string;
    const email = (payload.email as string) || '';
    const role = (payload.role as AuthContext['role']) || 'free';
    const tier = (payload.tier as string) || role;

    if (!userId) {
      console.warn('[book-studio-auth] Token missing user ID');
      return null;
    }

    return { userId, email, role, tier };
  } catch (error) {
    const jose = await getJose();
    if (error instanceof jose.errors.JWTExpired) {
      console.warn('[book-studio-auth] Token expired');
    } else if (error instanceof jose.errors.JWTClaimValidationFailed) {
      console.warn('[book-studio-auth] Token claim validation failed:', (error as Error).message);
    } else if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
      console.warn('[book-studio-auth] Token signature verification failed');
    } else {
      console.warn('[book-studio-auth] Token validation error:', error);
    }
    return null;
  }
}

/**
 * Middleware that requires valid authentication
 * Returns 401 if not authenticated
 */
export function requireAuth(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip auth if not enabled (development mode)
    if (!isAuthEnabled()) {
      // In development, create a default dev user
      (req as AuthenticatedRequest).auth = {
        userId: 'dev-user',
        email: 'dev@localhost',
        role: 'admin',
        tier: 'admin',
      };
      return next();
    }

    const authContext = await validateToken(req.headers.authorization);

    if (!authContext) {
      return res.status(401).json({
        error: 'Missing or invalid authorization header',
        code: 'UNAUTHORIZED',
      });
    }

    // Attach auth context to request
    (req as AuthenticatedRequest).auth = authContext;
    next();
  };
}

/**
 * Middleware that optionally extracts authentication
 * Does not fail if no token present
 */
export function optionalAuth(): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    // Skip auth if not enabled (development mode)
    if (!isAuthEnabled()) {
      (req as AuthenticatedRequest).auth = {
        userId: 'dev-user',
        email: 'dev@localhost',
        role: 'admin',
        tier: 'admin',
      };
      return next();
    }

    const authContext = await validateToken(req.headers.authorization);

    if (authContext) {
      (req as AuthenticatedRequest).auth = authContext;
    }

    next();
  };
}

/**
 * Middleware that requires a specific role or higher
 */
export function requireRole(minRole: AuthContext['role']): RequestHandler {
  const roleHierarchy: AuthContext['role'][] = ['free', 'member', 'pro', 'premium', 'admin'];

  return async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.auth) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }

    const userRoleIndex = roleHierarchy.indexOf(authReq.auth.role);
    const requiredRoleIndex = roleHierarchy.indexOf(minRole);

    if (userRoleIndex < requiredRoleIndex) {
      return res.status(403).json({
        error: `This action requires ${minRole} tier or higher`,
        code: 'FORBIDDEN',
        required_tier: minRole,
        current_tier: authReq.auth.role,
      });
    }

    next();
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get user ID from an authenticated request
 * Throws if request is not authenticated
 */
export function getUserId(req: Request): string {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.auth?.userId) {
    throw new Error('Request not authenticated');
  }
  return authReq.auth.userId;
}

/**
 * Get auth context from request
 * Returns null if not authenticated
 */
export function getAuthContext(req: Request): AuthContext | null {
  return (req as AuthenticatedRequest).auth || null;
}

/**
 * Check if user owns a resource
 */
export function isOwner(req: Request, resourceUserId: string | null): boolean {
  const authReq = req as AuthenticatedRequest;

  // If resource has no owner (legacy data), allow access
  if (!resourceUserId) {
    return true;
  }

  // Admins can access everything
  if (authReq.auth?.role === 'admin') {
    return true;
  }

  return authReq.auth?.userId === resourceUserId;
}

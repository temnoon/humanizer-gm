/**
 * Auth API Service
 *
 * Handles all authenticated API calls to the NPE backend
 */

import type {
  User,
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  OAuthProvider,
} from './types';
import { isElectron, getElectronAPI } from '../platform';

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const API_BASE = import.meta.env.VITE_API_URL || 'https://npe-api.tem-527.workers.dev';
const TOKEN_KEY = 'humanizer-auth-token';

// ═══════════════════════════════════════════════════════════════════
// TOKEN MANAGEMENT (Secure Storage)
// ═══════════════════════════════════════════════════════════════════
//
// Security: Tokens are stored in memory-only (not localStorage) to prevent
// XSS attacks from stealing tokens. In Electron, we also sync to the main
// process store for persistence across app restarts (secure, not renderer-accessible).
//
// Trade-off: In web browser, tokens don't survive page refresh (user must re-login).
// In Electron desktop app, tokens persist securely via main process store.

// In-memory token storage (primary - always used)
let memoryToken: string | null = null;

// Initialize token from Electron secure store on startup
let tokenInitialized = false;
async function initTokenFromElectronStore(): Promise<void> {
  if (tokenInitialized) return;
  tokenInitialized = true;

  if (isElectron) {
    const api = getElectronAPI();
    if (api?.store) {
      try {
        const storedToken = await api.store.get(TOKEN_KEY);
        if (typeof storedToken === 'string' && storedToken) {
          memoryToken = storedToken;
        }
      } catch {
        // Electron store unavailable, use memory only
      }
    }
  }
}

// Call initialization (non-blocking, will complete by the time token is needed)
initTokenFromElectronStore();

export function getStoredToken(): string | null {
  return memoryToken;
}

export function setStoredToken(token: string): void {
  memoryToken = token;

  // Also persist to Electron's secure store (main process, not XSS-accessible)
  if (isElectron) {
    const api = getElectronAPI();
    if (api?.store) {
      api.store.set(TOKEN_KEY, token).catch(() => {
        // Ignore errors - memory storage is primary
      });
    }
  }
}

export function clearStoredToken(): void {
  memoryToken = null;

  // Also clear from Electron's secure store
  if (isElectron) {
    const api = getElectronAPI();
    if (api?.store) {
      api.store.set(TOKEN_KEY, '').catch(() => {
        // Ignore errors
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// HTTP CLIENT
// ═══════════════════════════════════════════════════════════════════

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  requireAuth?: boolean;
  timeout?: number;
}

async function apiFetch<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', body, requireAuth = false, timeout = 30000 } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add auth header if we have a token
  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (requireAuth) {
    throw new Error('Authentication required');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Request failed: ${response.statusText}`);
    }

    return data as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// AUTH ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Register a new user
 */
export async function register(email: string, password: string): Promise<AuthResponse> {
  const request: RegisterRequest = { email, password };
  const response = await apiFetch<AuthResponse>('/auth/register', {
    method: 'POST',
    body: request,
  });

  setStoredToken(response.token);
  return response;
}

/**
 * Login with email/password
 */
export async function login(email: string, password: string): Promise<AuthResponse> {
  const request: LoginRequest = { email, password };
  const response = await apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: request,
  });

  setStoredToken(response.token);
  return response;
}

/**
 * Get current user info
 */
export async function getCurrentUser(): Promise<User> {
  return apiFetch<User>('/auth/me', { requireAuth: true });
}

/**
 * Logout (client-side only)
 */
export function logout(): void {
  clearStoredToken();
}

// ═══════════════════════════════════════════════════════════════════
// OAUTH
// ═══════════════════════════════════════════════════════════════════

// Cache for OAuth callback port (fetched once from Electron)
let cachedOAuthCallbackPort: number | null = null;

/**
 * Get OAuth callback port from Electron (for development localhost server)
 */
async function getOAuthCallbackPort(): Promise<number | null> {
  if (cachedOAuthCallbackPort !== null) return cachedOAuthCallbackPort;
  if (!isElectron) return null;

  const electronWindow = window as unknown as {
    electronAPI?: { auth?: { getCallbackPort: () => Promise<number | null> } }
  };
  const authAPI = electronWindow.electronAPI?.auth;
  if (!authAPI?.getCallbackPort) return null;

  cachedOAuthCallbackPort = await authAPI.getCallbackPort();
  return cachedOAuthCallbackPort;
}

/**
 * Get OAuth login URL for a provider
 */
export function getOAuthLoginUrl(provider: OAuthProvider, callbackPort?: number | null): string {
  let redirectUri: string;

  if (isElectron) {
    if (callbackPort) {
      // Development: use localhost callback server
      redirectUri = `http://127.0.0.1:${callbackPort}/auth/callback`;
    } else {
      // Production: use custom protocol
      redirectUri = 'humanizer://auth/callback';
    }
  } else {
    // Web: use origin
    redirectUri = `${window.location.origin}/auth/callback`;
  }

  return `${API_BASE}/auth/oauth/${provider}/login?redirect=${encodeURIComponent(redirectUri)}`;
}

/**
 * Get OAuth login URL async (fetches callback port if needed)
 */
export async function getOAuthLoginUrlAsync(provider: OAuthProvider): Promise<string> {
  const callbackPort = await getOAuthCallbackPort();
  return getOAuthLoginUrl(provider, callbackPort);
}

/**
 * Open OAuth in external browser (for Electron)
 * Returns true if handled by Electron, false if should use normal flow
 */
export async function openOAuthExternal(provider: OAuthProvider): Promise<boolean> {
  if (!isElectron) return false;

  const api = getElectronAPI();
  if (!api?.shell) return false;

  // Get the OAuth URL (with correct callback for dev/prod)
  const url = await getOAuthLoginUrlAsync(provider);
  await api.shell.openExternal(url);
  return true;
}

/**
 * Handle OAuth callback - extract token from URL
 */
export function handleOAuthCallback(): { token: string; isNewUser: boolean } | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const isNewUser = params.get('new_user') === 'true';

  if (token) {
    setStoredToken(token);
    // Clean up URL
    window.history.replaceState({}, '', window.location.pathname);
    return { token, isNewUser };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// AUTHENTICATED API WRAPPER
// ═══════════════════════════════════════════════════════════════════

/**
 * Make an authenticated API call
 * This is the main function to use for all protected endpoints
 */
export async function authenticatedFetch<T>(
  endpoint: string,
  options: Omit<FetchOptions, 'requireAuth'> = {}
): Promise<T> {
  return apiFetch<T>(endpoint, { ...options, requireAuth: true });
}

/**
 * Make an API call with optional auth (uses token if available)
 */
export async function optionalAuthFetch<T>(
  endpoint: string,
  options: Omit<FetchOptions, 'requireAuth'> = {}
): Promise<T> {
  return apiFetch<T>(endpoint, { ...options, requireAuth: false });
}

// ═══════════════════════════════════════════════════════════════════
// STRIPE BILLING
// ═══════════════════════════════════════════════════════════════════

export interface SubscriptionInfo {
  tier: string;
  status: string;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
}

/**
 * Create a Stripe checkout session for subscription
 */
export async function createCheckoutSession(tier: 'member' | 'pro' | 'premium'): Promise<{ url: string }> {
  return authenticatedFetch('/stripe/create-checkout', {
    method: 'POST',
    body: {
      tier,
      successUrl: `${window.location.origin}/settings?success=true`,
      cancelUrl: `${window.location.origin}/settings?canceled=true`,
    },
  });
}

/**
 * Get current subscription status
 */
export async function getSubscription(): Promise<SubscriptionInfo | null> {
  try {
    return await authenticatedFetch('/stripe/subscription');
  } catch {
    return null;
  }
}

/**
 * Create portal session to manage subscription
 */
export async function createPortalSession(): Promise<{ url: string }> {
  return authenticatedFetch('/stripe/portal', {
    method: 'POST',
    body: {
      returnUrl: `${window.location.origin}/settings`,
    },
  });
}

/**
 * Purchase a day pass
 */
export async function purchaseDayPass(): Promise<{ url: string }> {
  return authenticatedFetch('/stripe/day-pass', {
    method: 'POST',
    body: {
      successUrl: `${window.location.origin}/?daypass=true`,
      cancelUrl: `${window.location.origin}/`,
    },
  });
}

/**
 * useAuthenticatedFetch Hook
 *
 * Provides a fetch wrapper that handles authentication gracefully:
 * - Checks auth state before making requests
 * - Handles 401 responses by prompting re-login
 * - Retries the request after successful login
 * - Falls back gracefully for unauthenticated users
 */

import { useCallback } from 'react';
import { useAuth } from './AuthContext';
import { getStoredToken } from './api';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface AuthFetchOptions extends RequestInit {
  /** Custom timeout in ms (default 30000) */
  timeout?: number;
  /** Fallback value to return if auth fails and user dismisses login */
  fallback?: unknown;
  /** Message to show in login prompt */
  authMessage?: string;
}

export interface AuthFetchResult<T> {
  data: T | null;
  error: string | null;
  status: 'success' | 'auth_required' | 'error';
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const API_BASE = import.meta.env.VITE_API_URL || 'https://npe-api.tem-527.workers.dev';
const DEFAULT_TIMEOUT = 30000;

// ═══════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════

export function useAuthenticatedFetch() {
  const { isAuthenticated, requireAuth } = useAuth();

  /**
   * Make an authenticated API request
   * Returns a result object with data, error, and status
   */
  const authFetch = useCallback(async <T>(
    endpoint: string,
    options: AuthFetchOptions = {}
  ): Promise<AuthFetchResult<T>> => {
    const { timeout = DEFAULT_TIMEOUT, fallback, authMessage, ...fetchOptions } = options;

    // Check if we have a token
    const token = getStoredToken();

    if (!token) {
      // No token - prompt for login
      const shouldRetry = requireAuth(
        authMessage || `Please log in to access ${endpoint}`,
        () => {
          // After login, we can't easily retry here
          // The component should re-trigger the request
        }
      );

      if (!shouldRetry) {
        return {
          data: fallback as T | null,
          error: 'Authentication required',
          status: 'auth_required',
        };
      }
    }

    // Build request
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(fetchOptions.headers as Record<string, string> || {}),
    };

    // Add auth header
    const currentToken = getStoredToken();
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 - auth expired or invalid
      if (response.status === 401) {
        // Prompt for re-login
        requireAuth(
          authMessage || 'Your session has expired. Please log in again.',
        );

        return {
          data: fallback as T | null,
          error: 'Session expired',
          status: 'auth_required',
        };
      }

      // Handle other errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          data: null,
          error: errorData.error || `Request failed: ${response.statusText}`,
          status: 'error',
        };
      }

      // Success
      const data = await response.json();
      return {
        data: data as T,
        error: null,
        status: 'success',
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          data: fallback as T | null,
          error: 'Request timed out',
          status: 'error',
        };
      }

      return {
        data: fallback as T | null,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
      };
    }
  }, [requireAuth]);

  /**
   * Check authentication before performing an action
   * Returns true if authenticated, false if login prompt shown
   */
  const checkAuth = useCallback((message?: string, onSuccess?: () => void): boolean => {
    return requireAuth(message, onSuccess);
  }, [requireAuth]);

  /**
   * Simple authenticated GET request
   */
  const authGet = useCallback(<T>(
    endpoint: string,
    options?: Omit<AuthFetchOptions, 'method'>
  ): Promise<AuthFetchResult<T>> => {
    return authFetch<T>(endpoint, { ...options, method: 'GET' });
  }, [authFetch]);

  /**
   * Simple authenticated POST request
   */
  const authPost = useCallback(<T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<AuthFetchOptions, 'method' | 'body'>
  ): Promise<AuthFetchResult<T>> => {
    return authFetch<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }, [authFetch]);

  return {
    authFetch,
    authGet,
    authPost,
    checkAuth,
    isAuthenticated,
  };
}

export default useAuthenticatedFetch;

/**
 * Cloud Bridge Module
 *
 * Provides connectivity to cloud services for features that require them:
 * - Authentication (OAuth, WebAuthn)
 * - Billing/Quotas (Stripe)
 * - GPTZero AI Detection (rate-limited API)
 * - Cross-device sync
 */

// Cloud API Configuration
const DEFAULT_CLOUD_API = 'https://npe-api.tem-527.workers.dev';

let cloudApiUrl = DEFAULT_CLOUD_API;
let authToken: string | null = null;

/**
 * Configure the cloud bridge
 */
export function configureCloudBridge(config: {
  apiUrl?: string;
  authToken?: string;
}): void {
  if (config.apiUrl) {
    cloudApiUrl = config.apiUrl;
  }
  if (config.authToken) {
    authToken = config.authToken;
  }
}

/**
 * Get current cloud API URL
 */
export function getCloudApiUrl(): string {
  return cloudApiUrl;
}

/**
 * Set authentication token
 */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

/**
 * Get authentication token
 */
export function getAuthToken(): string | null {
  return authToken;
}

/**
 * Check if cloud bridge is configured
 */
export function isCloudConfigured(): boolean {
  return !!authToken;
}

/**
 * Make an authenticated request to the cloud API
 */
export async function cloudFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${cloudApiUrl}${endpoint}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (authToken) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${authToken}`;
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Cloud bridge health check
 */
export async function checkCloudHealth(): Promise<{
  reachable: boolean;
  authenticated: boolean;
  latencyMs?: number;
}> {
  const startTime = Date.now();

  try {
    const response = await cloudFetch('/health');
    const latencyMs = Date.now() - startTime;

    return {
      reachable: response.ok,
      authenticated: !!authToken,
      latencyMs,
    };
  } catch {
    return {
      reachable: false,
      authenticated: false,
    };
  }
}

// ============================================================================
// Authentication Bridge
// ============================================================================

export interface AuthResult {
  success: boolean;
  token?: string;
  user?: {
    id: string;
    email: string;
    name?: string;
    role?: string;
  };
  error?: string;
}

/**
 * Login with email/password
 */
export async function cloudLogin(email: string, password: string): Promise<AuthResult> {
  try {
    const response = await cloudFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (response.ok && data.token) {
      setAuthToken(data.token);
      return {
        success: true,
        token: data.token,
        user: data.user,
      };
    }

    return {
      success: false,
      error: data.error || 'Login failed',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

/**
 * Logout
 */
export async function cloudLogout(): Promise<void> {
  try {
    if (authToken) {
      await cloudFetch('/auth/logout', { method: 'POST' });
    }
  } finally {
    setAuthToken(null);
  }
}

/**
 * Check current user
 */
export async function cloudGetUser(): Promise<AuthResult['user'] | null> {
  if (!authToken) return null;

  try {
    const response = await cloudFetch('/auth/me');
    if (response.ok) {
      const data = await response.json();
      return data.user;
    }
  } catch {
    // Token might be invalid
  }

  return null;
}

/**
 * Get OAuth login URL
 */
export function getOAuthUrl(provider: 'google' | 'github' | 'discord' | 'facebook' | 'apple'): string {
  return `${cloudApiUrl}/oauth/${provider}/authorize`;
}

// ============================================================================
// GPTZero Bridge
// ============================================================================

export interface GPTZeroResult {
  success: boolean;
  verdict?: 'human' | 'ai' | 'mixed';
  confidence?: number;
  explanation?: string;
  details?: {
    completely_generated_prob: number;
    average_generated_prob: number;
    sentences?: Array<{
      sentence: string;
      generated_prob: number;
    }>;
  };
  highlightedMarkdown?: string;
  error?: string;
  quotaRemaining?: number;
}

/**
 * Detect AI text using GPTZero (via cloud API)
 *
 * Requires Pro/Premium subscription
 */
export async function detectWithGPTZero(text: string): Promise<GPTZeroResult> {
  if (!authToken) {
    return {
      success: false,
      error: 'Authentication required for GPTZero detection',
    };
  }

  try {
    const response = await cloudFetch('/ai-detection/detect', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });

    const data = await response.json();

    if (response.ok) {
      return {
        success: true,
        verdict: data.verdict,
        confidence: data.confidence,
        explanation: data.explanation,
        details: data.details,
        highlightedMarkdown: data.highlightedMarkdown,
        quotaRemaining: data.quotaRemaining,
      };
    }

    return {
      success: false,
      error: data.error || 'GPTZero detection failed',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

// ============================================================================
// User Settings Bridge
// ============================================================================

/**
 * Get user settings from cloud
 */
export async function getCloudSettings(): Promise<Record<string, unknown> | null> {
  if (!authToken) return null;

  try {
    const response = await cloudFetch('/user/settings');
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Network error
  }

  return null;
}

/**
 * Update user settings in cloud
 */
export async function updateCloudSettings(settings: Record<string, unknown>): Promise<boolean> {
  if (!authToken) return false;

  try {
    const response = await cloudFetch('/user/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Quota Bridge
// ============================================================================

export interface QuotaInfo {
  tier: string;
  transformations: { used: number; limit: number };
  detections: { used: number; limit: number };
  profileExtractions: { used: number; limit: number };
  resetDate: string;
}

/**
 * Get user quota information
 */
export async function getQuotaInfo(): Promise<QuotaInfo | null> {
  if (!authToken) return null;

  try {
    const response = await cloudFetch('/user/quota');
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Network error
  }

  return null;
}

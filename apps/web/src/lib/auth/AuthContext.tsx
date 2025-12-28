/**
 * Auth Context
 *
 * Provides authentication state and methods throughout the app
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

import type { User, OAuthProvider } from './types';
import {
  login as apiLogin,
  register as apiRegister,
  getCurrentUser,
  logout as apiLogout,
  getStoredToken,
  getOAuthLoginUrl,
  handleOAuthCallback,
  openOAuthExternal,
} from './api';
import { isElectron } from '../platform';

// ═══════════════════════════════════════════════════════════════════
// CONTEXT TYPE
// ═══════════════════════════════════════════════════════════════════

interface AuthContextType {
  // State
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Login prompt state (for showing login modal when 401 occurs)
  showLoginPrompt: boolean;
  loginPromptMessage: string | null;
  pendingAction: (() => void) | null;

  // Auth methods
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  clearError: () => void;

  // OAuth
  loginWithOAuth: (provider: OAuthProvider) => void;

  // Login prompt control
  requireAuth: (message?: string, onSuccess?: () => void) => boolean;
  dismissLoginPrompt: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ═══════════════════════════════════════════════════════════════════
// PROVIDER
// ═══════════════════════════════════════════════════════════════════

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Login prompt state
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loginPromptMessage, setLoginPromptMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Check for existing session on mount
  useEffect(() => {
    const initAuth = async () => {
      // Check for OAuth callback first
      const callback = handleOAuthCallback();
      if (callback) {
        // Token was just set, fetch user
        try {
          const userData = await getCurrentUser();
          setUser(userData);
        } catch (err) {
          console.error('Failed to fetch user after OAuth:', err);
        }
        setIsLoading(false);
        return;
      }

      // Check for existing token
      const token = getStoredToken();
      if (token) {
        try {
          const userData = await getCurrentUser();
          setUser(userData);
        } catch (err) {
          // Token invalid, clear it
          apiLogout();
          console.error('Session expired:', err);
        }
      }

      setIsLoading(false);
    };

    initAuth();
  }, []);

  // Login with email/password
  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiLogin(email, password);
      setUser(response.user);

      // Execute pending action if any and dismiss prompt
      if (pendingAction) {
        const action = pendingAction;
        setPendingAction(null);
        setShowLoginPrompt(false);
        setLoginPromptMessage(null);
        // Execute after state updates
        setTimeout(action, 0);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [pendingAction]);

  // Register new user
  const register = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiRegister(email, password);
      setUser(response.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Logout
  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
    setError(null);
  }, []);

  // Refresh user data
  const refreshUser = useCallback(async () => {
    if (!getStoredToken()) return;

    try {
      const userData = await getCurrentUser();
      setUser(userData);
    } catch (err) {
      console.error('Failed to refresh user:', err);
    }
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // OAuth login
  const loginWithOAuth = useCallback(async (provider: OAuthProvider) => {
    // In Electron, open OAuth in external browser
    if (isElectron) {
      const handled = await openOAuthExternal(provider);
      if (handled) {
        // Show message that user should complete login in browser
        // and then copy the token from the web app
        setError('Please complete login in your browser. After logging in at studio.humanizer.com, copy your auth token from Settings to use cloud features in the desktop app.');
        return;
      }
    }
    // Normal web flow
    window.location.href = getOAuthLoginUrl(provider);
  }, []);

  // Require authentication - returns true if already authenticated
  // If not authenticated, shows login prompt and returns false
  const requireAuth = useCallback((message?: string, onSuccess?: () => void): boolean => {
    if (user) {
      return true;
    }

    // Not authenticated - show login prompt
    setLoginPromptMessage(message || 'Please log in to continue');
    setPendingAction(onSuccess ? () => onSuccess : null);
    setShowLoginPrompt(true);
    return false;
  }, [user]);

  // Dismiss login prompt
  const dismissLoginPrompt = useCallback(() => {
    setShowLoginPrompt(false);
    setLoginPromptMessage(null);
    setPendingAction(null);
  }, []);

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    error,

    showLoginPrompt,
    loginPromptMessage,
    pendingAction,

    login,
    register,
    logout,
    refreshUser,
    clearError,
    loginWithOAuth,

    requireAuth,
    dismissLoginPrompt,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Optional hook for components that may be outside auth context
export function useAuthOptional(): AuthContextType | null {
  return useContext(AuthContext);
}

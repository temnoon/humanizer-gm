/**
 * Auth Module
 *
 * Public exports for authentication
 */

export * from './types';
export * from './api';
export { AuthProvider, useAuth, useAuthOptional } from './AuthContext';
export { useAuthenticatedFetch, type AuthFetchOptions, type AuthFetchResult } from './useAuthenticatedFetch';

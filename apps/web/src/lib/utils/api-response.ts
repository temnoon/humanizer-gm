/**
 * API Response Utilities
 *
 * Helpers for handling API responses with explicit fallback warnings.
 * Per FALLBACK POLICY: Silent fallbacks are FORBIDDEN.
 * These utilities ensure fallbacks are logged for debugging.
 */

/**
 * Get array from API response with warning if missing.
 * Use for display data where empty array is acceptable but should be logged.
 *
 * @param data - The API response data object
 * @param field - The field name to extract
 * @param context - Context string for logging (e.g., component or function name)
 * @returns The array value or empty array with warning
 *
 * @example
 * const results = getArrayOrWarn(data, 'results', 'search_archive');
 */
export function getArrayOrWarn<T>(
  data: Record<string, unknown> | null | undefined,
  field: string,
  context: string
): T[] {
  if (!data) {
    console.warn(`[${context}] API response is null/undefined, expected '${field}' array`);
    return [];
  }

  const value = data[field];

  if (value === undefined) {
    console.warn(`[${context}] API response missing '${field}' field`);
    return [];
  }

  if (!Array.isArray(value)) {
    console.warn(`[${context}] API response '${field}' is not an array:`, typeof value);
    return [];
  }

  return value as T[];
}

/**
 * Get optional array from object property with warning if missing.
 * Use for accessing optional properties on existing objects.
 *
 * @param obj - The object to access
 * @param field - The field name to extract
 * @param context - Context string for logging
 * @returns The array value or empty array with warning
 */
export function getOptionalArrayOrWarn<T>(
  obj: Record<string, unknown> | null | undefined,
  field: string,
  context: string
): T[] {
  if (!obj) {
    // Object itself is null/undefined - this is expected in optional chaining
    return [];
  }

  const value = obj[field];

  if (value === undefined || value === null) {
    // Optional field not present - only warn in dev for debugging
    if (import.meta.env.DEV) {
      console.debug(`[${context}] Object missing optional '${field}' field`);
    }
    return [];
  }

  if (!Array.isArray(value)) {
    console.warn(`[${context}] Object '${field}' is not an array:`, typeof value);
    return [];
  }

  return value as T[];
}

/**
 * Validation Middleware for Book Studio Server
 *
 * Provides request validation utilities using Zod schemas.
 * Used by API routes to validate incoming request data.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodSchema, ZodError } from 'zod';

// ============================================================================
// Types
// ============================================================================

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationResult {
  success: boolean;
  errors?: ValidationError[];
  data?: unknown;
}

// ============================================================================
// Validation Middleware Factory
// ============================================================================

/**
 * Create middleware that validates request body against a Zod schema
 */
export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
      });
    }

    // Replace body with parsed/transformed data
    req.body = result.data;
    next();
  };
}

/**
 * Create middleware that validates request query against a Zod schema
 */
export function validateQuery<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
      });
    }

    // Replace query with parsed/transformed data
    req.query = result.data as Record<string, string | string[]>;
    next();
  };
}

/**
 * Create middleware that validates request params against a Zod schema
 */
export function validateParams<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
      });
    }

    // Replace params with parsed/transformed data
    req.params = result.data as Record<string, string>;
    next();
  };
}

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Format Zod errors into a consistent structure
 */
export function formatZodErrors(error: ZodError): ValidationError[] {
  return error.errors.map((err) => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code,
  }));
}

// ============================================================================
// Common Schemas
// ============================================================================

/**
 * Common ID parameter schema
 */
export const IdParamSchema = z.object({
  id: z.string().min(1, 'ID is required'),
});

/**
 * Book ID parameter schema
 */
export const BookIdParamSchema = z.object({
  bookId: z.string().min(1, 'Book ID is required'),
});

/**
 * Chapter ID parameter schema
 */
export const ChapterIdParamSchema = z.object({
  chapterId: z.string().min(1, 'Chapter ID is required'),
});

/**
 * Pagination query schema
 */
export const PaginationQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().min(1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().min(1).max(100)),
});

/**
 * UUID validation
 */
export const UUIDSchema = z.string().uuid('Invalid UUID format');

/**
 * Non-empty string
 */
export const NonEmptyStringSchema = z.string().min(1, 'String cannot be empty');

/**
 * Content sanitization schema (removes control characters)
 */
export const SanitizedContentSchema = z.string().transform((val) => {
  // Remove control characters except newlines and tabs
  return val.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate data against a schema and return typed result
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): ValidationResult & { data?: T } {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    errors: formatZodErrors(result.error),
  };
}

/**
 * Create a schema that requires at least one field to be present
 */
export function atLeastOne<T extends z.ZodRawShape>(schema: z.ZodObject<T>): z.ZodEffects<z.ZodObject<T>> {
  return schema.refine(
    (data) => Object.values(data).some((val) => val !== undefined),
    { message: 'At least one field must be provided' }
  );
}

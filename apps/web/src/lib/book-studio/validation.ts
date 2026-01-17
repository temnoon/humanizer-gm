/**
 * Book Studio Validation Schemas
 *
 * Zod schemas for input validation across all Book Studio operations.
 * Security: Prevents injection attacks, enforces bounds, validates enums.
 */

import { z } from 'zod'

// ============================================================================
// Shared Enums
// ============================================================================

export const SourceTypeEnum = z.enum([
  'message',
  'post',
  'comment',
  'document',
  'note',
  'image',
  'other'
])

export const CardStatusEnum = z.enum(['staging', 'placed', 'archived'])

export const ContentOriginEnum = z.enum(['original', 'reference'])

export const StubClassificationEnum = z.enum([
  'stub-sentence',
  'stub-reference',
  'stub-media',
  'stub-note',
  'stub-breadcrumb',
  'optimal'
])

export const OutlineTypeEnum = z.enum([
  'numbered',
  'bulleted',
  'chapter-list',
  'conversational'
])

export const TemporalStatusEnum = z.enum(['exact', 'inferred', 'unknown'])

// ============================================================================
// Book Schemas
// ============================================================================

export const BookCreateSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title too long'),
  description: z.string().max(2000, 'Description too long').optional(),
  targetWordCount: z.number().int().min(0).max(10000000).optional(),
})

export const BookUpdateSchema = BookCreateSchema.partial()

// ============================================================================
// Card Schemas
// ============================================================================

export const CardCreateSchema = z.object({
  content: z.string()
    .min(1, 'Content is required')
    .max(50000, 'Content exceeds 50KB limit'),
  title: z.string().max(255, 'Title too long').optional(),
  sourceType: SourceTypeEnum,
  source: z.string().max(500, 'Source name too long'),
  sourceUrl: z.string().url('Invalid URL').max(2000).optional().or(z.literal('')),
  tags: z.array(
    z.string().max(50, 'Tag too long')
  ).max(20, 'Too many tags').default([]),
  userNotes: z.string().max(2000, 'Notes too long').optional(),
  contentOrigin: ContentOriginEnum.optional().default('original'),
})

export const CardUpdateSchema = z.object({
  content: z.string()
    .min(1, 'Content is required')
    .max(50000, 'Content exceeds 50KB limit')
    .optional(),
  title: z.string().max(255, 'Title too long').optional(),
  tags: z.array(
    z.string().max(50, 'Tag too long')
  ).max(20, 'Too many tags').optional(),
  userNotes: z.string().max(2000, 'Notes too long').optional(),
  status: CardStatusEnum.optional(),
  suggestedChapterId: z.string().uuid('Invalid chapter ID').optional().nullable(),
})

// ============================================================================
// Chapter Schemas
// ============================================================================

export const ChapterCreateSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(255, 'Title too long'),
  order: z.number().int().min(0, 'Order must be non-negative'),
  draftInstructions: z.string().max(5000, 'Instructions too long').optional(),
})

export const ChapterUpdateSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(255, 'Title too long')
    .optional(),
  order: z.number().int().min(0).optional(),
  content: z.string().max(500000, 'Content exceeds 500KB limit').optional(),
  draftInstructions: z.string().max(5000, 'Instructions too long').optional(),
})

export const ChapterBatchCreateSchema = z.object({
  chapters: z.array(ChapterCreateSchema).min(1).max(100),
})

// ============================================================================
// Search Schemas
// ============================================================================

export const SearchInputSchema = z.object({
  query: z.string()
    .min(1, 'Search query required')
    .max(1000, 'Query too long'),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  filters: z.object({
    sourceTypes: z.array(SourceTypeEnum).optional(),
    sources: z.array(z.string().max(100)).max(20).optional(),
    dateRange: z.object({
      start: z.number().int().optional(),
      end: z.number().int().optional(),
    }).optional(),
    contentOrigin: ContentOriginEnum.optional(),
    excludeIds: z.array(z.string()).max(500).optional(),
  }).optional(),
})

// ============================================================================
// Outline Schemas
// ============================================================================

// Recursive outline item schema
export const OutlineItemSchema: z.ZodType<{
  level: number
  text: string
  children?: Array<{ level: number; text: string; children?: unknown[] }>
}> = z.lazy(() =>
  z.object({
    level: z.number().int().min(0).max(5, 'Max outline depth is 5'),
    text: z.string()
      .min(1, 'Outline item text required')
      .max(500, 'Outline item text too long'),
    children: z.array(OutlineItemSchema).optional(),
  })
)

export const OutlineStructureSchema = z.object({
  type: OutlineTypeEnum,
  items: z.array(OutlineItemSchema).min(1, 'Outline must have at least one item'),
  depth: z.number().int().min(1).max(6),
  confidence: z.number().min(0).max(1),
})

export const OutlineInputSchema = z.object({
  proposedOutline: OutlineStructureSchema.optional(),
  generateFromCards: z.boolean().default(false),
  cardIds: z.array(z.string()).optional(),
  preferences: z.object({
    maxDepth: z.number().int().min(1).max(6).default(3),
    style: OutlineTypeEnum.optional(),
    targetSections: z.number().int().min(1).max(50).default(10),
  }).optional(),
})

// ============================================================================
// Draft Generation Schemas
// ============================================================================

export const DraftGenerateSchema = z.object({
  chapterId: z.string().uuid('Invalid chapter ID'),
  cardIds: z.array(z.string()).min(1, 'At least one card required'),
  instructions: z.string().max(5000, 'Instructions too long').optional(),
  outline: OutlineStructureSchema.optional(),
  options: z.object({
    preserveKeyPassages: z.boolean().default(true),
    targetWordCount: z.number().int().min(100).max(100000).optional(),
    tone: z.enum(['formal', 'conversational', 'narrative', 'academic']).optional(),
  }).optional(),
})

// ============================================================================
// Clustering Schemas
// ============================================================================

export const ClusterCreateSchema = z.object({
  name: z.string()
    .min(1, 'Cluster name required')
    .max(100, 'Cluster name too long'),
  cardIds: z.array(z.string()).default([]),
  locked: z.boolean().default(false),
})

export const ClusterUpdateSchema = z.object({
  name: z.string()
    .min(1, 'Cluster name required')
    .max(100, 'Cluster name too long')
    .optional(),
  cardIds: z.array(z.string()).optional(),
  locked: z.boolean().optional(),
})

// ============================================================================
// WebSocket Message Schemas
// ============================================================================

export const WSMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    bookId: z.string().uuid('Invalid book ID'),
  }),
  z.object({
    type: z.literal('unsubscribe'),
    bookId: z.string().uuid('Invalid book ID'),
  }),
  z.object({
    type: z.literal('ping'),
  }),
])

// ============================================================================
// Temporal Field Utilities
// ============================================================================

/**
 * Check if a date represents epoch zero or is invalid
 */
export function isZeroDate(date: number | string | null | undefined): boolean {
  if (date === null || date === undefined) return true

  const ts = typeof date === 'number'
    ? date * 1000 // Convert Unix seconds to ms
    : new Date(date).getTime()

  if (isNaN(ts)) return true

  // Epoch zero ± 1 day (86400000ms)
  return Math.abs(ts) < 86400000
}

/**
 * Normalize a date to Unix seconds with status
 */
export function normalizeDate(date: string | number | null | undefined): {
  value: number | null
  status: 'exact' | 'inferred' | 'unknown'
} {
  if (isZeroDate(date)) {
    return { value: null, status: 'unknown' }
  }

  const ts = typeof date === 'number'
    ? date
    : Math.floor(new Date(date!).getTime() / 1000)

  return { value: ts, status: 'exact' }
}

// ============================================================================
// Export Types
// ============================================================================

export type BookCreateInput = z.infer<typeof BookCreateSchema>
export type BookUpdateInput = z.infer<typeof BookUpdateSchema>
export type CardCreateInput = z.infer<typeof CardCreateSchema>
export type CardUpdateInput = z.infer<typeof CardUpdateSchema>
export type ChapterCreateInput = z.infer<typeof ChapterCreateSchema>
export type ChapterUpdateInput = z.infer<typeof ChapterUpdateSchema>
export type ChapterBatchCreateInput = z.infer<typeof ChapterBatchCreateSchema>
export type SearchInput = z.infer<typeof SearchInputSchema>
export type OutlineInput = z.infer<typeof OutlineInputSchema>
export type DraftGenerateInput = z.infer<typeof DraftGenerateSchema>
export type ClusterCreateInput = z.infer<typeof ClusterCreateSchema>
export type ClusterUpdateInput = z.infer<typeof ClusterUpdateSchema>
export type WSMessage = z.infer<typeof WSMessageSchema>

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate input and return typed result or throw
 */
export function validateOrThrow<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const errors = result.error.issues.map((e: z.ZodIssue) =>
      `${e.path.join('.')}: ${e.message}`
    ).join(', ')
    throw new Error(`Validation failed${context ? ` (${context})` : ''}: ${errors}`)
  }
  return result.data
}

/**
 * Validate input and return result object
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data)
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((e: z.ZodIssue) =>
        `${e.path.join('.')}: ${e.message}`
      ),
    }
  }
  return { success: true, data: result.data }
}

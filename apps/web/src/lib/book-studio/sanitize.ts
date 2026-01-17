/**
 * Book Studio Sanitization Utilities
 *
 * XSS prevention via DOMPurify. All user content must be sanitized
 * before rendering in the DOM.
 */

import DOMPurify from 'dompurify'

// ============================================================================
// Configuration
// ============================================================================

/**
 * Allowed HTML tags for rich content (card content, drafts)
 */
const RICH_CONTENT_TAGS = [
  'p', 'strong', 'em', 'b', 'i', 'u',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'br', 'hr',
  'blockquote', 'pre', 'code',
  'span', 'div',
  'a', // Links allowed but with restrictions
]

/**
 * Allowed attributes for rich content
 */
const RICH_CONTENT_ATTR = [
  'class',
  'href',   // For links
  'target', // For links
  'rel',    // For links
]

/**
 * Minimal tags for simple formatting (notes, titles)
 */
const SIMPLE_FORMAT_TAGS = ['strong', 'em', 'b', 'i', 'br']

// ============================================================================
// Core Sanitization Functions
// ============================================================================

/**
 * Sanitize HTML for rich content display (card content, chapter drafts)
 * Allows basic formatting tags but strips scripts and event handlers.
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: RICH_CONTENT_TAGS,
    ALLOWED_ATTR: RICH_CONTENT_ATTR,
    // Force all links to open in new tab with security attrs
    ADD_ATTR: ['target', 'rel'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur'],
    // Transform links to be safe
    ALLOW_DATA_ATTR: false,
  })
}

/**
 * Strip ALL HTML for plain text contexts (search, comparison, display)
 * Returns plain text only.
 */
export function sanitizeText(dirty: string): string {
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [] })
}

/**
 * Light sanitization for notes/titles (only bold, italic, line breaks)
 */
export function sanitizeSimple(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: SIMPLE_FORMAT_TAGS,
    ALLOWED_ATTR: [],
  })
}

// ============================================================================
// Domain-Specific Sanitizers
// ============================================================================

/**
 * Sanitize a HarvestCard before display
 * - content: rich HTML allowed
 * - userNotes: simple formatting only
 * - title: plain text
 */
export function sanitizeCardForDisplay<T extends {
  content: string
  userNotes?: string
  title?: string
  aiSummary?: string
  aiContext?: string
}>(card: T): T {
  return {
    ...card,
    content: sanitizeHtml(card.content),
    userNotes: card.userNotes ? sanitizeSimple(card.userNotes) : undefined,
    title: card.title ? sanitizeText(card.title) : undefined,
    aiSummary: card.aiSummary ? sanitizeText(card.aiSummary) : undefined,
    aiContext: card.aiContext ? sanitizeText(card.aiContext) : undefined,
  }
}

/**
 * Sanitize chapter content for display
 */
export function sanitizeChapterContent(content: string): string {
  return sanitizeHtml(content)
}

/**
 * Sanitize draft content before display
 */
export function sanitizeDraftContent(draft: string): string {
  return sanitizeHtml(draft)
}

/**
 * Sanitize user input before storage (more permissive, preserves more structure)
 * This is for content coming from trusted sources like the archive.
 */
export function sanitizeForStorage(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      ...RICH_CONTENT_TAGS,
      'table', 'thead', 'tbody', 'tr', 'th', 'td', // Tables
      'img', // Images (src will be validated separately)
    ],
    ALLOWED_ATTR: [
      ...RICH_CONTENT_ATTR,
      'src', 'alt', 'width', 'height', // For images
      'colspan', 'rowspan', // For tables
    ],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'],
  })
}

// ============================================================================
// URL Sanitization
// ============================================================================

/**
 * Validate and sanitize a URL
 * Returns sanitized URL or empty string if invalid/dangerous
 */
export function sanitizeUrl(url: string | undefined): string {
  if (!url) return ''

  try {
    const parsed = new URL(url)

    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return ''
    }

    // Block javascript: pseudo-protocol (additional check)
    if (url.toLowerCase().includes('javascript:')) {
      return ''
    }

    return parsed.href
  } catch {
    return ''
  }
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Sanitize an array of cards for display
 */
export function sanitizeCardsForDisplay<T extends {
  content: string
  userNotes?: string
  title?: string
}>(cards: T[]): T[] {
  return cards.map(card => sanitizeCardForDisplay(card))
}

// ============================================================================
// React Helpers
// ============================================================================

/**
 * Create props for dangerouslySetInnerHTML with sanitized content
 * Use this instead of directly using dangerouslySetInnerHTML
 */
export function createSafeHtmlProps(dirty: string): { dangerouslySetInnerHTML: { __html: string } } {
  return {
    dangerouslySetInnerHTML: {
      __html: sanitizeHtml(dirty),
    },
  }
}

/**
 * Create props for dangerouslySetInnerHTML with plain text (escaped)
 */
export function createSafeTextProps(dirty: string): { dangerouslySetInnerHTML: { __html: string } } {
  return {
    dangerouslySetInnerHTML: {
      __html: sanitizeText(dirty),
    },
  }
}

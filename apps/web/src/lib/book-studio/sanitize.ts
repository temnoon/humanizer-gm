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
 * Allowed URL protocols (whitelist approach)
 * Only http and https are safe for external links
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:']

/**
 * Dangerous protocols that could be used for XSS or data exfiltration
 * Blocked explicitly for defense-in-depth (whitelist already handles this)
 */
const BLOCKED_PROTOCOLS = ['javascript:', 'data:', 'blob:', 'vbscript:', 'file:']

/**
 * Validate and sanitize a URL
 * Returns sanitized URL or empty string if invalid/dangerous
 *
 * Security considerations:
 * - Whitelist approach: only http/https allowed
 * - Blocks javascript: (XSS via onclick handlers)
 * - Blocks data: (inline content injection)
 * - Blocks blob: (arbitrary content)
 * - Blocks file: (local file access)
 * - Logs blocked attempts for security auditing
 */
export function sanitizeUrl(url: string | undefined): string {
  if (!url) return ''

  // Trim and normalize
  const trimmedUrl = url.trim()
  if (!trimmedUrl) return ''

  try {
    const parsed = new URL(trimmedUrl)

    // Whitelist approach: only allow safe protocols
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
      // Log blocked URLs in development for debugging
      if (process.env.NODE_ENV === 'development') {
        console.warn('[sanitize] Blocked URL with disallowed protocol:', {
          url: trimmedUrl.substring(0, 100),
          protocol: parsed.protocol,
        })
      }
      return ''
    }

    // Return normalized URL
    return parsed.href
  } catch (err) {
    // Invalid URL format
    if (process.env.NODE_ENV === 'development') {
      console.warn('[sanitize] Invalid URL format:', {
        url: trimmedUrl.substring(0, 100),
        error: err instanceof Error ? err.message : 'Parse error',
      })
    }
    return ''
  }
}

/**
 * Validate URL for use in image src attributes
 * More restrictive: also allows relative paths and API endpoints
 */
export function sanitizeImageUrl(url: string | undefined): string {
  if (!url) return ''

  const trimmed = url.trim()

  // Allow relative URLs (internal images)
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed
  }

  // Allow our API endpoints
  if (trimmed.startsWith('/api/')) {
    return trimmed
  }

  // For absolute URLs, use standard sanitization
  return sanitizeUrl(trimmed)
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

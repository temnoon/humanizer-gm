/**
 * Content Sanitization
 *
 * XSS protection for user-generated and AI-generated content.
 * Uses DOMPurify with a strict allowlist approach.
 */

import DOMPurify from 'dompurify';

// Configure DOMPurify for markdown-safe HTML
const ALLOWED_TAGS = [
  // Text formatting
  'p', 'br', 'span', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark',
  'sub', 'sup', 'small',
  // Headings
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // Lists
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // Quotes & code
  'blockquote', 'pre', 'code', 'kbd', 'samp', 'var',
  // Links & media (no scripts)
  'a', 'img', 'figure', 'figcaption',
  // Structure
  'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
  'hr', 'details', 'summary',
  // Math (for KaTeX)
  'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace',
  'msup', 'msub', 'msubsup', 'munder', 'mover', 'munderover', 'mfrac',
  'mroot', 'msqrt', 'mtable', 'mtr', 'mtd', 'mlabeledtr', 'menclose',
  'mfenced', 'mmultiscripts', 'mprescripts', 'none', 'annotation',
  'annotation-xml',
];

const ALLOWED_ATTR = [
  // Common
  'class', 'id', 'title', 'lang', 'dir',
  // Links
  'href', 'target', 'rel',
  // Images
  'src', 'alt', 'width', 'height', 'loading',
  // Tables
  'colspan', 'rowspan', 'scope', 'headers',
  // Math
  'mathvariant', 'displaystyle', 'xmlns', 'encoding',
  // Accessibility
  'role', 'aria-label', 'aria-hidden', 'aria-describedby',
  // Data attributes (safe)
  'data-*',
];

// URLs that are safe
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel|data):)/i;

/**
 * Sanitize HTML content, removing potential XSS vectors
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    KEEP_CONTENT: true, // Keep text content of removed elements
  });
}

/**
 * Sanitize plain text (for non-markdown contexts)
 * Escapes HTML entities to prevent injection
 */
export function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
  };
  return text.replace(/[&<>"'`=/]/g, (char) => htmlEntities[char]);
}

/**
 * Sanitize markdown content before rendering
 * Preserves markdown syntax while removing dangerous HTML
 */
export function sanitizeMarkdown(markdown: string): string {
  // First pass: identify and protect code blocks
  const codeBlocks: string[] = [];
  let protectedMd = markdown.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // Sanitize any raw HTML in the markdown
  protectedMd = DOMPurify.sanitize(protectedMd, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    KEEP_CONTENT: true,
    // Allow markdown syntax characters
    ALLOWED_URI_REGEXP,
  });

  // Restore code blocks
  protectedMd = protectedMd.replace(/__CODE_BLOCK_(\d+)__/g, (_match, index) => {
    return codeBlocks[parseInt(index, 10)];
  });

  return protectedMd;
}

/**
 * Check if content contains potentially dangerous patterns
 */
export function hasUnsafeContent(content: string): boolean {
  const unsafePatterns = [
    /<script\b/i,
    /javascript:/i,
    /on\w+\s*=/i,  // onclick, onerror, etc.
    /data:text\/html/i,
    /<iframe\b/i,
    /<object\b/i,
    /<embed\b/i,
    /<form\b/i,
  ];

  return unsafePatterns.some((pattern) => pattern.test(content));
}

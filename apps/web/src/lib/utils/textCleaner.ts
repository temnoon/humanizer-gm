/**
 * Text Cleaner Utility
 *
 * Cleans HTML/XML content from notes and other rich text sources.
 * Converts to plain text while preserving paragraph structure.
 */

/**
 * Normalize whitespace in text:
 * - Collapse multiple spaces/tabs to single space
 * - Collapse multiple blank lines to single blank line (one \n\n max)
 * - Trim lines
 */
function normalizeWhitespace(text: string): string {
  if (!text) return '';

  let result = text;

  // Normalize line endings
  result = result.replace(/\r\n/g, '\n');
  result = result.replace(/\r/g, '\n');

  // Replace tabs with spaces
  result = result.replace(/\t/g, ' ');

  // Collapse multiple spaces to single space (but not newlines)
  result = result.replace(/ {2,}/g, ' ');

  // Trim whitespace from start/end of each line
  result = result.replace(/^ +/gm, '');  // Leading spaces on each line
  result = result.replace(/ +$/gm, '');  // Trailing spaces on each line

  // Collapse multiple blank lines to single blank line
  // This handles: \n\n\n -> \n\n, \n \n \n -> \n\n, etc.
  result = result.replace(/\n\s*\n\s*\n/g, '\n\n');
  // Run again to catch remaining cases
  result = result.replace(/\n\s*\n\s*\n/g, '\n\n');

  return result.trim();
}

/**
 * Clean HTML/XML content and convert to readable plain text
 * - Converts <p>, <br>, </div> to newlines
 * - Strips all HTML/XML tags
 * - Decodes HTML entities
 * - Normalizes whitespace while preserving paragraph breaks
 */
export function cleanHtmlToText(html: string): string {
  if (!html) return '';

  let text = html;

  // Convert block elements to double newlines (paragraph breaks)
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/blockquote>/gi, '\n\n');

  // Convert <br> to single newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Convert list markers
  text = text.replace(/<li>/gi, '• ');

  // Remove all remaining HTML/XML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/&apos;/gi, "'");
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  text = text.replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  // Normalize whitespace
  return normalizeWhitespace(text);
}

/**
 * Check if a string contains HTML/XML tags
 */
export function containsHtml(text: string): boolean {
  if (!text) return false;
  return /<[a-zA-Z][\s\S]*?>/.test(text);
}

/**
 * Format text for display, cleaning HTML if present
 * Returns the text cleaned and ready for display with proper line breaks
 */
export function formatTextForDisplay(text: string): string {
  if (!text) return '';

  // If it contains HTML, clean it
  if (containsHtml(text)) {
    return cleanHtmlToText(text);
  }

  // Otherwise normalize whitespace (collapse multiple blank lines, etc.)
  return normalizeWhitespace(text);
}

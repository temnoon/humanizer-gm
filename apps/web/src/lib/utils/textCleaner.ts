/**
 * Text Cleaner Utility
 *
 * Cleans HTML/XML content from notes and other rich text sources.
 * Converts to plain text while preserving paragraph structure.
 */

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

  // Normalize whitespace:
  // - Convert multiple spaces to single space
  // - Preserve newlines but collapse multiple blank lines to max 2
  text = text.replace(/[ \t]+/g, ' ');  // Multiple spaces/tabs to single space
  text = text.replace(/\n[ \t]+/g, '\n');  // Remove leading whitespace on lines
  text = text.replace(/[ \t]+\n/g, '\n');  // Remove trailing whitespace on lines
  text = text.replace(/\n{3,}/g, '\n\n');  // Collapse 3+ newlines to 2

  return text.trim();
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

  // Otherwise just normalize whitespace
  return text
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\r/g, '\n')
    .trim();
}

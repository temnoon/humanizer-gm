/**
 * ContentAnalyzer - Content Type Detection for Chunking
 *
 * Detects content types (prose, code, math, tables) in text using regex patterns.
 * Returns segments with type, content, and position information.
 *
 * Part of Phase 5: Content-Type Aware Chunking (Xanadu unified storage project)
 */

// =============================================================================
// Types
// =============================================================================

export type ContentType = 'prose' | 'code' | 'math' | 'table' | 'list' | 'heading';

export interface ContentSegment {
  type: ContentType;
  content: string;
  startOffset: number;
  endOffset: number;
  language?: string;  // For code: 'python', 'typescript', etc.
}

interface DetectedRegion {
  type: ContentType;
  start: number;
  end: number;
  language?: string;
}

// =============================================================================
// Detection Patterns
// =============================================================================

// Fenced code blocks: ```language\n...\n```
const FENCED_CODE_REGEX = /^```(\w*)\n([\s\S]*?)^```$/gm;

// Indented code blocks: 4+ spaces or tab at start of line
const INDENTED_CODE_REGEX = /^(?:[ ]{4}|\t).+$/gm;

// Display math: $$...$$ or \[...\]
const DISPLAY_MATH_REGEX = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]/g;

// Inline math: $...$ (not $$) or \(...\)
const INLINE_MATH_REGEX = /(?<!\$)\$(?!\$)[^$\n]+\$(?!\$)|\\\([^)]+\\\)/g;

// LaTeX environments: \begin{env}...\end{env}
const LATEX_ENV_REGEX = /\\begin\{(\w+)\}[\s\S]*?\\end\{\1\}/g;

// Markdown tables: lines starting and ending with |
const TABLE_ROW_REGEX = /^\|.+\|$/gm;

// Markdown headings: # at start of line
const HEADING_REGEX = /^#{1,6}\s+.+$/gm;

// Lists: lines starting with - * + or numbers
const LIST_ITEM_REGEX = /^[\t ]*[-*+]\s+.+$|^[\t ]*\d+\.\s+.+$/gm;

// =============================================================================
// ContentAnalyzer Class
// =============================================================================

export class ContentAnalyzer {
  /**
   * Analyze text and return typed segments
   */
  analyze(text: string): ContentSegment[] {
    // Detect all special regions
    const regions: DetectedRegion[] = [];

    // Detect fenced code blocks (highest priority)
    regions.push(...this.detectFencedCode(text));

    // Detect display math
    regions.push(...this.detectDisplayMath(text));

    // Detect LaTeX environments
    regions.push(...this.detectLatexEnvironments(text));

    // Detect tables (multi-line regions)
    regions.push(...this.detectTables(text));

    // Detect headings
    regions.push(...this.detectHeadings(text));

    // Detect lists
    regions.push(...this.detectLists(text));

    // Sort by start position
    regions.sort((a, b) => a.start - b.start);

    // Merge overlapping regions (earlier detections win)
    const merged = this.mergeOverlapping(regions);

    // Fill gaps with prose
    const segments = this.fillWithProse(text, merged);

    return segments;
  }

  /**
   * Detect fenced code blocks
   */
  private detectFencedCode(text: string): DetectedRegion[] {
    const regions: DetectedRegion[] = [];
    let match: RegExpExecArray | null;

    // Reset regex state
    FENCED_CODE_REGEX.lastIndex = 0;

    while ((match = FENCED_CODE_REGEX.exec(text)) !== null) {
      regions.push({
        type: 'code',
        start: match.index,
        end: match.index + match[0].length,
        language: match[1] || undefined,
      });
    }

    return regions;
  }

  /**
   * Detect display math ($$...$$ or \[...\])
   */
  private detectDisplayMath(text: string): DetectedRegion[] {
    const regions: DetectedRegion[] = [];
    let match: RegExpExecArray | null;

    DISPLAY_MATH_REGEX.lastIndex = 0;

    while ((match = DISPLAY_MATH_REGEX.exec(text)) !== null) {
      regions.push({
        type: 'math',
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return regions;
  }

  /**
   * Detect LaTeX environments
   */
  private detectLatexEnvironments(text: string): DetectedRegion[] {
    const regions: DetectedRegion[] = [];
    let match: RegExpExecArray | null;

    LATEX_ENV_REGEX.lastIndex = 0;

    while ((match = LATEX_ENV_REGEX.exec(text)) !== null) {
      regions.push({
        type: 'math',
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return regions;
  }

  /**
   * Detect markdown tables (consecutive | rows)
   */
  private detectTables(text: string): DetectedRegion[] {
    const regions: DetectedRegion[] = [];
    const lines = text.split('\n');
    let tableStart: number | null = null;
    let tableEnd: number | null = null;
    let currentOffset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineStart = currentOffset;
      const lineEnd = currentOffset + line.length;

      const isTableRow = /^\|.+\|$/.test(line.trim());

      if (isTableRow) {
        if (tableStart === null) {
          tableStart = lineStart;
        }
        tableEnd = lineEnd;
      } else {
        // End of table region
        if (tableStart !== null && tableEnd !== null) {
          // Only count as table if at least 2 rows (header + separator or data)
          const tableContent = text.slice(tableStart, tableEnd);
          const rowCount = tableContent.split('\n').filter(r => r.trim().startsWith('|')).length;
          if (rowCount >= 2) {
            regions.push({
              type: 'table',
              start: tableStart,
              end: tableEnd,
            });
          }
        }
        tableStart = null;
        tableEnd = null;
      }

      currentOffset = lineEnd + 1; // +1 for newline
    }

    // Handle table at end of text
    if (tableStart !== null && tableEnd !== null) {
      const tableContent = text.slice(tableStart, tableEnd);
      const rowCount = tableContent.split('\n').filter(r => r.trim().startsWith('|')).length;
      if (rowCount >= 2) {
        regions.push({
          type: 'table',
          start: tableStart,
          end: tableEnd,
        });
      }
    }

    return regions;
  }

  /**
   * Detect markdown headings
   */
  private detectHeadings(text: string): DetectedRegion[] {
    const regions: DetectedRegion[] = [];
    let match: RegExpExecArray | null;

    HEADING_REGEX.lastIndex = 0;

    while ((match = HEADING_REGEX.exec(text)) !== null) {
      regions.push({
        type: 'heading',
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return regions;
  }

  /**
   * Detect list items (consecutive list lines form a list region)
   */
  private detectLists(text: string): DetectedRegion[] {
    const regions: DetectedRegion[] = [];
    const lines = text.split('\n');
    let listStart: number | null = null;
    let listEnd: number | null = null;
    let currentOffset = 0;

    const listItemPattern = /^[\t ]*[-*+]\s+.+$|^[\t ]*\d+\.\s+.+$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineStart = currentOffset;
      const lineEnd = currentOffset + line.length;

      const isListItem = listItemPattern.test(line);

      if (isListItem) {
        if (listStart === null) {
          listStart = lineStart;
        }
        listEnd = lineEnd;
      } else if (line.trim() === '' && listStart !== null) {
        // Empty line might continue list - check next line
        // For now, end the list on empty line
        if (listStart !== null && listEnd !== null) {
          regions.push({
            type: 'list',
            start: listStart,
            end: listEnd,
          });
        }
        listStart = null;
        listEnd = null;
      } else {
        // Non-list, non-empty line
        if (listStart !== null && listEnd !== null) {
          regions.push({
            type: 'list',
            start: listStart,
            end: listEnd,
          });
        }
        listStart = null;
        listEnd = null;
      }

      currentOffset = lineEnd + 1;
    }

    // Handle list at end of text
    if (listStart !== null && listEnd !== null) {
      regions.push({
        type: 'list',
        start: listStart,
        end: listEnd,
      });
    }

    return regions;
  }

  /**
   * Merge overlapping regions (earlier detections win)
   */
  private mergeOverlapping(regions: DetectedRegion[]): DetectedRegion[] {
    if (regions.length === 0) return [];

    const merged: DetectedRegion[] = [];
    const sorted = [...regions].sort((a, b) => a.start - b.start);

    let current = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];

      if (next.start < current.end) {
        // Overlapping - keep the one with earlier start (already current)
        // Extend end if next extends further
        if (next.end > current.end) {
          current = { ...current, end: next.end };
        }
      } else {
        // No overlap, push current and move to next
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);
    return merged;
  }

  /**
   * Fill gaps between detected regions with prose segments
   */
  private fillWithProse(text: string, regions: DetectedRegion[]): ContentSegment[] {
    const segments: ContentSegment[] = [];
    let lastEnd = 0;

    for (const region of regions) {
      // Add prose segment for gap
      if (region.start > lastEnd) {
        const proseContent = text.slice(lastEnd, region.start);
        if (proseContent.trim().length > 0) {
          segments.push({
            type: 'prose',
            content: proseContent,
            startOffset: lastEnd,
            endOffset: region.start,
          });
        }
      }

      // Add the detected region
      segments.push({
        type: region.type,
        content: text.slice(region.start, region.end),
        startOffset: region.start,
        endOffset: region.end,
        language: region.language,
      });

      lastEnd = region.end;
    }

    // Add trailing prose
    if (lastEnd < text.length) {
      const proseContent = text.slice(lastEnd);
      if (proseContent.trim().length > 0) {
        segments.push({
          type: 'prose',
          content: proseContent,
          startOffset: lastEnd,
          endOffset: text.length,
        });
      }
    }

    // If no regions detected, entire text is prose
    if (segments.length === 0 && text.trim().length > 0) {
      segments.push({
        type: 'prose',
        content: text,
        startOffset: 0,
        endOffset: text.length,
      });
    }

    return segments;
  }

  /**
   * Check if text contains inline math (for prose chunking awareness)
   */
  hasInlineMath(text: string): boolean {
    INLINE_MATH_REGEX.lastIndex = 0;
    return INLINE_MATH_REGEX.test(text);
  }

  /**
   * Get inline math positions for sentence boundary adjustment
   */
  getInlineMathPositions(text: string): Array<{ start: number; end: number }> {
    const positions: Array<{ start: number; end: number }> = [];
    let match: RegExpExecArray | null;

    INLINE_MATH_REGEX.lastIndex = 0;

    while ((match = INLINE_MATH_REGEX.exec(text)) !== null) {
      positions.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return positions;
  }
}

// =============================================================================
// Exports
// =============================================================================

export default ContentAnalyzer;

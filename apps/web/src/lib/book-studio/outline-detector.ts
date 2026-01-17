/**
 * Outline Detection
 *
 * Detects structured outlines in content to enable "Create Chapters from Outline"
 * functionality. Supports:
 * - Numbered: 1., 1.1, I., A. with hierarchy
 * - Bulleted: -, *, • with indentation
 * - Chapter format: Chapter 1: Title, Part I - Name
 * - Conversational: "First... Second... Third... Finally..."
 */

import type { OutlineStructure, OutlineItem } from './types'

// ============================================================================
// Pattern Definitions
// ============================================================================

// Numbered patterns: 1. 1.1 1.1.1 I. II. A. B.
const NUMBERED_LINE = /^(\s*)(\d+(?:\.\d+)*\.?|[IVXLCDM]+\.|[A-Z]\.)\s+(.+)$/
const ROMAN_NUMERAL = /^[IVXLCDM]+$/
const LETTER_PATTERN = /^[A-Z]$/

// Bulleted patterns
const BULLETED_LINE = /^(\s*)([-*•]|\d+\))\s+(.+)$/

// Chapter patterns
const CHAPTER_LINE = /^(Chapter|Part|Section|Act)\s+([IVXLCDM]+|\d+)[:\s-]+(.*)$/i
const HEADING_LINE = /^#+\s+(.+)$/ // Markdown headings

// Conversational transitions
const CONVERSATIONAL_MARKERS = [
  /\b(first(ly)?|to begin|initially|starting with)\b/i,
  /\b(second(ly)?|next|then|after that)\b/i,
  /\b(third(ly)?|also|additionally|furthermore)\b/i,
  /\b(fourth(ly)?|moreover|in addition)\b/i,
  /\b(finally|lastly|in conclusion|to conclude)\b/i,
]

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Detect numbered outline (1. 1.1 I. A.)
 */
function detectNumberedOutline(content: string): OutlineStructure | null {
  const lines = content.split('\n')
  const items: OutlineItem[] = []
  let maxDepth = 0

  for (const line of lines) {
    const match = line.match(NUMBERED_LINE)
    if (!match) continue

    const [, indent, number, text] = match
    const indentLevel = Math.floor(indent.length / 2)

    // Determine level from numbering style
    let level = indentLevel
    if (number.includes('.')) {
      // Count dots to determine nesting level
      level = (number.match(/\./g) || []).length
    } else if (ROMAN_NUMERAL.test(number.replace('.', ''))) {
      level = 0 // Roman numerals typically top-level
    } else if (LETTER_PATTERN.test(number.replace('.', ''))) {
      level = 1 // Letters typically second-level
    }

    items.push({
      level,
      text: text.trim(),
    })

    maxDepth = Math.max(maxDepth, level)
  }

  if (items.length < 2) return null

  // Build hierarchy
  const hierarchicalItems = buildHierarchy(items)

  return {
    type: 'numbered',
    items: hierarchicalItems,
    depth: maxDepth + 1,
    confidence: calculateConfidence(items, lines.length),
  }
}

/**
 * Detect bulleted outline (- * •)
 */
function detectBulletedOutline(content: string): OutlineStructure | null {
  const lines = content.split('\n')
  const items: OutlineItem[] = []
  let maxDepth = 0

  for (const line of lines) {
    const match = line.match(BULLETED_LINE)
    if (!match) continue

    const [, indent, , text] = match
    const level = Math.floor(indent.length / 2)

    items.push({
      level,
      text: text.trim(),
    })

    maxDepth = Math.max(maxDepth, level)
  }

  if (items.length < 2) return null

  // Build hierarchy
  const hierarchicalItems = buildHierarchy(items)

  return {
    type: 'bulleted',
    items: hierarchicalItems,
    depth: maxDepth + 1,
    confidence: calculateConfidence(items, lines.length),
  }
}

/**
 * Detect chapter-based outline
 */
function detectChapterOutline(content: string): OutlineStructure | null {
  const lines = content.split('\n')
  const items: OutlineItem[] = []

  for (const line of lines) {
    // Check for chapter/part format
    const chapterMatch = line.match(CHAPTER_LINE)
    if (chapterMatch) {
      const [, type, number, title] = chapterMatch
      const level = type.toLowerCase() === 'part' ? 0 : 1

      items.push({
        level,
        text: title.trim() || `${type} ${number}`,
      })
      continue
    }

    // Check for markdown headings
    const headingMatch = line.match(HEADING_LINE)
    if (headingMatch) {
      const hashes = (line.match(/^#+/) || [''])[0].length
      items.push({
        level: hashes - 1,
        text: headingMatch[1].trim(),
      })
    }
  }

  if (items.length < 2) return null

  // Build hierarchy
  const hierarchicalItems = buildHierarchy(items)

  return {
    type: 'chapter-list',
    items: hierarchicalItems,
    depth: Math.max(...items.map(i => i.level)) + 1,
    confidence: items.length >= 3 ? 0.9 : 0.7,
  }
}

/**
 * Detect conversational outline (First... Second... Finally...)
 */
function detectConversationalOutline(content: string): OutlineStructure | null {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim())
  const items: OutlineItem[] = []
  const markedSentences: number[] = []

  // Find sentences with transitional markers
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]

    for (let m = 0; m < CONVERSATIONAL_MARKERS.length; m++) {
      if (CONVERSATIONAL_MARKERS[m].test(sentence)) {
        markedSentences.push(i)
        items.push({
          level: 0,
          text: sentence.trim().slice(0, 100) + (sentence.length > 100 ? '...' : ''),
        })
        break
      }
    }
  }

  // Need at least 3 markers for a conversational outline
  if (items.length < 3) return null

  // Check if markers are reasonably distributed
  const distribution = markedSentences[markedSentences.length - 1] - markedSentences[0]
  const avgGap = distribution / (markedSentences.length - 1)

  // If markers are too clustered, probably not an outline
  if (avgGap < 2) return null

  return {
    type: 'conversational',
    items,
    depth: 1,
    confidence: items.length >= 4 ? 0.8 : 0.6,
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build hierarchical structure from flat items
 */
function buildHierarchy(items: OutlineItem[]): OutlineItem[] {
  const root: OutlineItem[] = []
  const stack: Array<{ item: OutlineItem; level: number }> = []

  for (const item of items) {
    const newItem: OutlineItem = { ...item, children: [] }

    // Pop items from stack until we find a parent
    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop()
    }

    if (stack.length === 0) {
      // Top-level item
      root.push(newItem)
    } else {
      // Child of last item in stack
      const parent = stack[stack.length - 1].item
      if (!parent.children) parent.children = []
      parent.children.push(newItem)
    }

    stack.push({ item: newItem, level: item.level })
  }

  // Clean up empty children arrays
  const cleanChildren = (items: OutlineItem[]): OutlineItem[] => {
    return items.map(item => ({
      ...item,
      children: item.children && item.children.length > 0
        ? cleanChildren(item.children)
        : undefined,
    }))
  }

  return cleanChildren(root)
}

/**
 * Calculate confidence score for outline detection
 */
function calculateConfidence(items: OutlineItem[], totalLines: number): number {
  // More items = higher confidence (up to a point)
  const itemScore = Math.min(items.length / 5, 1)

  // Higher ratio of outline lines to total lines = higher confidence
  const ratioScore = Math.min(items.length / totalLines, 1)

  // Consistent indentation increases confidence
  const levels = items.map(i => i.level)
  const uniqueLevels = new Set(levels).size
  const levelScore = uniqueLevels <= 4 ? 1 : 0.8

  return (itemScore * 0.4 + ratioScore * 0.3 + levelScore * 0.3)
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Detect outline structure in content
 * Returns the best matching outline type, or null if no outline detected
 */
export function detectOutline(content: string): OutlineStructure | null {
  // Try each detection method
  const detectors = [
    detectChapterOutline,      // Most specific
    detectNumberedOutline,
    detectBulletedOutline,
    detectConversationalOutline, // Least specific
  ]

  let bestOutline: OutlineStructure | null = null
  let bestConfidence = 0

  for (const detect of detectors) {
    const outline = detect(content)
    if (outline && outline.confidence > bestConfidence) {
      bestOutline = outline
      bestConfidence = outline.confidence
    }
  }

  // Only return outlines with reasonable confidence
  if (bestOutline && bestOutline.confidence >= 0.5) {
    return bestOutline
  }

  return null
}

/**
 * Check if content is likely an outline (quick check)
 */
export function isLikelyOutline(content: string): boolean {
  const lines = content.split('\n').filter(l => l.trim())

  // Quick heuristics
  const numberedCount = lines.filter(l => NUMBERED_LINE.test(l)).length
  const bulletedCount = lines.filter(l => BULLETED_LINE.test(l)).length
  const chapterCount = lines.filter(l => CHAPTER_LINE.test(l) || HEADING_LINE.test(l)).length

  const maxCount = Math.max(numberedCount, bulletedCount, chapterCount)

  // If at least 30% of lines are outline-like, probably an outline
  return maxCount >= 3 && maxCount / lines.length >= 0.3
}

/**
 * Extract just the outline item texts (flattened)
 */
export function extractOutlineTexts(outline: OutlineStructure): string[] {
  const texts: string[] = []

  const extract = (items: OutlineItem[]) => {
    for (const item of items) {
      texts.push(item.text)
      if (item.children) {
        extract(item.children)
      }
    }
  }

  extract(outline.items)
  return texts
}

/**
 * Count total items in outline (including nested)
 */
export function countOutlineItems(outline: OutlineStructure): number {
  let count = 0

  const countItems = (items: OutlineItem[]) => {
    for (const item of items) {
      count++
      if (item.children) {
        countItems(item.children)
      }
    }
  }

  countItems(outline.items)
  return count
}

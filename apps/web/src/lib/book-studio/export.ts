/**
 * Book Studio Export - Markdown export functionality
 */

import type { Book, Chapter, HarvestCard } from './types'

// ============================================================================
// Chapter Export
// ============================================================================

/**
 * Export a single chapter as Markdown
 */
export function exportChapterToMarkdown(chapter: Chapter): string {
  const lines: string[] = []

  // Chapter title
  lines.push(`# ${chapter.title}`)
  lines.push('')

  // Content
  if (chapter.content) {
    lines.push(chapter.content)
    lines.push('')
  }

  // Word count footer
  lines.push('---')
  lines.push(`*Word count: ${chapter.wordCount}*`)

  return lines.join('\n')
}

// ============================================================================
// Book Export
// ============================================================================

interface BookExportOptions {
  includeFrontmatter?: boolean
  includeStagingCards?: boolean
  includeChapterCards?: boolean
}

/**
 * Export entire book as Markdown
 */
export function exportBookToMarkdown(
  book: Book,
  options: BookExportOptions = {}
): string {
  const {
    includeFrontmatter = true,
    includeStagingCards = false,
    includeChapterCards = true,
  } = options

  const lines: string[] = []

  // Frontmatter (YAML)
  if (includeFrontmatter) {
    lines.push('---')
    lines.push(`title: "${book.title}"`)
    lines.push(`created: ${book.createdAt}`)
    lines.push(`updated: ${book.updatedAt}`)
    if (book.targetWordCount) {
      lines.push(`target_words: ${book.targetWordCount}`)
    }
    lines.push('---')
    lines.push('')
  }

  // Book title
  lines.push(`# ${book.title}`)
  lines.push('')

  // Table of Contents
  if (book.chapters.length > 0) {
    lines.push('## Table of Contents')
    lines.push('')
    book.chapters
      .sort((a, b) => a.order - b.order)
      .forEach((chapter, idx) => {
        const anchor = chapter.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        lines.push(`${idx + 1}. [${chapter.title}](#${anchor})`)
      })
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  // Chapters
  book.chapters
    .sort((a, b) => a.order - b.order)
    .forEach((chapter) => {
      // Chapter heading
      lines.push(`## ${chapter.title}`)
      lines.push('')

      // Chapter content
      if (chapter.content) {
        lines.push(chapter.content)
        lines.push('')
      }

      // Chapter cards (source material)
      if (includeChapterCards && chapter.cards.length > 0) {
        const chapterCards = book.stagingCards.filter((c) =>
          chapter.cards.includes(c.id)
        )
        if (chapterCards.length > 0) {
          lines.push('### Source Material')
          lines.push('')
          chapterCards.forEach((card) => {
            lines.push(formatCardAsMarkdown(card))
            lines.push('')
          })
        }
      }

      lines.push('---')
      lines.push('')
    })

  // Staging cards (unused material)
  if (includeStagingCards) {
    const unplacedCards = book.stagingCards.filter((c) => c.status === 'staging')
    if (unplacedCards.length > 0) {
      lines.push('## Staging Area')
      lines.push('')
      lines.push('*Harvested content not yet placed in chapters:*')
      lines.push('')
      unplacedCards.forEach((card) => {
        lines.push(formatCardAsMarkdown(card))
        lines.push('')
      })
    }
  }

  // Stats footer
  const totalWords = book.chapters.reduce((sum, ch) => sum + ch.wordCount, 0)
  lines.push('---')
  lines.push('')
  lines.push(`*Total chapters: ${book.chapters.length}*`)
  lines.push('')
  lines.push(`*Total words: ${totalWords}*`)
  if (book.targetWordCount) {
    const progress = Math.round((totalWords / book.targetWordCount) * 100)
    lines.push('')
    lines.push(`*Progress: ${progress}% of ${book.targetWordCount.toLocaleString()} target*`)
  }

  return lines.join('\n')
}

/**
 * Format a single card as Markdown blockquote
 */
function formatCardAsMarkdown(card: HarvestCard): string {
  const lines: string[] = []

  // Card content as blockquote
  const quotedContent = card.content
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  lines.push(quotedContent)

  // Source attribution
  const source = card.authorName || card.source
  const date = card.createdAt
    ? new Date(card.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null

  if (source || date) {
    lines.push('>')
    lines.push(`> — *${source}${date ? `, ${date}` : ''}*`)
  }

  // User notes
  if (card.userNotes) {
    lines.push('')
    lines.push(`**Note:** ${card.userNotes}`)
  }

  return lines.join('\n')
}

// ============================================================================
// Download Helpers
// ============================================================================

/**
 * Trigger a file download in the browser
 */
export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}

/**
 * Generate a safe filename from a title
 */
export function sanitizeFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

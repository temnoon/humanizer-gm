/**
 * Card Item Component
 *
 * Displays a single harvest card with:
 * - Content preview
 * - Source info and metadata
 * - Grade visualization (authenticity, necessity, inflection, voice)
 * - Status indicator (staging/placed/archived)
 * - Tags
 *
 * WCAG 2.1 AA compliant (44px touch targets, focus indicators)
 */

import { memo, useCallback, type KeyboardEvent } from 'react'
import type { HarvestCard, CardGrade } from '../../lib/book-studio/types'

// ============================================================================
// Types
// ============================================================================

export interface CardItemProps {
  card: HarvestCard
  selected?: boolean
  showGrades?: boolean
  onClick?: (card: HarvestCard) => void
  onDoubleClick?: (card: HarvestCard) => void
  className?: string
}

// Grade labels for display
const GRADE_LABELS = {
  authenticity: 'Auth',
  necessity: 'Necess',
  inflection: 'Infl',
  voice: 'Voice',
} as const

type GradeKey = keyof typeof GRADE_LABELS

// ============================================================================
// Sub-components
// ============================================================================

interface GradeIndicatorProps {
  label: string
  value: number
}

const GradeIndicator = memo(function GradeIndicator({ label, value }: GradeIndicatorProps) {
  const roundedValue = Math.round(value)

  return (
    <div className="grade-indicator">
      <span className="grade-indicator__label">{label}</span>
      <div className="grade-indicator__bar">
        <div
          className={`grade-indicator__fill grade-indicator__fill--${roundedValue}`}
          style={{ width: `${(value / 5) * 100}%` }}
        />
      </div>
    </div>
  )
})

interface GradeDisplayProps {
  grade: CardGrade
}

const GradeDisplay = memo(function GradeDisplay({ grade }: GradeDisplayProps) {
  const gradeKeys: GradeKey[] = ['authenticity', 'necessity', 'inflection', 'voice']

  return (
    <div className="card-item__grades">
      {gradeKeys.map(key => (
        <GradeIndicator
          key={key}
          label={GRADE_LABELS[key]}
          value={grade[key] || 3}
        />
      ))}
    </div>
  )
})

interface OverallGradeBadgeProps {
  grade: number
}

const OverallGradeBadge = memo(function OverallGradeBadge({ grade }: OverallGradeBadgeProps) {
  const roundedGrade = Math.round(grade)

  return (
    <div
      className={`card-item__overall-grade card-item__overall-grade--${roundedGrade}`}
      title={`Overall grade: ${grade.toFixed(1)}/5`}
    >
      {roundedGrade}
    </div>
  )
})

// ============================================================================
// Main Component
// ============================================================================

export const CardItem = memo(function CardItem({
  card,
  selected = false,
  showGrades = true,
  onClick,
  onDoubleClick,
  className = '',
}: CardItemProps) {
  // Handlers
  const handleClick = useCallback(() => {
    onClick?.(card)
  }, [card, onClick])

  const handleDoubleClick = useCallback(() => {
    onDoubleClick?.(card)
  }, [card, onDoubleClick])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onClick?.(card)
      } else if (e.key === ' ') {
        e.preventDefault()
        onClick?.(card)
      }
    },
    [card, onClick]
  )

  // Format source label
  const sourceLabel = card.source?.toUpperCase() || 'UNKNOWN'

  // Format similarity
  const similarityDisplay = card.similarity
    ? `${Math.round(card.similarity * 100)}%`
    : null

  // Truncate content for preview
  const previewText = card.content.length > 200
    ? card.content.slice(0, 200) + '...'
    : card.content

  // Format date
  const formatDate = (timestamp: number | string | null | undefined): string => {
    if (!timestamp) return ''
    const date = new Date(typeof timestamp === 'number' ? timestamp * 1000 : timestamp)
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    })
  }

  // Word count
  const wordCount = card.content.split(/\s+/).filter(Boolean).length

  // Build class names
  const classNames = [
    'card-item',
    `card-item--${card.status}`,
    selected ? 'card-item--selected' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classNames}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-selected={selected}
    >
      {/* Header with source and similarity/grade */}
      <div className="card-item__header">
        <span className="card-item__source">{sourceLabel}</span>
        {card.grade?.overall ? (
          <OverallGradeBadge grade={card.grade.overall} />
        ) : similarityDisplay ? (
          <span className="card-item__similarity">{similarityDisplay}</span>
        ) : null}
      </div>

      {/* Title if available */}
      {card.title && (
        <div className="card-item__title">{card.title}</div>
      )}

      {/* Content preview */}
      <div className="card-item__preview">{previewText}</div>

      {/* Meta info */}
      <div className="card-item__meta">
        {wordCount > 0 && (
          <span className="card-item__meta-item">
            {wordCount} words
          </span>
        )}
        {card.sourceCreatedAt && (
          <span className="card-item__meta-item">
            {formatDate(card.sourceCreatedAt)}
          </span>
        )}
        {card.conversationTitle && (
          <span className="card-item__meta-item" title={card.conversationTitle}>
            {card.conversationTitle.length > 20
              ? card.conversationTitle.slice(0, 20) + '...'
              : card.conversationTitle}
          </span>
        )}
      </div>

      {/* Tags */}
      {card.tags && card.tags.length > 0 && (
        <div className="card-item__tags">
          {card.tags.slice(0, 3).map(tag => (
            <span key={tag} className="card-item__tag">{tag}</span>
          ))}
          {card.tags.length > 3 && (
            <span className="card-item__tag">+{card.tags.length - 3}</span>
          )}
        </div>
      )}

      {/* Grade visualization */}
      {showGrades && card.grade && (
        <GradeDisplay grade={card.grade} />
      )}
    </div>
  )
})

export default CardItem

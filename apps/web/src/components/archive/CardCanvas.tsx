/**
 * Card Canvas Component
 *
 * Grid/canvas view for organizing harvested cards:
 * - Grid view: Cards in responsive columns
 * - Selection support (single/multi)
 * - View size variants (compact/normal/comfortable)
 * - Empty state
 * - Progress indicator for operations
 *
 * WCAG 2.1 AA compliant (44px touch targets, focus indicators)
 */

import {
  memo,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import type { HarvestCard } from '../../lib/book-studio/types'
import { CardItem } from './CardItem'

// ============================================================================
// Types
// ============================================================================

export type CanvasViewMode = 'grid' | 'timeline' | 'canvas'
export type CanvasViewSize = 'compact' | 'normal' | 'comfortable'

export interface CardCanvasProps {
  cards: HarvestCard[]
  viewMode?: CanvasViewMode
  viewSize?: CanvasViewSize
  selectedCardIds?: string[]
  showGrades?: boolean
  isLoading?: boolean
  onCardClick?: (card: HarvestCard) => void
  onCardDoubleClick?: (card: HarvestCard) => void
  onSelectionChange?: (cardIds: string[]) => void
  emptyState?: ReactNode
  header?: ReactNode
  className?: string
}

export interface CardCanvasHeaderProps {
  title?: string
  viewMode: CanvasViewMode
  viewSize: CanvasViewSize
  cardCount: number
  onViewModeChange?: (mode: CanvasViewMode) => void
  onViewSizeChange?: (size: CanvasViewSize) => void
  actions?: ReactNode
}

// ============================================================================
// Header Component
// ============================================================================

export const CardCanvasHeader = memo(function CardCanvasHeader({
  title = 'Cards',
  viewMode,
  viewSize,
  cardCount,
  onViewModeChange,
  onViewSizeChange,
  actions,
}: CardCanvasHeaderProps) {
  return (
    <div className="card-canvas__header">
      <div className="card-canvas__header-left">
        <h3 className="card-canvas__title">
          {title} {cardCount > 0 && <span>({cardCount})</span>}
        </h3>
      </div>

      <div className="card-canvas__controls">
        {/* View mode toggle */}
        {onViewModeChange && (
          <div className="card-canvas__view-toggle" role="tablist" aria-label="View mode">
            <button
              className={`card-canvas__view-btn ${viewMode === 'grid' ? 'card-canvas__view-btn--active' : ''}`}
              onClick={() => onViewModeChange('grid')}
              role="tab"
              aria-selected={viewMode === 'grid'}
              title="Grid view"
            >
              Grid
            </button>
            <button
              className={`card-canvas__view-btn ${viewMode === 'timeline' ? 'card-canvas__view-btn--active' : ''}`}
              onClick={() => onViewModeChange('timeline')}
              role="tab"
              aria-selected={viewMode === 'timeline'}
              title="Timeline view"
            >
              Time
            </button>
          </div>
        )}

        {/* View size toggle */}
        {onViewSizeChange && (
          <div className="card-canvas__view-toggle" role="tablist" aria-label="View size">
            <button
              className={`card-canvas__view-btn ${viewSize === 'compact' ? 'card-canvas__view-btn--active' : ''}`}
              onClick={() => onViewSizeChange('compact')}
              role="tab"
              aria-selected={viewSize === 'compact'}
              title="Compact view"
            >
              S
            </button>
            <button
              className={`card-canvas__view-btn ${viewSize === 'normal' ? 'card-canvas__view-btn--active' : ''}`}
              onClick={() => onViewSizeChange('normal')}
              role="tab"
              aria-selected={viewSize === 'normal'}
              title="Normal view"
            >
              M
            </button>
            <button
              className={`card-canvas__view-btn ${viewSize === 'comfortable' ? 'card-canvas__view-btn--active' : ''}`}
              onClick={() => onViewSizeChange('comfortable')}
              role="tab"
              aria-selected={viewSize === 'comfortable'}
              title="Comfortable view"
            >
              L
            </button>
          </div>
        )}

        {/* Custom actions */}
        {actions}
      </div>
    </div>
  )
})

// ============================================================================
// Empty State Component
// ============================================================================

interface CardCanvasEmptyProps {
  message?: string
  hint?: string
}

const CardCanvasEmpty = memo(function CardCanvasEmpty({
  message = 'No cards yet',
  hint = 'Start a harvest to collect content',
}: CardCanvasEmptyProps) {
  return (
    <div className="card-canvas__empty">
      <span className="card-canvas__empty-icon" role="img" aria-hidden>
        📭
      </span>
      <p className="card-canvas__empty-text">{message}</p>
      <span className="card-canvas__empty-hint">{hint}</span>
    </div>
  )
})

// ============================================================================
// Main Component
// ============================================================================

export const CardCanvas = memo(function CardCanvas({
  cards,
  viewMode = 'grid',
  viewSize = 'normal',
  selectedCardIds = [],
  showGrades = true,
  isLoading = false,
  onCardClick,
  onCardDoubleClick,
  onSelectionChange,
  emptyState,
  header,
  className = '',
}: CardCanvasProps) {
  // Local state for view mode/size if not controlled
  const [localViewMode, setLocalViewMode] = useState<CanvasViewMode>(viewMode)
  const [localViewSize, setLocalViewSize] = useState<CanvasViewSize>(viewSize)

  // Selection state
  const selectedSet = useMemo(() => new Set(selectedCardIds), [selectedCardIds])

  // Handle card click with selection
  const handleCardClick = useCallback(
    (card: HarvestCard) => {
      if (onSelectionChange) {
        // Toggle selection
        const newSelection = selectedSet.has(card.id)
          ? selectedCardIds.filter(id => id !== card.id)
          : [...selectedCardIds, card.id]
        onSelectionChange(newSelection)
      }
      onCardClick?.(card)
    },
    [selectedCardIds, selectedSet, onCardClick, onSelectionChange]
  )

  // Sort cards by date (newest first) for timeline, by grade for grid
  const sortedCards = useMemo(() => {
    const sorted = [...cards]
    if (localViewMode === 'timeline') {
      // Sort by date, newest first
      sorted.sort((a, b) => {
        const dateA = a.sourceCreatedAt || a.harvestedAt || 0
        const dateB = b.sourceCreatedAt || b.harvestedAt || 0
        return dateB - dateA
      })
    } else {
      // Sort by grade (highest first), then by similarity
      sorted.sort((a, b) => {
        const gradeA = a.grade?.overall || 3
        const gradeB = b.grade?.overall || 3
        if (gradeA !== gradeB) return gradeB - gradeA
        const simA = a.similarity || 0
        const simB = b.similarity || 0
        return simB - simA
      })
    }
    return sorted
  }, [cards, localViewMode])

  // Build class names
  const containerClasses = [
    'card-canvas',
    localViewSize === 'compact' ? 'card-canvas--compact' : '',
    localViewSize === 'comfortable' ? 'card-canvas--comfortable' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  // Default header if not provided
  const headerElement = header ?? (
    <CardCanvasHeader
      title="Cards"
      viewMode={localViewMode}
      viewSize={localViewSize}
      cardCount={cards.length}
      onViewModeChange={setLocalViewMode}
      onViewSizeChange={setLocalViewSize}
    />
  )

  return (
    <div className={containerClasses}>
      {headerElement}

      {/* Loading state */}
      {isLoading && (
        <div className="operation-status operation-status--active">
          <div className="operation-status__header">
            <span className="operation-status__title">Loading cards...</span>
            <span className="operation-status__badge operation-status__badge--running">
              Loading
            </span>
          </div>
          <div className="progress-bar">
            <div className="progress-bar__track">
              <div className="progress-bar__fill progress-bar__fill--indeterminate" />
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && cards.length === 0 && (
        emptyState ?? <CardCanvasEmpty />
      )}

      {/* Card grid */}
      {!isLoading && cards.length > 0 && (
        <div className="card-canvas__grid" role="grid" aria-label="Harvest cards">
          {sortedCards.map(card => (
            <CardItem
              key={card.id}
              card={card}
              selected={selectedSet.has(card.id)}
              showGrades={showGrades}
              onClick={handleCardClick}
              onDoubleClick={onCardDoubleClick}
            />
          ))}
        </div>
      )}
    </div>
  )
})

export default CardCanvas

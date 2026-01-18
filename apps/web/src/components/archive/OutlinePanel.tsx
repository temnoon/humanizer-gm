/**
 * Outline Panel Component
 *
 * UI for outline generation and management:
 * - Research summary with themes and arcs
 * - Outline items with coverage indicators
 * - Generate/review actions
 * - Card assignments per section
 *
 * WCAG 2.1 AA compliant (44px touch targets, focus indicators)
 */

import { memo, useCallback, useState, type KeyboardEvent } from 'react'
import { useBookStudio } from '../../lib/book-studio/BookStudioProvider'
import type {
  OutlineStructure,
  OutlineItem,
} from '../../lib/book-studio/types'
import type {
  OutlineResearch,
  OutlineReview,
  GeneratedOutline,
  ExtractedTheme,
  CoverageGap,
} from '../../lib/book-studio/outline-agent'

// ============================================================================
// Types
// ============================================================================

export interface OutlinePanelProps {
  className?: string
  onOutlineGenerated?: (outline: GeneratedOutline) => void
  onSectionSelect?: (sectionIndex: number, cardIds: string[]) => void
}

// ============================================================================
// Sub-components
// ============================================================================

interface ResearchSummaryProps {
  research: OutlineResearch
}

const ResearchSummary = memo(function ResearchSummary({ research }: ResearchSummaryProps) {
  return (
    <div className="outline-panel__research">
      <h4 className="outline-panel__research-title">Research Summary</h4>
      <div className="outline-panel__research-stats">
        <span className="outline-panel__research-stat">
          <strong>{research.totalCards}</strong> cards analyzed
        </span>
        <span className="outline-panel__research-stat">
          <strong>{research.themes.length}</strong> themes
        </span>
        <span className="outline-panel__research-stat">
          <strong>{research.arcs.length}</strong> narrative arcs
        </span>
        <span className="outline-panel__research-stat">
          <strong>{Math.round(research.confidence * 100)}%</strong> confidence
        </span>
      </div>

      {/* Strong areas */}
      {research.strongAreas.length > 0 && (
        <div style={{ marginTop: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>
            Strengths: {research.strongAreas.slice(0, 2).join(', ')}
          </span>
        </div>
      )}

      {/* Coverage gaps */}
      {research.coverageGaps.filter(g => g.severity === 'major').length > 0 && (
        <div style={{ marginTop: '0.25rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-error)' }}>
            Gaps: {research.coverageGaps.filter(g => g.severity === 'major').map(g => g.theme).join(', ')}
          </span>
        </div>
      )}
    </div>
  )
})

interface ThemeListProps {
  themes: ExtractedTheme[]
  maxShow?: number
}

const ThemeList = memo(function ThemeList({ themes, maxShow = 5 }: ThemeListProps) {
  const displayThemes = themes.slice(0, maxShow)

  return (
    <div className="outline-panel__themes">
      <h4 className="outline-panel__research-title">Themes</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
        {displayThemes.map(theme => (
          <span
            key={theme.id}
            className="card-item__tag"
            title={`${theme.cardIds.length} cards, strength: ${Math.round(theme.strength * 100)}%`}
          >
            {theme.name}
          </span>
        ))}
        {themes.length > maxShow && (
          <span className="card-item__tag">+{themes.length - maxShow} more</span>
        )}
      </div>
    </div>
  )
})

interface OutlineItemRowProps {
  item: OutlineItem
  index: number
  coverage?: 'strong' | 'partial' | 'weak' | 'none'
  cardCount?: number
  onClick?: () => void
}

const OutlineItemRow = memo(function OutlineItemRow({
  item,
  index,
  coverage = 'none',
  cardCount = 0,
  onClick,
}: OutlineItemRowProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick?.()
      }
    },
    [onClick]
  )

  const coverageClass = coverage ? `outline-item--coverage-${coverage}` : ''
  const levelClass = item.level > 0 ? `outline-item--level-${Math.min(item.level, 2)}` : ''

  return (
    <div
      className={`outline-item ${coverageClass} ${levelClass}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <div className="outline-item__header">
        <span className="outline-item__number">{index + 1}.</span>
        <span className="outline-item__title">{item.text}</span>
        {cardCount > 0 && (
          <span className="outline-item__card-count">{cardCount} cards</span>
        )}
      </div>
    </div>
  )
})

interface GapListProps {
  gaps: CoverageGap[]
}

const GapList = memo(function GapList({ gaps }: GapListProps) {
  const majorGaps = gaps.filter(g => g.severity === 'major')
  const otherGaps = gaps.filter(g => g.severity !== 'major')

  if (gaps.length === 0) return null

  return (
    <div style={{ marginTop: '1rem' }}>
      <h4 className="outline-panel__research-title">Coverage Gaps</h4>
      {majorGaps.length > 0 && (
        <div style={{ marginBottom: '0.5rem' }}>
          {majorGaps.map((gap, i) => (
            <div
              key={i}
              style={{
                padding: '0.5rem',
                marginBottom: '0.25rem',
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: '4px',
                fontSize: '0.75rem',
              }}
            >
              <strong>{gap.theme}</strong>: {gap.description}
              <div style={{ color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
                {gap.suggestedAction}
              </div>
            </div>
          ))}
        </div>
      )}
      {otherGaps.length > 0 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
          {otherGaps.length} minor gap{otherGaps.length > 1 ? 's' : ''} found
        </div>
      )}
    </div>
  )
})

// ============================================================================
// Main Component
// ============================================================================

export const OutlinePanel = memo(function OutlinePanel({
  className = '',
  onOutlineGenerated,
  onSectionSelect,
}: OutlinePanelProps) {
  const { activeBook, outline } = useBookStudio()
  const { state, research, generate, clear } = outline

  // Local state for custom outline text
  const [showThemes, setShowThemes] = useState(true)

  // Handle research action
  const handleResearch = useCallback(async () => {
    try {
      await research()
    } catch (err) {
      console.error('[OutlinePanel] Research failed:', err)
    }
  }, [research])

  // Handle generate action
  const handleGenerate = useCallback(async () => {
    try {
      const generated = await generate()
      onOutlineGenerated?.(generated)
    } catch (err) {
      console.error('[OutlinePanel] Generation failed:', err)
    }
  }, [generate, onOutlineGenerated])

  // Handle clear
  const handleClear = useCallback(() => {
    clear()
  }, [clear])

  // Handle section click
  const handleSectionClick = useCallback(
    (index: number) => {
      if (state.generatedOutline?.itemCardAssignments) {
        const cardIds = state.generatedOutline.itemCardAssignments.get(`${index}`) || []
        onSectionSelect?.(index, cardIds)
      }
    },
    [state.generatedOutline, onSectionSelect]
  )

  // Get card count for a section
  const getCardCount = (index: number): number => {
    if (!state.generatedOutline?.itemCardAssignments) return 0
    return state.generatedOutline.itemCardAssignments.get(`${index}`)?.length || 0
  }

  // Get coverage level for a section
  const getCoverage = (index: number): 'strong' | 'partial' | 'weak' | 'none' => {
    const count = getCardCount(index)
    if (count === 0) return 'none'
    if (count >= 3) return 'strong'
    if (count >= 1) return 'partial'
    return 'weak'
  }

  // Check if we can run operations
  const canResearch = activeBook && activeBook.stagingCards.length > 0
  const canGenerate = state.research && !state.isGenerating

  return (
    <div className={`outline-panel ${className}`}>
      {/* Header */}
      <div className="outline-panel__header">
        <h3 className="outline-panel__title">Outline</h3>
        <div className="outline-panel__actions">
          {!state.research && (
            <button
              className="draft-panel__generate-btn"
              onClick={handleResearch}
              disabled={!canResearch || state.isResearching}
              title={!canResearch ? 'Add cards to staging first' : 'Analyze cards to extract themes'}
            >
              {state.isResearching ? 'Analyzing...' : 'Research'}
            </button>
          )}
          {state.research && !state.generatedOutline && (
            <button
              className="draft-panel__generate-btn"
              onClick={handleGenerate}
              disabled={!canGenerate}
            >
              {state.isGenerating ? 'Generating...' : 'Generate Outline'}
            </button>
          )}
          {(state.research || state.generatedOutline) && (
            <button
              className="card-canvas__view-btn"
              onClick={handleClear}
              title="Clear and start over"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="outline-panel__content">
        {/* Error state */}
        {state.error && (
          <div className="operation-status operation-status--error">
            <div className="operation-status__header">
              <span className="operation-status__title">Error</span>
            </div>
            <div className="operation-status__details">{state.error}</div>
          </div>
        )}

        {/* Loading state */}
        {(state.isResearching || state.isGenerating) && (
          <div className="operation-status operation-status--active">
            <div className="operation-status__header">
              <span className="operation-status__title">
                {state.isResearching ? 'Analyzing cards...' : 'Generating outline...'}
              </span>
              <span className="operation-status__badge operation-status__badge--running">
                Working
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
        {!state.research && !state.isResearching && (
          <div className="card-canvas__empty">
            <span className="card-canvas__empty-icon" role="img" aria-hidden>
              📝
            </span>
            <p className="card-canvas__empty-text">No outline yet</p>
            <span className="card-canvas__empty-hint">
              {canResearch
                ? 'Click Research to analyze your cards and generate an outline'
                : 'Add cards to staging first, then generate an outline'}
            </span>
          </div>
        )}

        {/* Research results */}
        {state.research && !state.generatedOutline && (
          <>
            <ResearchSummary research={state.research} />

            {/* Themes toggle */}
            <div style={{ marginTop: '1rem' }}>
              <button
                className="card-canvas__view-btn"
                onClick={() => setShowThemes(!showThemes)}
                style={{ marginBottom: '0.5rem' }}
              >
                {showThemes ? 'Hide' : 'Show'} Themes
              </button>
              {showThemes && <ThemeList themes={state.research.themes} />}
            </div>

            {/* Suggested sections */}
            {state.research.suggestedSections.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h4 className="outline-panel__research-title">Suggested Structure</h4>
                {state.research.suggestedSections.map((section, i) => (
                  <div
                    key={i}
                    className="outline-item"
                    style={{ marginBottom: '0.25rem' }}
                  >
                    <div className="outline-item__header">
                      <span className="outline-item__number">{section.order}.</span>
                      <span className="outline-item__title">{section.title}</span>
                      <span className="outline-item__card-count">
                        {section.cardIds.length} cards
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Coverage gaps */}
            <GapList gaps={state.research.coverageGaps} />
          </>
        )}

        {/* Generated outline */}
        {state.generatedOutline && (
          <>
            <div className="outline-panel__research" style={{ marginBottom: '1rem' }}>
              <h4 className="outline-panel__research-title">Generated Outline</h4>
              <div className="outline-panel__research-stats">
                <span className="outline-panel__research-stat">
                  <strong>{state.generatedOutline.structure.items.length}</strong> sections
                </span>
                <span className="outline-panel__research-stat">
                  <strong>{Math.round(state.generatedOutline.confidence * 100)}%</strong> confidence
                </span>
              </div>
            </div>

            {/* Outline items */}
            {state.generatedOutline.structure.items.map((item, index) => (
              <OutlineItemRow
                key={index}
                item={item}
                index={index}
                coverage={getCoverage(index)}
                cardCount={getCardCount(index)}
                onClick={() => handleSectionClick(index)}
              />
            ))}

            {/* Review if available */}
            {state.review && (
              <div style={{ marginTop: '1rem' }}>
                <div className="outline-panel__research">
                  <h4 className="outline-panel__research-title">Review</h4>
                  <div className="outline-panel__research-stats">
                    <span className="outline-panel__research-stat">
                      <strong>{Math.round(state.review.overallCoverage * 100)}%</strong> coverage
                    </span>
                    <span className="outline-panel__research-stat">
                      <strong>{Math.round(state.review.feasibility * 100)}%</strong> feasibility
                    </span>
                    <span className="outline-panel__research-stat">
                      <strong>{state.review.uncoveredItems.length}</strong> uncovered
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})

export default OutlinePanel

/**
 * StagingView - Review and organize harvested cards
 *
 * Four views:
 * - Grid: Card grid with compact cards
 * - Timeline: Cards grouped by time period
 * - Canvas: Free-form spatial arrangement
 * - Clusters: Group by source, tag, or semantic theme
 *
 * Features:
 * - Card grading visualization (5 categories)
 * - Priority ordering by grade
 * - Iterative "Harvest More" functionality
 * - Chapter assignment with "New Chapter" option
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useBookStudio } from '../../../lib/book-studio/BookStudioProvider'
import type { HarvestCard, Chapter, StagingView as StagingViewType, CardPosition, CardGrade } from '../../../lib/book-studio/types'
import { gradingQueue } from '../../../lib/book-studio/harvest-review-agent'

// =============================================================================
// InputDialog Component (replaces browser prompt())
// =============================================================================

interface InputDialogProps {
  isOpen: boolean
  title: string
  placeholder?: string
  defaultValue?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

function InputDialog({ isOpen, title, placeholder, defaultValue = '', onSubmit, onCancel }: InputDialogProps) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue)
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
    }
  }, [isOpen, defaultValue])

  if (!isOpen) return null

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim())
    }
  }

  return (
    <div className="staging-dialog__overlay" onClick={onCancel}>
      <div className="staging-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="staging-dialog__title">{title}</h3>
        <input
          ref={inputRef}
          type="text"
          className="staging-dialog__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') onCancel()
          }}
          placeholder={placeholder}
        />
        <div className="staging-dialog__actions">
          <button className="staging-dialog__btn staging-dialog__btn--cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="staging-dialog__btn staging-dialog__btn--submit" onClick={handleSubmit}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Sort Options
// =============================================================================

type SortOption = 'grade' | 'time' | 'manual'

// =============================================================================
// GradeDisplay Component
// =============================================================================

interface GradeDisplayProps {
  grade?: CardGrade
  compact?: boolean
}

function GradeDisplay({ grade, compact }: GradeDisplayProps) {
  if (!grade) {
    return compact ? null : (
      <div className="staging-card__grade staging-card__grade--pending">
        <span>Grading...</span>
      </div>
    )
  }

  const categories = [
    { key: 'authenticity', label: 'Auth', value: grade.authenticity },
    { key: 'necessity', label: 'Nec', value: grade.necessity },
    { key: 'inflection', label: 'Infl', value: grade.inflection },
    { key: 'voice', label: 'Voice', value: grade.voice },
  ]

  if (compact) {
    // Compact: just show overall score
    return (
      <div className={`staging-card__grade-badge staging-card__grade-badge--${getGradeLevel(grade.overall)}`}>
        {grade.overall.toFixed(1)}
      </div>
    )
  }

  // Full: show all 5 bars
  return (
    <div className="staging-card__grade">
      <div className="staging-card__grade-overall">
        <span className="staging-card__grade-label">Overall</span>
        <span className={`staging-card__grade-value staging-card__grade-value--${getGradeLevel(grade.overall)}`}>
          {grade.overall.toFixed(1)}
        </span>
      </div>
      <div className="staging-card__grade-bars">
        {categories.map(cat => (
          <div key={cat.key} className="staging-card__grade-bar">
            <span className="staging-card__grade-bar-label">{cat.label}</span>
            <div className="staging-card__grade-bar-track">
              <div
                className={`staging-card__grade-bar-fill staging-card__grade-bar-fill--${getGradeLevel(cat.value)}`}
                style={{ width: `${(cat.value / 5) * 100}%` }}
              />
            </div>
            <span className="staging-card__grade-bar-value">{cat.value}</span>
          </div>
        ))}
      </div>
      {grade.stubType && grade.stubType !== 'optimal' && (
        <div className="staging-card__stub-tag">{grade.stubType}</div>
      )}
    </div>
  )
}

function getGradeLevel(value: number): 'high' | 'medium' | 'low' {
  if (value >= 4) return 'high'
  if (value >= 3) return 'medium'
  return 'low'
}

// =============================================================================
// HarvestCardDisplay Component
// =============================================================================

interface HarvestCardDisplayProps {
  card: HarvestCard
  chapters: Chapter[]
  isSelected?: boolean
  isCompact?: boolean
  onSelect?: () => void
  onUpdateNotes?: (notes: string) => void
  onMoveToChapter?: (chapterId: string) => void
  onCreateChapter?: (title: string) => void
  onDelete?: () => void
}

function HarvestCardDisplay({
  card,
  chapters,
  isSelected,
  isCompact,
  onSelect,
  onMoveToChapter,
  onCreateChapter,
  onDelete,
}: HarvestCardDisplayProps) {
  const wordCount = card.content.trim().split(/\s+/).filter(Boolean).length
  const isStub = wordCount < 50
  const isKeyPassage = card.grade?.overall && card.grade.overall >= 4

  const formatDate = (dateValue?: string | number | null) => {
    if (!dateValue) return ''
    try {
      const date = typeof dateValue === 'number'
        ? new Date(dateValue < 946684800000 ? dateValue * 1000 : dateValue)
        : new Date(dateValue)
      if (isNaN(date.getTime())) return ''
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch {
      return ''
    }
  }

  const getTypeIcon = () => {
    switch (card.sourceType) {
      case 'post': return '📝'
      case 'note': return '📄'
      case 'image': return '🖼️'
      case 'message': return '💬'
      case 'comment': return '💭'
      default: return '📄'
    }
  }

  const truncate = (text: string, len: number) =>
    text.length <= len ? text : text.slice(0, len).trim() + '...'

  const handleChapterChange = (value: string) => {
    if (value === '__new__') {
      // Show dialog for new chapter (handled by parent)
      onCreateChapter?.('')
    } else if (value) {
      onMoveToChapter?.(value)
    }
  }

  if (isCompact) {
    return (
      <div
        className={`staging-card staging-card--compact ${isSelected ? 'staging-card--selected' : ''} ${isStub ? 'staging-card--stub' : ''} ${isKeyPassage ? 'staging-card--key' : ''}`}
        onClick={onSelect}
      >
        <div className="staging-card__header">
          <span className="staging-card__icon">{getTypeIcon()}</span>
          <span className="staging-card__source">{card.source}</span>
          {card.grade && <GradeDisplay grade={card.grade} compact />}
          <span className="staging-card__word-count">{wordCount}w</span>
        </div>
        <div className="staging-card__preview">
          {truncate(card.content, 120)}
        </div>
        {card.userNotes && (
          <div className="staging-card__note-indicator">
            📌 {truncate(card.userNotes, 30)}
          </div>
        )}
        {card.suggestedChapterId && (
          <div className="staging-card__chapter-tag">
            Ch. {chapters.find((c) => c.id === card.suggestedChapterId)?.title || '?'}
          </div>
        )}
      </div>
    )
  }

  // Full view
  return (
    <div className={`staging-card ${isSelected ? 'staging-card--selected' : ''} ${isKeyPassage ? 'staging-card--key' : ''}`}>
      <div className="staging-card__header">
        <span className="staging-card__icon">{getTypeIcon()}</span>
        <span className="staging-card__source">
          {card.source}
          {formatDate(card.createdAt) && ` · ${formatDate(card.createdAt)}`}
        </span>
        <button className="staging-card__close" onClick={onDelete} title="Remove">×</button>
      </div>

      {/* Grade visualization */}
      <GradeDisplay grade={card.grade} />

      <div className="staging-card__content">{card.content}</div>
      {card.userNotes && (
        <div className="staging-card__notes">📌 {card.userNotes}</div>
      )}
      <div className="staging-card__actions">
        <select
          className="staging-card__chapter-select"
          value={card.suggestedChapterId || ''}
          onChange={(e) => handleChapterChange(e.target.value)}
        >
          <option value="">Move to chapter...</option>
          {chapters.map((ch) => (
            <option key={ch.id} value={ch.id}>{ch.title}</option>
          ))}
          <option value="__new__">+ New Chapter...</option>
        </select>
        <span className="staging-card__word-count">{wordCount} words</span>
      </div>
    </div>
  )
}

// =============================================================================
// CanvasView Component
// =============================================================================

interface CanvasViewProps {
  cards: HarvestCard[]
  selectedCardId: string | null
  onSelectCard: (cardId: string | null) => void
  onUpdateCardPosition: (cardId: string, position: CardPosition) => void
}

function CanvasView({ cards, selectedCardId, onSelectCard, onUpdateCardPosition }: CanvasViewProps) {
  const [dragState, setDragState] = useState<{
    cardId: string
    startX: number
    startY: number
    cardStartX: number
    cardStartY: number
  } | null>(null)

  // Calculate canvas bounds based on card positions
  const canvasBounds = useMemo(() => {
    let maxX = 800
    let maxY = 600
    if (cards.length > 0) {
      cards.forEach((card, index) => {
        const pos = card.canvasPosition || getInitialPositionForCanvas(index, cards.length)
        const posX = typeof pos.x === 'number' && !isNaN(pos.x) ? pos.x : 20
        const posY = typeof pos.y === 'number' && !isNaN(pos.y) ? pos.y : 50
        maxX = Math.max(maxX, posX + 280)
        maxY = Math.max(maxY, posY + 200)
      })
    }
    return { width: maxX + 40, height: maxY + 40 }
  }, [cards])

  const handleMouseDown = useCallback((e: React.MouseEvent, card: HarvestCard, index: number) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const pos = card.canvasPosition || getInitialPositionForCanvas(index, cards.length)
    setDragState({
      cardId: card.id,
      startX: e.clientX,
      startY: e.clientY,
      cardStartX: pos.x,
      cardStartY: pos.y,
    })
    onSelectCard(card.id)
  }, [cards.length, onSelectCard])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState) return
    const dx = e.clientX - dragState.startX
    const dy = e.clientY - dragState.startY
    onUpdateCardPosition(dragState.cardId, {
      x: Math.max(0, dragState.cardStartX + dx),
      y: Math.max(0, dragState.cardStartY + dy),
    })
  }, [dragState, onUpdateCardPosition])

  const handleMouseUp = useCallback(() => {
    setDragState(null)
  }, [])

  const getTypeIcon = (type?: string) => {
    switch (type) {
      case 'post': return '📝'
      case 'note': return '📄'
      case 'image': return '🖼️'
      case 'message': return '💬'
      case 'comment': return '💭'
      default: return '📄'
    }
  }

  return (
    <div
      className="staging-canvas"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={() => onSelectCard(null)}
    >
      <div className="staging-canvas__hint">
        Drag cards to arrange · Click empty space to deselect · {cards.length} cards
      </div>
      <div
        className="staging-canvas__area"
        style={{ minWidth: canvasBounds.width, minHeight: canvasBounds.height }}
      >
        {cards.map((card, index) => {
          const pos = card.canvasPosition || getInitialPositionForCanvas(index, cards.length)
          const isSelected = card.id === selectedCardId
          const isDragging = dragState?.cardId === card.id
          const isKeyPassage = card.grade?.overall && card.grade.overall >= 4
          return (
            <div
              key={card.id}
              className={`staging-canvas__card ${isSelected ? 'staging-canvas__card--selected' : ''} ${isDragging ? 'staging-canvas__card--dragging' : ''} ${isKeyPassage ? 'staging-canvas__card--key' : ''}`}
              style={{
                left: pos.x,
                top: pos.y,
                zIndex: isDragging ? 1000 : isSelected ? 100 : 1,
              }}
              onMouseDown={(e) => handleMouseDown(e, card, index)}
            >
              <div className="staging-canvas__card-header">
                <span className="staging-canvas__card-icon">{getTypeIcon(card.sourceType)}</span>
                <span className="staging-canvas__card-source">{card.source}</span>
                {card.grade && (
                  <span className={`staging-canvas__card-grade staging-canvas__card-grade--${getGradeLevel(card.grade.overall)}`}>
                    {card.grade.overall.toFixed(1)}
                  </span>
                )}
              </div>
              <div className="staging-canvas__card-content">
                {card.content.length > 80 ? card.content.slice(0, 80) + '...' : card.content}
              </div>
              {card.suggestedChapterId && (
                <div className="staging-canvas__card-chapter">
                  Ch. assigned
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Helper function to calculate initial canvas positions in a grid
function getInitialPositionForCanvas(index: number, totalCards: number): CardPosition {
  // Guard against edge cases
  if (totalCards <= 0 || index < 0) {
    return { x: 20, y: 50 }
  }

  // Use a grid layout with variable columns based on card count
  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(totalCards))))
  const cardWidth = 260
  const cardHeight = 160
  const gapX = 20
  const gapY = 20
  const startX = 20
  const startY = 50 // Leave room for hint

  const row = Math.floor(index / cols)
  const col = index % cols

  return {
    x: startX + col * (cardWidth + gapX),
    y: startY + row * (cardHeight + gapY),
  }
}

// =============================================================================
// ClustersView Component
// =============================================================================

type GroupBy = 'source' | 'period' | 'tag'

interface Cluster {
  id: string
  name: string
  cards: HarvestCard[]
  color: string
}

const CLUSTER_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f97316',
  '#10b981', '#06b6d4', '#3b82f6', '#f59e0b',
]

interface ClustersViewProps {
  cards: HarvestCard[]
  chapters: Chapter[]
  selectedCardId: string | null
  onSelectCard: (cardId: string | null) => void
  onMoveToChapter: (cardId: string, chapterId: string) => void
  onCreateChapter?: (title: string, cardIds: string[]) => void
}

function ClustersView({
  cards,
  chapters,
  selectedCardId,
  onSelectCard,
  onMoveToChapter,
  onCreateChapter,
}: ClustersViewProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('source')

  const clusters = useMemo((): Cluster[] => {
    const groups: Record<string, HarvestCard[]> = {}

    cards.forEach((card) => {
      let key: string
      switch (groupBy) {
        case 'source':
          key = card.sourceType || 'other'
          break
        case 'period':
          if (!card.createdAt) {
            key = 'Unknown'
          } else {
            const date = typeof card.createdAt === 'number'
              ? new Date(card.createdAt < 946684800000 ? card.createdAt * 1000 : card.createdAt)
              : new Date(card.createdAt)
            key = isNaN(date.getTime()) ? 'Unknown' : String(date.getFullYear())
          }
          break
        case 'tag':
          key = card.tags.length > 0 ? card.tags[0] : 'Untagged'
          break
      }
      groups[key] = groups[key] || []
      groups[key].push(card)
    })

    return Object.entries(groups).map(([name, cardList], idx) => ({
      id: name,
      name: formatClusterName(name, groupBy),
      cards: cardList,
      color: CLUSTER_COLORS[idx % CLUSTER_COLORS.length],
    }))
  }, [cards, groupBy])

  const handleMakeChapter = (cluster: Cluster) => {
    if (!onCreateChapter) return
    // Pass empty string to signal dialog needed, with cluster name as default
    // Parent will show dialog and handle the creation
    onCreateChapter(cluster.name, cluster.cards.map((c) => c.id))
  }

  const handleAssignCluster = (cluster: Cluster, chapterId: string) => {
    cluster.cards.forEach((card) => {
      onMoveToChapter(card.id, chapterId)
    })
  }

  return (
    <div className="staging-clusters">
      <div className="staging-clusters__header">
        <div className="staging-clusters__group-by">
          <span>Group by:</span>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="source">Source Type</option>
            <option value="period">Time Period</option>
            <option value="tag">Tags</option>
          </select>
        </div>
        <div className="staging-clusters__stats">
          {clusters.length} clusters · {cards.length} cards
        </div>
      </div>

      <div className="staging-clusters__grid">
        {clusters.map((cluster) => (
          <div
            key={cluster.id}
            className="staging-clusters__cluster"
            style={{ borderLeftColor: cluster.color }}
          >
            <div className="staging-clusters__cluster-header">
              <span className="staging-clusters__cluster-name">{cluster.name}</span>
              <span className="staging-clusters__cluster-count">{cluster.cards.length}</span>
            </div>
            <div className="staging-clusters__cluster-cards">
              {cluster.cards.slice(0, 6).map((card) => (
                <div
                  key={card.id}
                  className={`staging-clusters__card ${card.id === selectedCardId ? 'staging-clusters__card--selected' : ''}`}
                  onClick={() => onSelectCard(card.id === selectedCardId ? null : card.id)}
                >
                  {card.content.length > 60 ? card.content.slice(0, 60) + '...' : card.content}
                </div>
              ))}
              {cluster.cards.length > 6 && (
                <div className="staging-clusters__more">
                  +{cluster.cards.length - 6} more
                </div>
              )}
            </div>
            {cluster.cards.length > 0 && (
              <div className="staging-clusters__cluster-actions">
                {chapters.length > 0 && (
                  <select
                    className="staging-clusters__assign-select"
                    onChange={(e) => {
                      if (e.target.value) handleAssignCluster(cluster, e.target.value)
                      e.target.value = ''
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>Assign to...</option>
                    {chapters.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.title}</option>
                    ))}
                  </select>
                )}
                {onCreateChapter && (
                  <button
                    className="staging-clusters__chapter-btn"
                    onClick={() => handleMakeChapter(cluster)}
                  >
                    + Chapter
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function formatClusterName(name: string, groupBy: GroupBy): string {
  if (groupBy === 'source') {
    const labels: Record<string, string> = {
      message: '💬 Messages',
      post: '📝 Posts',
      comment: '💭 Comments',
      document: '📄 Documents',
      note: '📋 Notes',
      image: '🖼️ Images',
      other: '📎 Other',
    }
    return labels[name] || name
  }
  return name
}

// =============================================================================
// Main StagingView Component
// =============================================================================

export function StagingView() {
  const bookStudio = useBookStudio()
  const [view, setView] = useState<StagingViewType>('grid')
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [hideStubs, setHideStubs] = useState(false)
  const [sortBy, setSortBy] = useState<SortOption>('grade')
  const [isHarvesting, setIsHarvesting] = useState(false)
  const [harvestQuery, setHarvestQuery] = useState('')
  const [gradingCount, setGradingCount] = useState(gradingQueue.length)

  // Dialog states
  const [harvestDialog, setHarvestDialog] = useState(false)
  const [chapterDialog, setChapterDialog] = useState<{
    isOpen: boolean
    cardId?: string
    cardIds?: string[]
    defaultTitle: string
  }>({ isOpen: false, defaultTitle: '' })

  const cards = bookStudio.activeBook?.stagingCards || []
  const chapters = bookStudio.activeBook?.chapters || []

  // Subscribe to grading queue updates
  useEffect(() => {
    const unsubscribe = gradingQueue.subscribe((cardId, grade) => {
      // Update card with new grade
      bookStudio.actions.updateCard(cardId, { grade })
      setGradingCount(gradingQueue.length)
    })

    // Update count periodically while processing
    const interval = setInterval(() => {
      setGradingCount(gradingQueue.length)
    }, 500)

    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [bookStudio.actions])

  // Filter and sort cards
  const filteredCards = useMemo(() => {
    let result = cards

    // Filter stubs
    if (hideStubs) {
      result = result.filter((card) => {
        const wordCount = card.content.trim().split(/\s+/).filter(Boolean).length
        return wordCount >= 50
      })
    }

    // Sort
    if (sortBy === 'grade') {
      result = [...result].sort((a, b) => {
        const gradeA = a.grade?.overall ?? 3
        const gradeB = b.grade?.overall ?? 3
        if (gradeA !== gradeB) return gradeB - gradeA // Higher grades first
        // Then by temporal position
        const timeA = a.sourceCreatedAt ?? a.harvestedAt ?? 0
        const timeB = b.sourceCreatedAt ?? b.harvestedAt ?? 0
        return timeB - timeA
      })
    } else if (sortBy === 'time') {
      result = [...result].sort((a, b) => {
        const timeA = a.sourceCreatedAt ?? a.harvestedAt ?? 0
        const timeB = b.sourceCreatedAt ?? b.harvestedAt ?? 0
        return timeB - timeA // Newer first
      })
    }
    // 'manual' - keep original order

    return result
  }, [cards, hideStubs, sortBy])

  const selectedCard = cards.find((c) => c.id === selectedCardId)

  // Card actions
  const handleUpdateCard = useCallback((cardId: string, updates: Partial<HarvestCard>) => {
    bookStudio.actions.updateCard(cardId, updates)
  }, [bookStudio.actions])

  const handleDeleteCard = useCallback((cardId: string) => {
    bookStudio.actions.deleteCard(cardId)
    if (selectedCardId === cardId) setSelectedCardId(null)
  }, [bookStudio.actions, selectedCardId])

  const handleMoveToChapter = useCallback((cardId: string, chapterId: string) => {
    handleUpdateCard(cardId, { suggestedChapterId: chapterId, status: 'placed' })
  }, [handleUpdateCard])

  const handleUpdateCardPosition = useCallback((cardId: string, position: CardPosition) => {
    handleUpdateCard(cardId, { canvasPosition: position })
  }, [handleUpdateCard])

  // Show dialog to create chapter with multiple cards
  const handleCreateChapter = useCallback((defaultTitle: string, cardIds: string[]) => {
    setChapterDialog({
      isOpen: true,
      cardIds,
      defaultTitle: defaultTitle || 'New Chapter',
    })
  }, [])

  // Show dialog to create chapter and assign a single card to it
  const handleCreateChapterForCard = useCallback((cardId: string, defaultTitle: string) => {
    setChapterDialog({
      isOpen: true,
      cardId,
      defaultTitle: defaultTitle || 'New Chapter',
    })
  }, [])

  // Actually create the chapter after dialog submission
  const handleChapterDialogSubmit = useCallback(async (title: string) => {
    const newChapter = await bookStudio.actions.createChapter(title)
    if (newChapter) {
      if (chapterDialog.cardId) {
        handleMoveToChapter(chapterDialog.cardId, newChapter.id)
      } else if (chapterDialog.cardIds) {
        for (const cardId of chapterDialog.cardIds) {
          handleMoveToChapter(cardId, newChapter.id)
        }
      }
    }
    setChapterDialog({ isOpen: false, defaultTitle: '' })
  }, [bookStudio.actions, handleMoveToChapter, chapterDialog])

  // Harvest More: Run another smart harvest
  const handleHarvestMore = useCallback(() => {
    if (harvestQuery.trim()) {
      // Already have a query, run immediately
      runHarvest(harvestQuery.trim())
    } else {
      // Show dialog to get query
      setHarvestDialog(true)
    }
  }, [harvestQuery])

  // Run the actual harvest
  const runHarvest = useCallback(async (query: string) => {
    setHarvestQuery(query)
    setIsHarvesting(true)
    try {
      // Use the harvest agent from context
      await bookStudio.harvest.run(query)
      // After harvest completes, commit the results to staging
      await bookStudio.harvest.commitResults()
    } catch (error) {
      console.error('Harvest failed:', error)
    } finally {
      setIsHarvesting(false)
    }
  }, [bookStudio.harvest])

  // Handle harvest dialog submission
  const handleHarvestDialogSubmit = useCallback((query: string) => {
    setHarvestDialog(false)
    runHarvest(query)
  }, [runHarvest])

  const stubCount = cards.filter((c) => c.content.trim().split(/\s+/).filter(Boolean).length < 50).length
  const avgGrade = cards.length > 0
    ? (cards.reduce((sum, c) => sum + (c.grade?.overall ?? 3), 0) / cards.length).toFixed(1)
    : '—'

  // Group cards by time for timeline
  const cardsByPeriod = useMemo(() => {
    const groups: Record<string, HarvestCard[]> = {}
    filteredCards.forEach((card) => {
      if (!card.createdAt) {
        groups['Unknown'] = groups['Unknown'] || []
        groups['Unknown'].push(card)
        return
      }
      const date = typeof card.createdAt === 'number'
        ? new Date(card.createdAt < 946684800000 ? card.createdAt * 1000 : card.createdAt)
        : new Date(card.createdAt)
      const year = isNaN(date.getTime()) ? 'Unknown' : String(date.getFullYear())
      groups[year] = groups[year] || []
      groups[year].push(card)
    })
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Unknown') return 1
      if (b === 'Unknown') return -1
      return Number(b) - Number(a)
    })
  }, [filteredCards])

  return (
    <div className="staging-view">
      <div className="staging-view__header">
        <div className="staging-view__view-selector">
          <span className="staging-view__label">View:</span>
          {(['grid', 'timeline', 'canvas', 'clusters'] as StagingViewType[]).map((v) => (
            <button
              key={v}
              className={`staging-view__view-btn ${view === v ? 'staging-view__view-btn--active' : ''}`}
              onClick={() => setView(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        <div className="staging-view__sort">
          <span className="staging-view__label">Sort:</span>
          <select
            className="staging-view__sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
          >
            <option value="grade">By Grade (Best First)</option>
            <option value="time">By Time (Newest First)</option>
            <option value="manual">Manual Order</option>
          </select>
        </div>

        <div className="staging-view__filters">
          <label className="staging-view__checkbox">
            <input
              type="checkbox"
              checked={hideStubs}
              onChange={(e) => setHideStubs(e.target.checked)}
            />
            Hide stubs ({stubCount})
          </label>
        </div>

        <div className="staging-view__stats">
          <span className="staging-view__count">{filteredCards.length} cards</span>
          <span className="staging-view__avg-grade" title="Average grade">
            Avg: {avgGrade}
          </span>
          {gradingCount > 0 && (
            <span className="staging-view__grading-status">
              Grading {gradingCount}...
            </span>
          )}
        </div>

        <button
          className="staging-view__harvest-more-btn"
          onClick={handleHarvestMore}
          disabled={isHarvesting}
        >
          {isHarvesting ? 'Harvesting...' : '+ Harvest More'}
        </button>
      </div>

      <div className="staging-view__body">
        <div className="staging-view__content">
          {cards.length === 0 ? (
            <div className="staging-view__empty">
              <div className="staging-view__empty-icon">📚</div>
              <h3>No cards in staging</h3>
              <p>Go to Harvest to search and add content.</p>
            </div>
          ) : view === 'grid' ? (
            <div className="staging-view__grid">
              {filteredCards.map((card) => (
                <HarvestCardDisplay
                  key={card.id}
                  card={card}
                  chapters={chapters}
                  isCompact
                  isSelected={card.id === selectedCardId}
                  onSelect={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}
                  onCreateChapter={(title) => handleCreateChapterForCard(card.id, title)}
                />
              ))}
            </div>
          ) : view === 'timeline' ? (
            <div className="staging-view__timeline">
              {cardsByPeriod.map(([year, yearCards]) => (
                <div key={year} className="staging-view__timeline-group">
                  <div className="staging-view__timeline-year">{year}</div>
                  <div className="staging-view__timeline-cards">
                    {yearCards.map((card) => (
                      <div
                        key={card.id}
                        className={`staging-view__timeline-item ${card.id === selectedCardId ? 'staging-view__timeline-item--selected' : ''}`}
                        onClick={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}
                      >
                        <div className="staging-view__timeline-content">
                          {card.content.length > 80 ? card.content.slice(0, 80) + '...' : card.content}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : view === 'canvas' ? (
            <CanvasView
              cards={filteredCards}
              selectedCardId={selectedCardId}
              onSelectCard={setSelectedCardId}
              onUpdateCardPosition={handleUpdateCardPosition}
            />
          ) : (
            <ClustersView
              cards={filteredCards}
              chapters={chapters}
              selectedCardId={selectedCardId}
              onSelectCard={setSelectedCardId}
              onMoveToChapter={handleMoveToChapter}
              onCreateChapter={handleCreateChapter}
            />
          )}
        </div>

        {/* Detail panel */}
        {selectedCard && (
          <div className="staging-view__detail">
            <HarvestCardDisplay
              card={selectedCard}
              chapters={chapters}
              isSelected
              onMoveToChapter={(chapterId) => handleMoveToChapter(selectedCard.id, chapterId)}
              onCreateChapter={() => handleCreateChapterForCard(selectedCard.id, '')}
              onDelete={() => handleDeleteCard(selectedCard.id)}
            />
          </div>
        )}
      </div>

      {/* Harvest Query Dialog */}
      <InputDialog
        isOpen={harvestDialog}
        title="Harvest More Content"
        placeholder="Enter search query..."
        defaultValue=""
        onSubmit={handleHarvestDialogSubmit}
        onCancel={() => setHarvestDialog(false)}
      />

      {/* Create Chapter Dialog */}
      <InputDialog
        isOpen={chapterDialog.isOpen}
        title="Create New Chapter"
        placeholder="Chapter title..."
        defaultValue={chapterDialog.defaultTitle}
        onSubmit={handleChapterDialogSubmit}
        onCancel={() => setChapterDialog({ isOpen: false, defaultTitle: '' })}
      />
    </div>
  )
}

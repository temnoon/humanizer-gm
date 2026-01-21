/**
 * AssignmentModal - Review and confirm AI-suggested chapter assignments
 *
 * Displays the Curator agent's assignment proposals and allows users to:
 * - Review each proposed assignment with confidence scores
 * - Accept/reject individual assignments
 * - Apply all accepted assignments at once
 * - Filter by confidence threshold
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import type { HarvestCard, Chapter, CardAssignmentProposal } from '../../lib/book-studio/types'
import {
  assignCardsToChapters,
  groupProposalsByChapter,
  filterProposalsByConfidence,
} from '../../lib/book-studio/assignment-agent'

// ============================================================================
// Types
// ============================================================================

interface AssignmentModalProps {
  isOpen: boolean
  cards: HarvestCard[]
  chapters: Chapter[]
  onClose: () => void
  onApply: (cardAssignments: Array<{ cardId: string; chapterId: string }>) => Promise<void>
}

interface ProposalWithStatus extends CardAssignmentProposal {
  accepted: boolean
  modified?: string  // Modified chapter ID if user changed it
}

// ============================================================================
// Component
// ============================================================================

export function AssignmentModal({
  isOpen,
  cards,
  chapters,
  onClose,
  onApply,
}: AssignmentModalProps) {
  // State
  const [isLoading, setIsLoading] = useState(false)
  const [proposals, setProposals] = useState<ProposalWithStatus[]>([])
  const [minConfidence, setMinConfidence] = useState(0.5)
  const [error, setError] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)

  // Create lookup maps
  const cardLookup = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])
  const chapterLookup = useMemo(() => new Map(chapters.map(ch => [ch.id, ch])), [chapters])

  // Load assignments when modal opens
  useEffect(() => {
    if (!isOpen || cards.length === 0 || chapters.length === 0) return

    async function loadAssignments() {
      setIsLoading(true)
      setError(null)

      try {
        const result = await assignCardsToChapters({
          cards,
          chapters,
          minConfidence: 0.3, // Get all, filter in UI
        })

        if (result.error) {
          setError(result.error)
        }

        // Add accepted status to each proposal
        setProposals(
          result.batch.proposals.map(p => ({
            ...p,
            accepted: p.confidence >= 0.7, // Auto-accept high confidence
          }))
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate assignments')
      } finally {
        setIsLoading(false)
      }
    }

    loadAssignments()
  }, [isOpen, cards, chapters])

  // Filter proposals by confidence
  const filteredProposals = useMemo(
    () => filterProposalsByConfidence(proposals, minConfidence),
    [proposals, minConfidence]
  )

  // Group by chapter
  const groupedProposals = useMemo(
    () => groupProposalsByChapter(filteredProposals),
    [filteredProposals]
  )

  // Stats
  const acceptedCount = proposals.filter(p => p.accepted).length
  const totalCount = proposals.length

  // Handlers
  const toggleProposal = useCallback((cardId: string) => {
    setProposals(prev =>
      prev.map(p =>
        p.cardId === cardId ? { ...p, accepted: !p.accepted } : p
      )
    )
  }, [])

  const changeProposalChapter = useCallback((cardId: string, newChapterId: string) => {
    setProposals(prev =>
      prev.map(p =>
        p.cardId === cardId
          ? { ...p, modified: newChapterId, accepted: true }
          : p
      )
    )
  }, [])

  const acceptAll = useCallback(() => {
    setProposals(prev => prev.map(p => ({ ...p, accepted: true })))
  }, [])

  const rejectAll = useCallback(() => {
    setProposals(prev => prev.map(p => ({ ...p, accepted: false })))
  }, [])

  const handleApply = useCallback(async () => {
    const acceptedProposals = proposals.filter(p => p.accepted)
    if (acceptedProposals.length === 0) {
      onClose()
      return
    }

    setIsApplying(true)
    try {
      const assignments = acceptedProposals.map(p => ({
        cardId: p.cardId,
        chapterId: p.modified || p.suggestedChapterId,
      }))
      await onApply(assignments)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply assignments')
    } finally {
      setIsApplying(false)
    }
  }, [proposals, onApply, onClose])

  if (!isOpen) return null

  // Render confidence badge
  const renderConfidenceBadge = (confidence: number) => {
    const level = confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low'
    return (
      <span className={`assignment-modal__confidence assignment-modal__confidence--${level}`}>
        {Math.round(confidence * 100)}%
      </span>
    )
  }

  return (
    <div className="assignment-modal__overlay" onClick={onClose}>
      <div className="assignment-modal" onClick={(e) => e.stopPropagation()}>
        <div className="assignment-modal__header">
          <h2 className="assignment-modal__title">AI Chapter Assignments</h2>
          <button className="assignment-modal__close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="assignment-modal__controls">
          <div className="assignment-modal__confidence-filter">
            <label>
              Min confidence:
              <input
                type="range"
                min="0"
                max="100"
                value={minConfidence * 100}
                onChange={(e) => setMinConfidence(Number(e.target.value) / 100)}
              />
              <span>{Math.round(minConfidence * 100)}%</span>
            </label>
          </div>
          <div className="assignment-modal__bulk-actions">
            <button onClick={acceptAll} className="assignment-modal__bulk-btn">
              Accept All
            </button>
            <button onClick={rejectAll} className="assignment-modal__bulk-btn">
              Reject All
            </button>
          </div>
        </div>

        <div className="assignment-modal__content">
          {isLoading ? (
            <div className="assignment-modal__loading">
              <div className="assignment-modal__spinner" />
              <p>Analyzing cards and suggesting assignments...</p>
            </div>
          ) : error ? (
            <div className="assignment-modal__error">
              <p>{error}</p>
            </div>
          ) : filteredProposals.length === 0 ? (
            <div className="assignment-modal__empty">
              <p>No assignments found above confidence threshold.</p>
              <p>Try lowering the minimum confidence or adding more chapters.</p>
            </div>
          ) : (
            <div className="assignment-modal__proposals">
              {Array.from(groupedProposals.entries()).map(([chapterId, chapterProposals]) => {
                const chapter = chapterLookup.get(chapterId)
                if (!chapter) return null

                return (
                  <div key={chapterId} className="assignment-modal__chapter-group">
                    <div className="assignment-modal__chapter-header">
                      <h3>{chapter.title}</h3>
                      <span className="assignment-modal__chapter-count">
                        {chapterProposals.length} cards
                      </span>
                    </div>
                    <div className="assignment-modal__chapter-cards">
                      {chapterProposals.map((proposal) => {
                        const card = cardLookup.get(proposal.cardId)
                        if (!card) return null

                        const proposalWithStatus = proposals.find(p => p.cardId === proposal.cardId)
                        if (!proposalWithStatus) return null

                        const effectiveChapterId = proposalWithStatus.modified || proposal.suggestedChapterId

                        return (
                          <div
                            key={proposal.cardId}
                            className={`assignment-modal__card ${proposalWithStatus.accepted ? 'assignment-modal__card--accepted' : 'assignment-modal__card--rejected'}`}
                          >
                            <label className="assignment-modal__card-checkbox">
                              <input
                                type="checkbox"
                                checked={proposalWithStatus.accepted}
                                onChange={() => toggleProposal(proposal.cardId)}
                              />
                            </label>
                            <div className="assignment-modal__card-content">
                              <div className="assignment-modal__card-preview">
                                {card.title || card.content.substring(0, 100)}
                                {!card.title && card.content.length > 100 && '...'}
                              </div>
                              <div className="assignment-modal__card-meta">
                                {renderConfidenceBadge(proposal.confidence)}
                                <span className="assignment-modal__card-reasoning">
                                  {proposal.reasoning}
                                </span>
                              </div>
                            </div>
                            <select
                              className="assignment-modal__card-chapter"
                              value={effectiveChapterId}
                              onChange={(e) => changeProposalChapter(proposal.cardId, e.target.value)}
                            >
                              {chapters.map((ch) => (
                                <option key={ch.id} value={ch.id}>
                                  {ch.title}
                                </option>
                              ))}
                            </select>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="assignment-modal__footer">
          <div className="assignment-modal__stats">
            {acceptedCount} of {totalCount} assignments accepted
          </div>
          <div className="assignment-modal__actions">
            <button
              className="assignment-modal__btn assignment-modal__btn--cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="assignment-modal__btn assignment-modal__btn--apply"
              onClick={handleApply}
              disabled={isApplying || acceptedCount === 0}
            >
              {isApplying ? 'Applying...' : `Apply ${acceptedCount} Assignments`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AssignmentModal

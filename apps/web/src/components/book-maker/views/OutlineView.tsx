/**
 * OutlineView - Generate and manage book outline
 *
 * Features:
 * - Research staging cards for themes
 * - Generate outline suggestions
 * - Preview and edit outline structure
 * - Create chapters from outline
 */

import { useState, useCallback } from 'react'
import { useBookStudio } from '../../../lib/book-studio/BookStudioProvider'

export function OutlineView() {
  const bookStudio = useBookStudio()
  const [isGenerating, setIsGenerating] = useState(false)

  const { state: outlineState } = bookStudio.outline
  const book = bookStudio.activeBook
  const cardCount = book?.stagingCards?.length || 0
  const chapterCount = book?.chapters?.length || 0

  // Run research phase
  const handleResearch = useCallback(async () => {
    setIsGenerating(true)
    try {
      await bookStudio.outline.research()
    } catch (error) {
      console.error('Research failed:', error)
    } finally {
      setIsGenerating(false)
    }
  }, [bookStudio.outline])

  // Generate outline
  const handleGenerate = useCallback(async () => {
    setIsGenerating(true)
    try {
      await bookStudio.outline.generate({
        maxSections: Math.max(5, Math.ceil(cardCount / 8)),
        preferArcStructure: true,
      })
    } catch (error) {
      console.error('Generation failed:', error)
    } finally {
      setIsGenerating(false)
    }
  }, [bookStudio.outline, cardCount])

  // Create chapters from generated outline
  const handleCreateChapters = useCallback(async () => {
    if (!outlineState.generatedOutline) return

    const items = outlineState.generatedOutline.structure.items
    for (const item of items) {
      await bookStudio.actions.createChapter(item.text)
    }

    // Clear generated outline after creating
    bookStudio.outline.clear()
  }, [outlineState.generatedOutline, bookStudio.actions, bookStudio.outline])

  return (
    <div className="outline-view">
      <div className="outline-view__header">
        <h2 className="outline-view__title">Book Outline</h2>
        <div className="outline-view__stats">
          <span>{cardCount} cards in staging</span>
          <span>{chapterCount} chapters created</span>
        </div>
      </div>

      {cardCount === 0 ? (
        <div className="outline-view__empty">
          <div className="outline-view__empty-icon">📋</div>
          <h3>No cards to outline</h3>
          <p>Harvest some content first, then generate an outline.</p>
        </div>
      ) : (
        <div className="outline-view__content">
          {/* Research section */}
          <section className="outline-view__section">
            <h3 className="outline-view__section-title">1. Research</h3>
            <p className="outline-view__section-desc">
              Analyze your staging cards to identify themes and connections.
            </p>

            {outlineState.research ? (
              <div className="outline-view__research-results">
                <div className="outline-view__research-item">
                  <span className="outline-view__research-label">Themes identified:</span>
                  <span className="outline-view__research-value">
                    {outlineState.research.themes?.length || 0}
                  </span>
                </div>
                <div className="outline-view__research-item">
                  <span className="outline-view__research-label">Suggested sections:</span>
                  <span className="outline-view__research-value">
                    {outlineState.research.suggestedSections?.length || 0}
                  </span>
                </div>
                {outlineState.research.themes && (
                  <div className="outline-view__themes">
                    {outlineState.research.themes.slice(0, 6).map((theme, i) => (
                      <span key={i} className="outline-view__theme-tag">{theme.name}</span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button
                className="outline-view__action-btn"
                onClick={handleResearch}
                disabled={isGenerating || outlineState.isResearching}
              >
                {outlineState.isResearching ? 'Researching...' : 'Analyze Cards'}
              </button>
            )}
          </section>

          {/* Generate section */}
          <section className="outline-view__section">
            <h3 className="outline-view__section-title">2. Generate Outline</h3>
            <p className="outline-view__section-desc">
              Create a suggested chapter structure based on your content.
            </p>

            {outlineState.generatedOutline ? (
              <div className="outline-view__generated">
                <div className="outline-view__generated-header">
                  <span className="outline-view__generated-title">
                    Generated {outlineState.generatedOutline.structure.items.length} sections
                  </span>
                  <div className="outline-view__generated-actions">
                    <button
                      className="outline-view__action-btn outline-view__action-btn--primary"
                      onClick={handleCreateChapters}
                    >
                      Create Chapters
                    </button>
                    <button
                      className="outline-view__action-btn"
                      onClick={handleGenerate}
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
                <div className="outline-view__chapters-preview">
                  {outlineState.generatedOutline.structure.items.map((item, idx) => {
                    const cardIds = outlineState.generatedOutline?.itemCardAssignments.get(`${idx}`)
                    return (
                      <div key={idx} className="outline-view__chapter-item">
                        <span className="outline-view__chapter-number">{idx + 1}.</span>
                        <span className="outline-view__chapter-title">{item.text}</span>
                        {cardIds && cardIds.length > 0 && (
                          <span className="outline-view__chapter-cards">
                            {cardIds.length} cards
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <button
                className="outline-view__action-btn"
                onClick={handleGenerate}
                disabled={isGenerating || outlineState.isGenerating || !outlineState.research}
              >
                {outlineState.isGenerating ? 'Generating...' : 'Generate Outline'}
              </button>
            )}
          </section>

          {/* Existing chapters */}
          {chapterCount > 0 && (
            <section className="outline-view__section">
              <h3 className="outline-view__section-title">Current Chapters</h3>
              <div className="outline-view__existing-chapters">
                {book?.chapters.map((chapter, idx) => (
                  <div key={chapter.id} className="outline-view__existing-chapter">
                    <span className="outline-view__chapter-number">{idx + 1}.</span>
                    <span className="outline-view__chapter-title">{chapter.title}</span>
                    <span className="outline-view__chapter-meta">
                      {chapter.cards.length} cards · {chapter.wordCount} words
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {outlineState.error && (
            <div className="outline-view__error">
              Error: {outlineState.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

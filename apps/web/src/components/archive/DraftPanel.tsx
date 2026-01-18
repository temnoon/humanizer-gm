/**
 * Draft Panel Component
 *
 * UI for draft generation:
 * - Chapter selection
 * - Model/temperature controls
 * - Generation progress indicator
 * - Draft preview
 *
 * WCAG 2.1 AA compliant (44px touch targets, focus indicators)
 */

import {
  memo,
  useState,
  useCallback,
  type ChangeEvent,
} from 'react'
import { useBookStudio, type DraftGenerationConfig } from '../../lib/book-studio/BookStudioProvider'
import type { Chapter } from '../../lib/book-studio/types'

// ============================================================================
// Types
// ============================================================================

export interface DraftPanelProps {
  chapter?: Chapter
  onDraftComplete?: (content: string) => void
  className?: string
}

// ============================================================================
// Constants
// ============================================================================

const AVAILABLE_MODELS = [
  { id: 'llama3.2', name: 'Llama 3.2 (Default)' },
  { id: 'llama3.1', name: 'Llama 3.1' },
  { id: 'mistral', name: 'Mistral' },
  { id: 'mixtral', name: 'Mixtral' },
]

const WORD_COUNT_OPTIONS = [
  { value: 500, label: '500 words' },
  { value: 1000, label: '1,000 words' },
  { value: 1500, label: '1,500 words' },
  { value: 2000, label: '2,000 words' },
  { value: 3000, label: '3,000 words' },
]

// ============================================================================
// Sub-components
// ============================================================================

interface ProgressDisplayProps {
  phase: string
  sectionsTotal: number
  sectionsComplete: number
  wordsGenerated: number
  message: string
}

const ProgressDisplay = memo(function ProgressDisplay({
  phase,
  sectionsTotal,
  sectionsComplete,
  wordsGenerated,
  message,
}: ProgressDisplayProps) {
  const progress = sectionsTotal > 0 ? (sectionsComplete / sectionsTotal) * 100 : 0

  // Phase indicator steps
  const phases = ['preparing', 'generating', 'refining', 'complete']
  const currentPhaseIndex = phases.indexOf(phase)

  return (
    <div className="operation-status operation-status--active">
      <div className="operation-status__header">
        <span className="operation-status__title">{message}</span>
        <span className="operation-status__badge operation-status__badge--running">
          {phase === 'complete' ? 'Complete' : 'Generating'}
        </span>
      </div>

      {/* Step indicator */}
      <div className="step-indicator">
        {phases.map((p, i) => (
          <div
            key={p}
            className={`step-indicator__step ${
              i < currentPhaseIndex
                ? 'step-indicator__step--complete'
                : i === currentPhaseIndex
                ? 'step-indicator__step--active'
                : ''
            }`}
          />
        ))}
      </div>

      {/* Progress bar */}
      {sectionsTotal > 0 && (
        <div className="progress-bar" style={{ marginTop: '0.5rem' }}>
          <div className="progress-bar__track">
            <div
              className="progress-bar__fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="progress-bar__text">
            {sectionsComplete}/{sectionsTotal}
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="operation-status__details">
        {wordsGenerated > 0 && (
          <span>{wordsGenerated.toLocaleString()} words generated</span>
        )}
      </div>
    </div>
  )
})

// ============================================================================
// Main Component
// ============================================================================

export const DraftPanel = memo(function DraftPanel({
  chapter,
  onDraftComplete,
  className = '',
}: DraftPanelProps) {
  const { activeBook, draft } = useBookStudio()
  const { state, generate, cancel } = draft

  // Config state
  const [config, setConfig] = useState<DraftGenerationConfig>({
    model: 'llama3.2',
    temperature: 0.7,
    targetWordCount: 1500,
    preserveVoice: true,
    includeTransitions: true,
  })

  // Handle config changes
  const handleModelChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setConfig(prev => ({ ...prev, model: e.target.value }))
  }, [])

  const handleWordCountChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setConfig(prev => ({ ...prev, targetWordCount: parseInt(e.target.value, 10) }))
  }, [])

  const handleTemperatureChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setConfig(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))
  }, [])

  // Handle generate action
  const handleGenerate = useCallback(async () => {
    if (!chapter) return

    try {
      const content = await generate(chapter, config)
      onDraftComplete?.(content)
    } catch (err) {
      console.error('[DraftPanel] Generation failed:', err)
    }
  }, [chapter, config, generate, onDraftComplete])

  // Handle cancel action
  const handleCancel = useCallback(() => {
    cancel()
  }, [cancel])

  // Get assigned cards for chapter
  const chapterCards = chapter && activeBook
    ? activeBook.stagingCards.filter(
        card => card.suggestedChapterId === chapter.id || chapter.cards.includes(card.id)
      )
    : []

  // Check if we can generate
  const canGenerate = chapter && chapterCards.length > 0 && !state.isGenerating

  return (
    <div className={`draft-panel ${className}`}>
      {/* Header */}
      <div className="draft-panel__header">
        <h3 className="outline-panel__title">
          {chapter ? `Draft: ${chapter.title}` : 'Draft Generator'}
        </h3>
        <div className="draft-panel__controls">
          {state.isGenerating ? (
            <button
              className="card-canvas__view-btn"
              onClick={handleCancel}
            >
              Cancel
            </button>
          ) : (
            <button
              className="draft-panel__generate-btn"
              onClick={handleGenerate}
              disabled={!canGenerate}
              title={!canGenerate ? 'Select a chapter with assigned cards' : 'Generate draft'}
            >
              Generate Draft
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="draft-panel__content">
        {/* Error state */}
        {state.error && (
          <div className="operation-status operation-status--error">
            <div className="operation-status__header">
              <span className="operation-status__title">Error</span>
            </div>
            <div className="operation-status__details">{state.error}</div>
          </div>
        )}

        {/* Progress state */}
        {state.isGenerating && state.progress && (
          <ProgressDisplay
            phase={state.progress.phase}
            sectionsTotal={state.progress.sectionsTotal}
            sectionsComplete={state.progress.sectionsComplete}
            wordsGenerated={state.progress.wordsGenerated}
            message={state.progress.message}
          />
        )}

        {/* No chapter selected */}
        {!chapter && !state.isGenerating && (
          <div className="card-canvas__empty">
            <span className="card-canvas__empty-icon" role="img" aria-hidden>
              📄
            </span>
            <p className="card-canvas__empty-text">No chapter selected</p>
            <span className="card-canvas__empty-hint">
              Select a chapter from the Drafts tab to generate content
            </span>
          </div>
        )}

        {/* Chapter info and config */}
        {chapter && !state.isGenerating && (
          <>
            {/* Chapter summary */}
            <div className="outline-panel__research">
              <h4 className="outline-panel__research-title">{chapter.title}</h4>
              <div className="outline-panel__research-stats">
                <span className="outline-panel__research-stat">
                  <strong>{chapterCards.length}</strong> cards assigned
                </span>
                {chapter.wordCount && chapter.wordCount > 0 && (
                  <span className="outline-panel__research-stat">
                    <strong>{chapter.wordCount.toLocaleString()}</strong> words existing
                  </span>
                )}
              </div>
              {chapterCards.length === 0 && (
                <div style={{ marginTop: '0.5rem', color: 'var(--color-warning)' }}>
                  No cards assigned. Assign cards to this chapter first.
                </div>
              )}
            </div>

            {/* Generation config */}
            {chapterCards.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h4 className="outline-panel__research-title">Generation Settings</h4>

                {/* Model selection */}
                <div style={{ marginBottom: '1rem' }}>
                  <label
                    htmlFor="model-select"
                    style={{
                      display: 'block',
                      fontSize: '0.75rem',
                      color: 'var(--color-text-secondary)',
                      marginBottom: '0.25rem',
                    }}
                  >
                    Model
                  </label>
                  <select
                    id="model-select"
                    className="draft-panel__model-select"
                    value={config.model}
                    onChange={handleModelChange}
                    style={{ width: '100%' }}
                  >
                    {AVAILABLE_MODELS.map(model => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Word count */}
                <div style={{ marginBottom: '1rem' }}>
                  <label
                    htmlFor="wordcount-select"
                    style={{
                      display: 'block',
                      fontSize: '0.75rem',
                      color: 'var(--color-text-secondary)',
                      marginBottom: '0.25rem',
                    }}
                  >
                    Target Length
                  </label>
                  <select
                    id="wordcount-select"
                    className="draft-panel__model-select"
                    value={config.targetWordCount}
                    onChange={handleWordCountChange}
                    style={{ width: '100%' }}
                  >
                    {WORD_COUNT_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Temperature slider */}
                <div style={{ marginBottom: '1rem' }}>
                  <label
                    htmlFor="temperature-slider"
                    style={{
                      display: 'block',
                      fontSize: '0.75rem',
                      color: 'var(--color-text-secondary)',
                      marginBottom: '0.25rem',
                    }}
                  >
                    Creativity: {config.temperature?.toFixed(1)}
                  </label>
                  <input
                    id="temperature-slider"
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.1"
                    value={config.temperature}
                    onChange={handleTemperatureChange}
                    style={{ width: '100%' }}
                  />
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.625rem',
                      color: 'var(--color-text-tertiary)',
                    }}
                  >
                    <span>Focused</span>
                    <span>Creative</span>
                  </div>
                </div>

                {/* Draft instructions */}
                {chapter.draftInstructions && (
                  <div style={{ marginTop: '1rem' }}>
                    <h4 className="outline-panel__research-title">Instructions</h4>
                    <p
                      style={{
                        fontSize: '0.875rem',
                        color: 'var(--color-text-secondary)',
                        fontStyle: 'italic',
                      }}
                    >
                      {chapter.draftInstructions}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Existing content preview */}
            {chapter.content && chapter.content.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h4 className="outline-panel__research-title">Existing Content</h4>
                <div
                  className="draft-preview"
                  style={{
                    maxHeight: '200px',
                    overflow: 'auto',
                    padding: '0.5rem',
                    background: 'var(--color-bg-hover)',
                    borderRadius: '4px',
                  }}
                >
                  <p>{chapter.content.slice(0, 500)}...</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})

export default DraftPanel

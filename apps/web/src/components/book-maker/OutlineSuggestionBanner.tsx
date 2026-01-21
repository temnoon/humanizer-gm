/**
 * OutlineSuggestionBanner - Prompt to generate an outline when cards exist but no chapters
 *
 * Shows after harvest completes when:
 * - Book has harvested cards (>= minCards threshold)
 * - Book has no chapters defined yet
 * - User hasn't dismissed the banner
 */

import { useState, useCallback } from 'react'

// ============================================================================
// Types
// ============================================================================

interface OutlineSuggestionBannerProps {
  cardCount: number
  onGenerateOutline: () => void
  onDismiss: () => void
}

// ============================================================================
// Component
// ============================================================================

export function OutlineSuggestionBanner({
  cardCount,
  onGenerateOutline,
  onDismiss,
}: OutlineSuggestionBannerProps) {
  const [isLoading, setIsLoading] = useState(false)

  const handleGenerate = useCallback(async () => {
    setIsLoading(true)
    try {
      await onGenerateOutline()
    } finally {
      setIsLoading(false)
    }
  }, [onGenerateOutline])

  return (
    <div className="outline-suggestion-banner">
      <div className="outline-suggestion-banner__icon">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </div>
      <div className="outline-suggestion-banner__content">
        <p className="outline-suggestion-banner__message">
          You have <strong>{cardCount} cards</strong> but no chapters yet.
          Generate an outline to organize your content?
        </p>
        <p className="outline-suggestion-banner__hint">
          The outline agent will analyze your cards and suggest chapters based on themes and narrative structure.
        </p>
      </div>
      <div className="outline-suggestion-banner__actions">
        <button
          className="outline-suggestion-banner__btn outline-suggestion-banner__btn--primary"
          onClick={handleGenerate}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <span className="outline-suggestion-banner__spinner" />
              Generating...
            </>
          ) : (
            'Generate Outline'
          )}
        </button>
        <button
          className="outline-suggestion-banner__btn outline-suggestion-banner__btn--secondary"
          onClick={onDismiss}
          disabled={isLoading}
        >
          Skip
        </button>
      </div>
    </div>
  )
}

export default OutlineSuggestionBanner

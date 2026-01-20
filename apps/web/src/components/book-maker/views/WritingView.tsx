/**
 * WritingView - Compose and edit chapter content
 *
 * Features:
 * - Select chapter to write
 * - Reference cards sidebar
 * - Markdown editor with preview
 * - AI draft generation
 * - Word count tracking
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useBookStudio } from '../../../lib/book-studio/BookStudioProvider'

type ViewMode = 'write' | 'preview'

export function WritingView() {
  const bookStudio = useBookStudio()
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('write')
  const [showCards, setShowCards] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [showInstructions, setShowInstructions] = useState(false)
  const [showNoCardsWarning, setShowNoCardsWarning] = useState(false)
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const book = bookStudio.activeBook
  const chapters = book?.chapters || []
  const cards = book?.stagingCards || []

  const selectedChapter = chapters.find((ch) => ch.id === selectedChapterId)
  const chapterCards = cards.filter((card) => card.suggestedChapterId === selectedChapterId)

  // Draft generation state
  const { state: draftState } = bookStudio.draft

  // Initialize content when chapter changes
  useEffect(() => {
    if (selectedChapter) {
      setContent(selectedChapter.content || '')
      setInstructions(selectedChapter.draftInstructions || '')
    }
  }, [selectedChapter])

  // Auto-save content (debounced)
  useEffect(() => {
    if (!selectedChapterId) return

    const timeout = setTimeout(() => {
      const wordCount = content.trim().split(/\s+/).filter(Boolean).length
      bookStudio.actions.updateChapter(selectedChapterId, {
        content,
        wordCount,
      })
    }, 1000)

    return () => clearTimeout(timeout)
  }, [content, selectedChapterId, bookStudio.actions])

  // Save instructions
  const handleSaveInstructions = useCallback(() => {
    if (selectedChapterId && instructions !== selectedChapter?.draftInstructions) {
      bookStudio.actions.updateChapter(selectedChapterId, { draftInstructions: instructions })
    }
  }, [selectedChapterId, instructions, selectedChapter, bookStudio.actions])

  // Generate draft - step 1: check preconditions
  const handleGenerateDraft = useCallback(() => {
    if (!selectedChapter) return

    if (chapterCards.length === 0) {
      setShowNoCardsWarning(true)
      return
    }

    if (content.trim()) {
      setShowReplaceConfirm(true)
      return
    }

    // No content, generate directly
    doGenerateDraft()
  }, [selectedChapter, chapterCards, content])

  // Generate draft - step 2: actually generate
  const doGenerateDraft = useCallback(async () => {
    if (!selectedChapter) return

    setShowReplaceConfirm(false)
    try {
      const draft = await bookStudio.draft.generate(selectedChapter, {
        targetWordCount: 1500,
        preserveVoice: true,
        includeTransitions: true,
      })
      setContent(draft)
    } catch (error) {
      console.error('Draft generation failed:', error)
    }
  }, [selectedChapter, bookStudio.draft])

  // Insert card content at cursor
  const insertCardContent = useCallback((cardContent: string) => {
    const insertion = `\n\n${cardContent}\n\n`
    const textarea = textareaRef.current

    if (textarea) {
      const start = textarea.selectionStart
      const newContent = content.slice(0, start) + insertion + content.slice(start)
      setContent(newContent)
      setTimeout(() => {
        textarea.selectionStart = start + insertion.length
        textarea.selectionEnd = start + insertion.length
        textarea.focus()
      }, 0)
    } else {
      setContent(content + insertion)
    }
    setShowCards(false)
    setViewMode('write')
  }, [content])

  // Format markdown helpers
  const insertMarkdown = useCallback((prefix: string, suffix: string = prefix) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = content.slice(start, end)
    const newContent = content.slice(0, start) + prefix + selectedText + suffix + content.slice(end)

    setContent(newContent)
    setViewMode('write')

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = start + prefix.length
        textareaRef.current.selectionEnd = start + prefix.length + selectedText.length
        textareaRef.current.focus()
      }
    }, 0)
  }, [content])

  // Simple markdown renderer
  const renderMarkdown = (text: string): string => {
    return text
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>')
  }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length

  // No chapter selected
  if (!selectedChapterId) {
    return (
      <div className="writing-view">
        <div className="writing-view__chapter-selector">
          <h2>Select a Chapter to Write</h2>
          {chapters.length === 0 ? (
            <div className="writing-view__no-chapters">
              <p>No chapters yet. Create chapters in the Chapters view.</p>
            </div>
          ) : (
            <div className="writing-view__chapter-list">
              {chapters
                .sort((a, b) => a.order - b.order)
                .map((chapter, idx) => {
                  const cards = bookStudio.activeBook?.stagingCards.filter(
                    (c) => c.suggestedChapterId === chapter.id
                  ) || []
                  return (
                    <button
                      key={chapter.id}
                      className="writing-view__chapter-btn"
                      onClick={() => setSelectedChapterId(chapter.id)}
                    >
                      <span className="writing-view__chapter-num">{idx + 1}.</span>
                      <span className="writing-view__chapter-title">{chapter.title}</span>
                      <span className="writing-view__chapter-meta">
                        {cards.length} cards · {chapter.wordCount} words
                      </span>
                    </button>
                  )
                })}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`writing-view ${draftState.isGenerating ? 'writing-view--generating' : ''}`}>
      {/* Cards sidebar */}
      {showCards && chapterCards.length > 0 && (
        <div className="writing-view__cards-panel">
          <div className="writing-view__cards-header">
            <span>Chapter Cards ({chapterCards.length})</span>
            <button onClick={() => setShowCards(false)}>×</button>
          </div>
          <div className="writing-view__cards-list">
            {chapterCards.map((card) => (
              <button
                key={card.id}
                className="writing-view__card-item"
                onClick={() => insertCardContent(card.content)}
              >
                <div className="writing-view__card-preview">
                  {card.content.length > 100 ? card.content.slice(0, 100) + '...' : card.content}
                </div>
                {card.userNotes && (
                  <div className="writing-view__card-note">📌 {card.userNotes}</div>
                )}
                <div className="writing-view__card-action">Click to insert</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main editor */}
      <div className="writing-view__main">
        {/* Toolbar */}
        <div className="writing-view__toolbar">
          <button
            className="writing-view__back-btn"
            onClick={() => setSelectedChapterId(null)}
          >
            ← Chapters
          </button>

          <div className="writing-view__format-buttons">
            <button onClick={() => insertMarkdown('**')} title="Bold">
              <strong>B</strong>
            </button>
            <button onClick={() => insertMarkdown('*')} title="Italic">
              <em>I</em>
            </button>
            <button onClick={() => insertMarkdown('# ', '\n')} title="Heading">
              H1
            </button>
            <button onClick={() => insertMarkdown('## ', '\n')} title="Subheading">
              H2
            </button>
            <button onClick={() => insertMarkdown('> ', '\n')} title="Quote">
              "
            </button>
          </div>

          <div className="writing-view__view-toggle">
            <button
              className={viewMode === 'write' ? 'active' : ''}
              onClick={() => setViewMode('write')}
            >
              Write
            </button>
            <button
              className={viewMode === 'preview' ? 'active' : ''}
              onClick={() => setViewMode('preview')}
            >
              Preview
            </button>
          </div>

          <div className="writing-view__toolbar-right">
            {chapterCards.length > 0 && (
              <>
                <button
                  className="writing-view__cards-toggle"
                  onClick={() => setShowCards(!showCards)}
                >
                  📚 {chapterCards.length}
                </button>
                <button
                  className={`writing-view__instructions-toggle ${instructions ? 'has-instructions' : ''}`}
                  onClick={() => setShowInstructions(!showInstructions)}
                >
                  📝 Instructions
                </button>
                <button
                  className="writing-view__generate-btn"
                  onClick={handleGenerateDraft}
                  disabled={draftState.isGenerating}
                >
                  {draftState.isGenerating
                    ? `✨ ${draftState.progress?.phase || 'Generating'}...`
                    : '✨ Generate Draft'}
                </button>
              </>
            )}
            <span className="writing-view__word-count">{wordCount} words</span>
          </div>
        </div>

        {/* Instructions panel */}
        {showInstructions && (
          <div className="writing-view__instructions-panel">
            <div className="writing-view__instructions-header">
              <span>Draft Instructions</span>
              <button onClick={() => setShowInstructions(false)}>×</button>
            </div>
            <textarea
              className="writing-view__instructions-textarea"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              onBlur={handleSaveInstructions}
              placeholder="Tell the AI how to frame this chapter..."
              rows={3}
            />
          </div>
        )}

        {/* Editor content */}
        <div className="writing-view__content">
          <h1 className="writing-view__chapter-title">{selectedChapter?.title}</h1>

          {viewMode === 'write' ? (
            <textarea
              ref={textareaRef}
              className="writing-view__textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Start writing..."
              spellCheck
            />
          ) : (
            <div
              className="writing-view__preview"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          )}
        </div>
      </div>

      {draftState.error && (
        <div className="writing-view__error">
          Error: {draftState.error}
        </div>
      )}

      {/* No Cards Warning Dialog */}
      {showNoCardsWarning && (
        <div className="writing-view__dialog-overlay">
          <div className="writing-view__dialog">
            <h3>No Cards Assigned</h3>
            <p>This chapter has no cards assigned to it.</p>
            <p className="writing-view__dialog-hint">
              Go to the Staging view to assign cards to chapters.
            </p>
            <div className="writing-view__dialog-actions">
              <button
                className="writing-view__dialog-btn"
                onClick={() => setShowNoCardsWarning(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace Content Confirm Dialog */}
      {showReplaceConfirm && (
        <div className="writing-view__dialog-overlay">
          <div className="writing-view__dialog">
            <h3>Replace Content?</h3>
            <p>This will replace your current content with a generated draft.</p>
            <div className="writing-view__dialog-actions">
              <button
                className="writing-view__dialog-btn"
                onClick={() => setShowReplaceConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="writing-view__dialog-btn writing-view__dialog-btn--primary"
                onClick={doGenerateDraft}
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

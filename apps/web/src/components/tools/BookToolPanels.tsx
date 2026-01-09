/**
 * Book Tool Panels - Tool panels for book-related operations
 *
 * Components:
 * - ArcToolPanel - Trace narrative arcs through archive
 * - ThreadsToolPanel - Discover thematic threads
 * - ChaptersToolPanel - Manage book chapters
 * - PersonaToolPanel - Extract and apply personas
 *
 * Extracted from Studio.tsx during modularization
 */

import { useState } from 'react';
import { useBookshelf, type DraftChapter } from '../../lib/bookshelf';
import { buildAUIContext, executeTool } from '../../lib/aui';

// Helper to extract text from ContentItem | ContentItem[] | null
export function getContentText(content: { text: string } | { text: string }[] | null): string | null {
  if (!content) return null;
  if (Array.isArray(content)) {
    return content.map(c => c.text).join('\n\n');
  }
  return content.text;
}

interface ArcToolPanelProps {
  activeContent: string | null;
  bookUri: string | null;
}

export function ArcToolPanel({ activeContent, bookUri }: ArcToolPanelProps) {
  const [theme, setTheme] = useState('');
  const [arcType, setArcType] = useState<'progressive' | 'chronological' | 'thematic' | 'dialectic'>('progressive');
  const [isTracing, setIsTracing] = useState(false);
  const [saveToHarvest, setSaveToHarvest] = useState(false);
  const [result, setResult] = useState<{
    message: string;
    phases?: Array<{ phase: string; count: number; samples?: Array<{ preview: string; source?: string }> }>;
    teaching?: { whatHappened: string; why?: string };
  } | null>(null);

  // Get contexts for tool execution
  const bookshelf = useBookshelf();

  const handleTrace = async () => {
    if (!theme.trim()) return;

    setIsTracing(true);
    setResult(null);

    try {
      // Build AUI context from bookshelf (BookContext deprecated)
      const context = buildAUIContext(null, bookshelf);

      // Execute the trace_arc tool
      const toolResult = await executeTool(
        {
          name: 'trace_arc',
          params: {
            theme,
            arc_type: arcType,
            save_to_harvest: saveToHarvest,
            limit: 20,
          },
          raw: '',
        },
        context
      );

      if (toolResult.success && toolResult.data) {
        const data = toolResult.data as { phases?: { phase: string; count: number; samples?: { preview: string; source?: string }[] }[] };
        setResult({
          message: toolResult.message || `Traced "${theme}" arc`,
          phases: data.phases,
          teaching: toolResult.teaching,
        });
      } else {
        setResult({
          message: toolResult.error || 'Failed to trace arc',
        });
      }
    } catch (e) {
      setResult({ message: `Error: ${e instanceof Error ? e.message : 'Failed to trace arc'}` });
    } finally {
      setIsTracing(false);
    }
  };

  return (
    <div className="tool-panel">
      <div className="tool-panel__header">
        <h3>Trace Arc</h3>
        <span className="tool-panel__subtitle">Find how a theme evolved through your archive</span>
      </div>
      <div className="tool-panel__body">
        <div className="tool-panel__field">
          <label className="tool-panel__label">Theme to trace</label>
          <input
            type="text"
            className="tool-panel__input"
            placeholder="e.g., consciousness, meditation, writing..."
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          />
        </div>

        <div className="tool-panel__field">
          <label className="tool-panel__label">Arc type</label>
          <div className="tool-panel__radio-group">
            {[
              { value: 'progressive', label: 'Progressive', desc: 'Beginning → Middle → End' },
              { value: 'chronological', label: 'Chronological', desc: 'Ordered by date' },
              { value: 'dialectic', label: 'Dialectic', desc: 'Thesis → Antithesis → Synthesis' },
              { value: 'thematic', label: 'Thematic', desc: 'Variations on theme' },
            ].map(opt => (
              <label key={opt.value} className="tool-panel__radio">
                <input
                  type="radio"
                  name="arcType"
                  value={opt.value}
                  checked={arcType === opt.value}
                  onChange={() => setArcType(opt.value as typeof arcType)}
                />
                <span className="tool-panel__radio-label">{opt.label}</span>
                <span className="tool-panel__radio-desc">{opt.desc}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Save to Harvest checkbox */}
        <div className="tool-panel__field tool-panel__field--inline">
          <label className="tool-panel__checkbox">
            <input
              type="checkbox"
              checked={saveToHarvest}
              onChange={(e) => setSaveToHarvest(e.target.checked)}
            />
            <span>Save results to Harvest bucket</span>
          </label>
        </div>

        <button
          className="tool-panel__button tool-panel__button--primary"
          onClick={handleTrace}
          disabled={isTracing || !theme.trim()}
        >
          {isTracing ? 'Tracing...' : 'Trace Arc'}
        </button>

        {result && (
          <div className="tool-panel__result">
            <p className="tool-panel__result-message">{result.message}</p>

            {result.phases && (
              <div className="tool-panel__phases">
                {result.phases.map((p, i) => (
                  <div key={i} className="tool-panel__phase">
                    <div className="tool-panel__phase-header">
                      <span className="tool-panel__phase-name">{p.phase}</span>
                      <span className="tool-panel__phase-count">{p.count} passages</span>
                    </div>
                    {p.samples && p.samples.length > 0 && (
                      <div className="tool-panel__phase-samples">
                        {p.samples.map((s, j) => (
                          <div key={j} className="tool-panel__phase-sample">
                            <span className="tool-panel__sample-preview">{s.preview}</span>
                            {s.source && <span className="tool-panel__sample-source">— {s.source}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {result.teaching && (
              <div className="tool-panel__teaching">
                <p className="tool-panel__teaching-what">{result.teaching.whatHappened}</p>
                {result.teaching.why && (
                  <p className="tool-panel__teaching-why">{result.teaching.why}</p>
                )}
              </div>
            )}
          </div>
        )}

        {activeContent && (
          <div className="tool-panel__hint">
            <p>Tip: Use the current content as a starting point</p>
            <button
              className="tool-panel__button tool-panel__button--secondary"
              onClick={() => {
                const words = activeContent.split(/\s+/).slice(0, 5).join(' ');
                setTheme(words);
              }}
            >
              Use current text
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ThreadsToolPanelProps {
  bookUri: string | null;
}

export function ThreadsToolPanel({ bookUri }: ThreadsToolPanelProps) {
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [threads, setThreads] = useState<Array<{ theme: string; count: number; coherence: number }>>([]);
  const bookshelf = useBookshelf();

  const handleDiscover = async () => {
    if (!bookUri) return;

    setIsDiscovering(true);

    try {
      // Get passages from active book
      const passages = bookshelf.getPassages(bookUri);

      if (passages.length < 3) {
        setThreads([]);
        return;
      }

      // Simple keyword clustering
      const keywordCounts = new Map<string, number>();
      const commonWords = new Set(['about', 'which', 'their', 'there', 'would', 'could', 'should', 'being', 'having', 'through', 'because', 'while', 'something', 'anything']);

      for (const p of passages) {
        const text = p.text || '';
        const words = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 5 && !commonWords.has(w));
        const seen = new Set<string>();
        for (const w of words) {
          if (!seen.has(w)) {
            keywordCounts.set(w, (keywordCounts.get(w) || 0) + 1);
            seen.add(w);
          }
        }
      }

      // Find themes (keywords in multiple passages)
      const themes = Array.from(keywordCounts.entries())
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([word, count]) => ({
          theme: word,
          count,
          coherence: Math.min(1, count / passages.length),
        }));

      setThreads(themes);
    } catch (e) {
      console.error('Thread discovery failed:', e);
    } finally {
      setIsDiscovering(false);
    }
  };

  return (
    <div className="tool-panel">
      <div className="tool-panel__header">
        <h3>Discover Threads</h3>
        <span className="tool-panel__subtitle">Find thematic patterns in your passages</span>
      </div>
      <div className="tool-panel__body">
        {!bookUri ? (
          <div className="tool-panel__empty">
            <p>No book project active</p>
            <span className="tool-panel__muted">Open a book project in Archive → Books</span>
          </div>
        ) : (
          <>
            <button
              className="tool-panel__button tool-panel__button--primary"
              onClick={handleDiscover}
              disabled={isDiscovering}
            >
              {isDiscovering ? 'Discovering...' : 'Discover Threads'}
            </button>

            {threads.length > 0 && (
              <div className="tool-panel__threads">
                {threads.map((t, i) => (
                  <div key={i} className="tool-panel__thread">
                    <span className="tool-panel__thread-theme">{t.theme}</span>
                    <span className="tool-panel__thread-count">{t.count} passages</span>
                    <div
                      className="tool-panel__thread-bar"
                      style={{ width: `${t.coherence * 100}%` }}
                    />
                  </div>
                ))}
              </div>
            )}

            {threads.length === 0 && !isDiscovering && (
              <div className="tool-panel__empty">
                <p>No threads discovered yet</p>
                <span className="tool-panel__muted">Add passages to your book, then discover patterns</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface ChaptersToolPanelProps {
  bookUri: string | null;
}

export function ChaptersToolPanel({ bookUri }: ChaptersToolPanelProps) {
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ message: string; success: boolean } | null>(null);
  const bookshelf = useBookshelf();
  const book = bookUri ? bookshelf.getBook(bookUri) : null;

  // Active persona for draft generation
  const { activePersona, activePersonaUri } = bookshelf;

  // Count approved passages
  const approvedCount = (book?.passages || []).filter(
    p => p.curation?.status === 'approved' || p.curation?.status === 'gem'
  ).length;

  const handleAddChapter = () => {
    if (!bookUri || !newChapterTitle.trim()) return;

    const existingChapters = book?.chapters || [];
    const chapter: DraftChapter = {
      id: `chapter-${Date.now()}`,
      number: existingChapters.length + 1,
      title: newChapterTitle,
      content: '',
      status: 'drafting',
      version: 1,
      versions: [],
      wordCount: 0,
      sections: [],
      marginalia: [],
      metadata: {
        lastEditedBy: 'user',
        lastEditedAt: Date.now(),
      },
      passageRefs: [],
    };

    bookshelf.addChapter(bookUri, chapter);
    setNewChapterTitle('');
  };

  const handleGenerateDraft = async () => {
    if (!bookUri || approvedCount === 0) return;

    setIsGenerating(true);
    setGenerateResult(null);

    try {
      // Build context (BookContext deprecated - passing null)
      const context = buildAUIContext(null, bookshelf);

      // Execute generate_first_draft tool
      // Pass persona's systemPrompt or description as style
      const personaStyle = activePersona
        ? (activePersona.systemPrompt || activePersona.description || `Write in the voice of ${activePersona.name}`)
        : undefined;

      const result = await executeTool(
        {
          name: 'generate_first_draft',
          params: {
            chapterTitle: newChapterTitle || 'Untitled Chapter',
            use_approved: true,
            style: personaStyle,
          },
          raw: '',
        },
        context
      );

      setGenerateResult({
        message: result.message || (result.success ? 'Draft generated!' : 'Generation failed'),
        success: result.success,
      });

      // Clear title input on success
      if (result.success) {
        setNewChapterTitle('');
      }
    } catch (e) {
      setGenerateResult({
        message: e instanceof Error ? e.message : 'Failed to generate draft',
        success: false,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="tool-panel">
      <div className="tool-panel__header">
        <h3>Chapters</h3>
        <span className="tool-panel__subtitle">Manage book chapters</span>
      </div>
      <div className="tool-panel__body">
        {!bookUri ? (
          <div className="tool-panel__empty">
            <p>No book project active</p>
            <span className="tool-panel__muted">Open a book project in Archive → Books</span>
          </div>
        ) : (
          <>
            <div className="tool-panel__field">
              <label className="tool-panel__label">Add chapter</label>
              <div className="tool-panel__input-group">
                <input
                  type="text"
                  className="tool-panel__input"
                  placeholder="Chapter title..."
                  value={newChapterTitle}
                  onChange={(e) => setNewChapterTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddChapter()}
                />
                <button
                  className="tool-panel__button"
                  onClick={handleAddChapter}
                  disabled={!newChapterTitle.trim()}
                >
                  Add
                </button>
              </div>
            </div>

            {book?.chapters && book.chapters.length > 0 ? (
              <div className="tool-panel__chapters">
                {book.chapters.map((ch, i) => (
                  <div key={ch.id} className="tool-panel__chapter">
                    <span className="tool-panel__chapter-num">{i + 1}</span>
                    <span className="tool-panel__chapter-title">{ch.title}</span>
                    <span className="tool-panel__chapter-words">{ch.wordCount || 0} words</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="tool-panel__empty">
                <p>No chapters yet</p>
                <span className="tool-panel__muted">Add your first chapter above</span>
              </div>
            )}

            <div className="tool-panel__stats">
              <div className="tool-panel__stat">
                <span className="tool-panel__stat-value">{book?.chapters?.length || 0}</span>
                <span className="tool-panel__stat-label">chapters</span>
              </div>
              <div className="tool-panel__stat">
                <span className="tool-panel__stat-value">{approvedCount}</span>
                <span className="tool-panel__stat-label">approved</span>
              </div>
            </div>

            {/* Generate Draft Section */}
            <div className="tool-panel__section">
              <h4 className="tool-panel__section-title">Generate First Draft</h4>
              <p className="tool-panel__muted">
                Use approved passages to generate a chapter draft with AI
              </p>
              {activePersona && (
                <p className="tool-panel__persona-active">
                  Voice: <strong>{activePersona.name}</strong>
                </p>
              )}
              {!activePersona && (
                <p className="tool-panel__hint-text">
                  Select a persona in the Persona panel for voice styling
                </p>
              )}
              <button
                className="tool-panel__button tool-panel__button--primary"
                onClick={handleGenerateDraft}
                disabled={isGenerating || approvedCount === 0}
              >
                {isGenerating ? 'Generating...' : `Generate Draft (${approvedCount} passages)`}
              </button>
              {approvedCount === 0 && (
                <p className="tool-panel__hint-text">
                  Approve some passages first in the Harvest panel
                </p>
              )}
              {generateResult && (
                <div className={`tool-panel__result ${generateResult.success ? '' : 'tool-panel__result--error'}`}>
                  <p>{generateResult.message}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface PersonaToolPanelProps {
  bookUri: string | null;
  activeContent: string | null;
}

export function PersonaToolPanel({ bookUri, activeContent }: PersonaToolPanelProps) {
  const [isExtracting, setIsExtracting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [result, setResult] = useState<{ message: string; success: boolean; persona?: unknown } | null>(null);
  const bookshelf = useBookshelf();

  // Get personas from bookshelf
  const personas = bookshelf.personas || [];

  // Active persona from bookshelf context (shared state)
  const { activePersonaUri, setActivePersonaUri } = bookshelf;

  const handleExtractFromContent = async () => {
    if (!activeContent || activeContent.length < 200) {
      setResult({
        success: false,
        message: 'Need at least 200 characters in workspace to extract persona',
      });
      return;
    }

    setIsExtracting(true);
    setResult(null);

    try {
      const context = buildAUIContext(null, bookshelf);

      const toolResult = await executeTool(
        {
          name: 'extract_persona',
          params: {
            text: activeContent,
            name: manualName || undefined,
          },
          raw: '',
        },
        context
      );

      if (toolResult.success) {
        const data = toolResult.data as { unified?: Parameters<typeof bookshelf.createPersona>[0] } | undefined;
        setResult({
          success: true,
          message: toolResult.message || 'Persona extracted!',
          persona: toolResult.data,
        });

        // Store the persona if unified format available
        if (data?.unified) {
          await bookshelf.createPersona(data.unified);
        }
      } else {
        setResult({
          success: false,
          message: toolResult.error || 'Failed to extract persona',
        });
      }
    } catch (e) {
      setResult({
        success: false,
        message: e instanceof Error ? e.message : 'Failed to extract persona',
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleCreateManual = async () => {
    if (!manualName.trim()) return;

    setIsCreating(true);

    try {
      const now = Date.now();
      const persona = await bookshelf.createPersona({
        id: `persona-${now}`,
        name: manualName,
        author: 'user',
        description: manualDescription || `Custom persona: ${manualName}`,
        createdAt: now,
        updatedAt: now,
        tags: ['custom'],
        voice: {
          selfDescription: manualDescription || '',
          styleNotes: [],
          register: 'conversational',
          emotionalRange: 'neutral',
        },
        vocabulary: {
          preferred: [],
          avoided: [],
        },
        influences: [],
        exemplars: [],
        derivedFrom: [],
      });

      setResult({
        success: true,
        message: `Created persona "${persona.name}"`,
        persona,
      });

      setManualName('');
      setManualDescription('');
    } catch (e) {
      setResult({
        success: false,
        message: e instanceof Error ? e.message : 'Failed to create persona',
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="tool-panel">
      <div className="tool-panel__header">
        <h3>Persona / Voice</h3>
        <span className="tool-panel__subtitle">Create and manage writing voices</span>
      </div>
      <div className="tool-panel__body">
        {/* Existing Personas */}
        <div className="tool-panel__field">
          <label className="tool-panel__label">Available Personas</label>
          {personas.length > 0 ? (
            <div className="tool-panel__persona-list">
              {personas.map(p => (
                <button
                  key={p.uri}
                  className={`tool-panel__persona-item ${activePersonaUri === p.uri ? 'tool-panel__persona-item--active' : ''}`}
                  onClick={() => setActivePersonaUri(p.uri)}
                >
                  <span className="tool-panel__persona-name">{p.name}</span>
                  <span className="tool-panel__persona-desc">{p.description?.slice(0, 50)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="tool-panel__muted">No personas yet. Create one below.</p>
          )}
        </div>

        {/* Extract from content */}
        <div className="tool-panel__section">
          <h4 className="tool-panel__section-title">Extract from Text</h4>
          <p className="tool-panel__muted">
            Analyze text in the workspace to extract voice characteristics
          </p>
          <div className="tool-panel__field">
            <input
              type="text"
              className="tool-panel__input"
              placeholder="Optional name for persona..."
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
            />
          </div>
          <button
            className="tool-panel__button tool-panel__button--primary"
            onClick={handleExtractFromContent}
            disabled={isExtracting || !activeContent || activeContent.length < 200}
          >
            {isExtracting ? 'Extracting...' : 'Extract Persona from Workspace'}
          </button>
          {!activeContent && (
            <p className="tool-panel__hint-text">
              Load some text into the workspace first
            </p>
          )}
        </div>

        {/* Manual creation */}
        <div className="tool-panel__section">
          <h4 className="tool-panel__section-title">Create Manually</h4>
          <div className="tool-panel__field">
            <input
              type="text"
              className="tool-panel__input"
              placeholder="Persona name..."
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
            />
          </div>
          <div className="tool-panel__field">
            <textarea
              className="tool-panel__textarea"
              placeholder="Description of voice, tone, perspective..."
              value={manualDescription}
              onChange={(e) => setManualDescription(e.target.value)}
              rows={3}
            />
          </div>
          <button
            className="tool-panel__button"
            onClick={handleCreateManual}
            disabled={isCreating || !manualName.trim()}
          >
            {isCreating ? 'Creating...' : 'Create Persona'}
          </button>
        </div>

        {/* Result display */}
        {result && (
          <div className={`tool-panel__result ${result.success ? '' : 'tool-panel__result--error'}`}>
            <p>{result.message}</p>
            {!!result.persona && (
              <p className="tool-panel__teaching-why">
                Persona ready for use in draft generation
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

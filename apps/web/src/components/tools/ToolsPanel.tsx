/**
 * ToolsPanel - Photoshop-style tabbed tool interface
 *
 * Features:
 * - Tabbed interface for different tools (humanizer, persona, style, analysis)
 * - Configurable tool visibility
 * - Transform operations with progress and error handling
 * - Sentence-level analysis with quantum density metrics
 *
 * Extracted from Studio.tsx during modularization
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useBuffers, type OperatorDefinition } from '../../lib/buffer';
import {
  humanize,
  transformPersona,
  transformStyle,
  analyzeSentences,
  getPersonas,
  getStyles,
  type HumanizationIntensity,
  type TransformResult,
  type PersonaDefinition,
  type StyleDefinition,
  type SentenceAnalysisResult,
} from '../../lib/transform';
import { useHighlights, useSplitMode } from '../layout';
import { useBookshelf } from '../../lib/bookshelf';
import { TOOL_REGISTRY, loadToolVisibility, saveToolVisibility, type ToolDefinition } from '../../lib/tools';
import { ProfileCardsContainer } from './ProfileCards';
import { HarvestQueuePanel } from './HarvestQueuePanel';
// Book tool panels removed - now integrated in BookMakerModal
import type { SentenceAnalysis } from '../../lib/analysis';
import type { SourcePassage } from '@humanizer/core';

export interface ToolsPanelProps {
  onClose: () => void;
  onTransformComplete?: (original: string, transformed: string, transformType: string) => void;
  onReviewInWorkspace?: (conversationId: string, conversationTitle: string, passage: import('@humanizer/core').SourcePassage) => void;
}

export function ToolsPanel({ onClose: _onClose, onTransformComplete, onReviewInWorkspace }: ToolsPanelProps) {
  const {
    activeContent,
    applyOperator,
    applyPipeline,
    getOperators,
    getPipelines,
    forkBuffer,
    activeBuffer,
    activeNode,
    importText,
  } = useBuffers();

  const operators = getOperators();
  const pipelines = getPipelines();

  // Highlight and split mode hooks for analysis integration
  const { setData: setAnalysisData, setActive: setActiveHighlights, analysisData } = useHighlights();
  const { mode: splitMode, setMode: setSplitMode } = useSplitMode();

  // Bookshelf hook for harvest panel
  const bookshelf = useBookshelf();

  // Tool visibility state
  const [toolVisibility, setToolVisibility] = useState<Record<string, boolean>>(loadToolVisibility);
  const [activeTab, setActiveTab] = useState<string>('humanizer');
  const [filterParams, setFilterParams] = useState({ threshold: 70, comparison: '>' as '>' | '<' | '=' });
  const [_selectParams, _setSelectParams] = useState({ count: 10 });

  // Transform state
  const [isTransforming, setIsTransforming] = useState(false);
  const [transformResult, setTransformResult] = useState<TransformResult | null>(null);
  const [transformError, setTransformError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Humanizer settings
  const [humanizeIntensity, setHumanizeIntensity] = useState<HumanizationIntensity>('moderate');
  const [enableSicAnalysis, setEnableSicAnalysis] = useState(false);

  // Persona settings
  const [selectedPersona, setSelectedPersona] = useState('');
  const [customPersona, setCustomPersona] = useState('');
  const [availablePersonas, setAvailablePersonas] = useState<PersonaDefinition[]>([
    { name: 'Academic', description: 'Scholarly, precise, citation-aware', icon: '📚' },
    { name: 'Conversational', description: 'Friendly, accessible, warm', icon: '💬' },
    { name: 'Technical', description: 'Detailed, systematic, thorough', icon: '⚙️' },
  ]);

  // Style settings
  const [selectedStyle, setSelectedStyle] = useState('');
  const [availableStyles, setAvailableStyles] = useState<StyleDefinition[]>([
    { name: 'Formal', description: 'Professional, polished', icon: '📝' },
    { name: 'Casual', description: 'Relaxed, natural', icon: '✏️' },
    { name: 'Concise', description: 'Tighten, remove fluff', icon: '✂️' },
    { name: 'Elaborate', description: 'Expand, add detail', icon: '📖' },
  ]);

  // Profile visibility (for showing all vs common profiles)
  const [showAllPersonas, setShowAllPersonas] = useState(true);
  const [showAllStyles, setShowAllStyles] = useState(true);

  // Sentencing analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number } | null>(null);
  const [sentenceResults, setSentenceResults] = useState<SentenceAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Load available personas and styles on mount
  useEffect(() => {
    getPersonas()
      .then(setAvailablePersonas)
      .catch((err) => {
        console.error('[ToolsPanel] Failed to load personas:', err);
      });
    getStyles()
      .then(setAvailableStyles)
      .catch((err) => {
        console.error('[ToolsPanel] Failed to load styles:', err);
      });
  }, []);

  // Reset transform/analysis state when content changes
  useEffect(() => {
    setTransformResult(null);
    setTransformError(null);
    setSentenceResults(null);
    setAnalysisError(null);
    setAnalysisProgress(null);
  }, [activeContent]);

  // Cancel transform on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Get visible tools (settings is always visible)
  const visibleTools = TOOL_REGISTRY.filter(tool =>
    tool.id === 'settings' || toolVisibility[tool.id]
  );

  // Toggle tool visibility
  const toggleToolVisibility = (toolId: string) => {
    const newVisibility = { ...toolVisibility, [toolId]: !toolVisibility[toolId] };
    setToolVisibility(newVisibility);
    saveToolVisibility(newVisibility);
  };

  // Group operators by type
  const operatorsByType = operators.reduce((acc, op) => {
    if (!acc[op.type]) acc[op.type] = [];
    acc[op.type].push(op);
    return acc;
  }, {} as Record<string, OperatorDefinition[]>);

  const handleApplyOperator = async (operatorId: string, params?: Record<string, unknown>) => {
    await applyOperator(operatorId, params);
  };

  const handleApplyPipeline = async (pipelineId: string) => {
    await applyPipeline(pipelineId);
  };

  // Content stats
  const items = activeContent
    ? (Array.isArray(activeContent) ? activeContent : [activeContent])
    : [];
  const totalChars = items.reduce((sum, item) => sum + item.text.length, 0);
  const contentText = items.map(i => i.text).join('\n\n');

  // Transform handlers
  const cancelTransform = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsTransforming(false);
    }
  }, []);

  const handleHumanize = useCallback(async () => {
    if (!contentText.trim()) return;

    setIsTransforming(true);
    setTransformError(null);
    setTransformResult(null);

    abortControllerRef.current = new AbortController();

    try {
      const result = await humanize(
        contentText,
        {
          intensity: humanizeIntensity,
          enableSicAnalysis,
          enableLLMPolish: true,
        },
        abortControllerRef.current.signal
      );

      setTransformResult(result);
      // Import the transformed text to buffer
      importText(result.transformed, `Humanized (${humanizeIntensity})`);
      // Trigger split-screen mode to show before/after
      onTransformComplete?.(contentText, result.transformed, `Humanized (${humanizeIntensity})`);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled, don't show error
      } else {
        setTransformError(error instanceof Error ? error.message : 'Transformation failed');
      }
    } finally {
      setIsTransforming(false);
      abortControllerRef.current = null;
    }
  }, [contentText, humanizeIntensity, enableSicAnalysis, importText, onTransformComplete]);

  const handlePersonaTransform = useCallback(async () => {
    const persona = customPersona.trim() || selectedPersona;
    if (!contentText.trim() || !persona) return;

    setIsTransforming(true);
    setTransformError(null);
    setTransformResult(null);

    abortControllerRef.current = new AbortController();

    try {
      const result = await transformPersona(
        contentText,
        persona,
        { preserveLength: true, enableValidation: true },
        abortControllerRef.current.signal
      );

      setTransformResult(result);
      importText(result.transformed, `Persona: ${persona}`);
      // Trigger split-screen mode to show before/after
      onTransformComplete?.(contentText, result.transformed, `Persona: ${persona}`);
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setTransformError(error instanceof Error ? error.message : 'Transformation failed');
      }
    } finally {
      setIsTransforming(false);
      abortControllerRef.current = null;
    }
  }, [contentText, selectedPersona, customPersona, importText, onTransformComplete]);

  const handleStyleTransform = useCallback(async () => {
    if (!contentText.trim() || !selectedStyle) return;

    setIsTransforming(true);
    setTransformError(null);
    setTransformResult(null);

    abortControllerRef.current = new AbortController();

    try {
      const result = await transformStyle(
        contentText,
        selectedStyle,
        { preserveLength: true, enableValidation: true },
        abortControllerRef.current.signal
      );

      setTransformResult(result);
      importText(result.transformed, `Style: ${selectedStyle}`);
      // Trigger split-screen mode to show before/after
      onTransformComplete?.(contentText, result.transformed, `Style: ${selectedStyle}`);
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setTransformError(error instanceof Error ? error.message : 'Transformation failed');
      }
    } finally {
      setIsTransforming(false);
      abortControllerRef.current = null;
    }
  }, [contentText, selectedStyle, importText, onTransformComplete]);

  const handleSentenceAnalysis = useCallback(async () => {
    if (!contentText.trim()) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setSentenceResults(null);
    setAnalysisProgress(null);

    abortControllerRef.current = new AbortController();

    try {
      const result = await analyzeSentences(
        contentText,
        (current, total) => {
          setAnalysisProgress({ current, total });
        },
        abortControllerRef.current.signal
      );

      setSentenceResults(result);

      // Convert to SentenceAnalysis format for highlighting
      // Map entropy to AI likelihood (higher entropy = more uncertain = higher likelihood)
      let currentOffset = 0;
      const sentences: SentenceAnalysis[] = result.sentences.map((s) => {
        const startOffset = contentText.indexOf(s.text, currentOffset);
        currentOffset = startOffset >= 0 ? startOffset + s.text.length : currentOffset;

        // Convert entropy (0-2) to aiLikelihood (0-100)
        // Max entropy for 4 outcomes is log2(4) = 2
        const aiLikelihood = Math.min(100, (s.entropy / 2) * 100);

        // Flag as suspect if high entropy or 'neither' dominant
        const isSuspect = s.entropy > 1.5 || s.dominant === 'neither';

        // Generate flags based on analysis
        const flags: string[] = [];
        if (s.dominant === 'neither') flags.push('ambiguous');
        if (s.dominant === 'both') flags.push('paradoxical');
        if (s.entropy > 1.5) flags.push('high-entropy');
        if (s.purity < 0.3) flags.push('low-purity');

        return {
          text: s.text,
          startOffset: startOffset >= 0 ? startOffset : 0,
          endOffset: startOffset >= 0 ? startOffset + s.text.length : s.text.length,
          wordCount: s.text.split(/\s+/).length,
          aiLikelihood,
          flags,
          isSuspect,
        };
      });

      // Store in layout context for workspace highlighting
      setAnalysisData({ sentences });

      // Enable AI detection highlight layer and switch to analyze mode
      setActiveHighlights(['ai-detection']);
      setSplitMode('analyze');
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setAnalysisError(error instanceof Error ? error.message : 'Analysis failed');
      }
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(null);
      abortControllerRef.current = null;
    }
  }, [contentText, setAnalysisData, setActiveHighlights, setSplitMode]);

  const cancelAnalysis = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsAnalyzing(false);
      setAnalysisProgress(null);
    }
  }, []);

  // Auto-trigger analysis when toolbar mode changes to 'analyze'
  useEffect(() => {
    // Only trigger when mode is 'analyze', there's content, we're not already analyzing,
    // we don't already have analysis data, and no previous error
    if (
      splitMode === 'analyze' &&
      contentText.trim() &&
      !isAnalyzing &&
      !analysisData?.sentences?.length &&
      !analysisError
    ) {
      handleSentenceAnalysis();
    }
  }, [splitMode, contentText, isAnalyzing, analysisData?.sentences?.length, analysisError, handleSentenceAnalysis]);

  // Ensure active tab is visible
  useEffect(() => {
    if (!visibleTools.find(t => t.id === activeTab)) {
      const firstVisible = visibleTools.find(t => t.id !== 'settings');
      if (firstVisible) setActiveTab(firstVisible.id);
    }
  }, [toolVisibility, activeTab, visibleTools]);

  return (
    <div className="tool-tabs">
      {/* Tab bar - horizontal scroll */}
      <nav className="tool-tabs__nav">
        {visibleTools.map(tool => (
          <button
            key={tool.id}
            className={`tool-tabs__tab ${activeTab === tool.id ? 'tool-tabs__tab--active' : ''}`}
            onClick={() => setActiveTab(tool.id)}
            title={tool.description}
          >
            <span className="tool-tabs__tab-icon">{tool.icon}</span>
            <span className="tool-tabs__tab-label">{tool.label}</span>
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className="tool-tabs__content">
        {/* ═══════════════════════════════════════════════════════════════
            HUMANIZER - Core transformation
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'humanizer' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Humanize</h3>
              <span className="tool-panel__subtitle">Transform AI text to human voice</span>
            </div>
            {!activeContent ? (
              <div className="tool-panel__empty">
                <p>Select content from the Archive to humanize</p>
              </div>
            ) : (
              <div className="tool-panel__body">
                {/* Intensity selector */}
                <div className="tool-panel__section">
                  <label className="tool-panel__label">Intensity</label>
                  <select
                    className="tool-control__select"
                    value={humanizeIntensity}
                    onChange={(e) => setHumanizeIntensity(e.target.value as HumanizationIntensity)}
                    disabled={isTransforming}
                  >
                    <option value="light">Light (50%) - Minimal changes</option>
                    <option value="moderate">Moderate (70%) - Balanced</option>
                    <option value="aggressive">Aggressive (95%) - Maximum</option>
                  </select>
                </div>

                {/* SIC Analysis toggle */}
                <div className="tool-panel__section">
                  <label className="tool-check">
                    <input
                      type="checkbox"
                      checked={enableSicAnalysis}
                      onChange={(e) => setEnableSicAnalysis(e.target.checked)}
                      disabled={isTransforming}
                    />
                    Enable SIC Analysis (Paid feature)
                  </label>
                </div>

                {/* Transform button */}
                <div className="tool-panel__actions">
                  {isTransforming ? (
                    <button
                      className="tool-card tool-card--cancel"
                      onClick={cancelTransform}
                    >
                      <span className="tool-card__name">Cancel</span>
                    </button>
                  ) : (
                    <button
                      className="tool-card tool-card--primary"
                      onClick={handleHumanize}
                      disabled={!contentText.trim()}
                    >
                      <span className="tool-card__name">
                        {isTransforming ? '⏳ Processing...' : '✦ Humanize Text'}
                      </span>
                      <span className="tool-card__desc">Apply SIC-optimized transformation</span>
                    </button>
                  )}
                </div>

                {/* Error display */}
                {transformError && (
                  <div className="tool-panel__error">
                    {transformError}
                  </div>
                )}

                {/* Result summary */}
                {transformResult && !transformError && (
                  <div className="tool-panel__result">
                    <span className="tool-panel__result-success">✓ Transformed</span>
                    {transformResult.metadata?.modelUsed && (
                      <span className="tool-panel__result-meta">
                        via {transformResult.metadata.modelUsed.split('/').pop()}
                      </span>
                    )}
                    {transformResult.metadata?.processingTimeMs && (
                      <span className="tool-panel__result-meta">
                        {(transformResult.metadata.processingTimeMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                )}

                {/* Content info */}
                <div className="tool-panel__info">
                  <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  <span>{totalChars.toLocaleString()} chars</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            PERSONA - Apply persona transformation
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'persona' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Persona</h3>
              <span className="tool-panel__subtitle">Transform voice and perspective</span>
            </div>
            {!activeContent ? (
              <div className="tool-panel__empty">
                <p>Select content from the Archive to transform</p>
              </div>
            ) : (
              <div className="tool-panel__body">
                {/* Persona selector - Horizontal scroll cards */}
                <div className="tool-panel__section">
                  <label className="tool-panel__label">Select Persona</label>
                  <ProfileCardsContainer
                    profiles={availablePersonas}
                    selectedName={selectedPersona}
                    onSelect={(p) => {
                      setSelectedPersona(p.name);
                      setCustomPersona('');
                    }}
                    disabled={isTransforming}
                    showAllProfiles={showAllPersonas}
                    onToggleShowAll={() => setShowAllPersonas(!showAllPersonas)}
                    type="persona"
                  />
                </div>

                {/* Custom persona input */}
                <div className="tool-panel__section">
                  <label className="tool-panel__label">Or Custom Persona</label>
                  <input
                    type="text"
                    className="tool-control__input tool-control__input--full"
                    placeholder="e.g., Victorian scholar, enthusiastic chef..."
                    value={customPersona}
                    onChange={(e) => {
                      setCustomPersona(e.target.value);
                      if (e.target.value) setSelectedPersona('');
                    }}
                    disabled={isTransforming}
                  />
                </div>

                {/* Transform button */}
                <div className="tool-panel__actions">
                  {isTransforming ? (
                    <button
                      className="tool-card tool-card--cancel"
                      onClick={cancelTransform}
                    >
                      <span className="tool-card__name">Cancel</span>
                    </button>
                  ) : (
                    <button
                      className="tool-card tool-card--primary"
                      onClick={handlePersonaTransform}
                      disabled={!contentText.trim() || (!selectedPersona && !customPersona.trim())}
                    >
                      <span className="tool-card__name">
                        {availablePersonas.find(p => p.name === selectedPersona)?.icon || '◐'} Apply {customPersona.trim() || selectedPersona || 'Persona'}
                      </span>
                      <span className="tool-card__desc">Transform to selected voice</span>
                    </button>
                  )}
                </div>

                {/* Error display */}
                {transformError && activeTab === 'persona' && (
                  <div className="tool-panel__error">{transformError}</div>
                )}

                {/* Result summary */}
                {transformResult && !transformError && (
                  <div className="tool-panel__result">
                    <span className="tool-panel__result-success">✓ Transformed</span>
                  </div>
                )}

                {/* Content info */}
                <div className="tool-panel__info">
                  <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  <span>{totalChars.toLocaleString()} chars</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            STYLE - Style transformation
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'style' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Style</h3>
              <span className="tool-panel__subtitle">Adjust tone and register</span>
            </div>
            {!activeContent ? (
              <div className="tool-panel__empty">
                <p>Select content from the Archive to transform</p>
              </div>
            ) : (
              <div className="tool-panel__body">
                {/* Style selector - Horizontal scroll cards */}
                <div className="tool-panel__section">
                  <label className="tool-panel__label">Select Style</label>
                  <ProfileCardsContainer
                    profiles={availableStyles}
                    selectedName={selectedStyle}
                    onSelect={(s) => setSelectedStyle(s.name)}
                    disabled={isTransforming}
                    showAllProfiles={showAllStyles}
                    onToggleShowAll={() => setShowAllStyles(!showAllStyles)}
                    type="style"
                  />
                </div>

                {/* Transform button */}
                <div className="tool-panel__actions">
                  {isTransforming ? (
                    <button
                      className="tool-card tool-card--cancel"
                      onClick={cancelTransform}
                    >
                      <span className="tool-card__name">Cancel</span>
                    </button>
                  ) : (
                    <button
                      className="tool-card tool-card--primary"
                      onClick={handleStyleTransform}
                      disabled={!contentText.trim() || !selectedStyle}
                    >
                      <span className="tool-card__name">
                        {availableStyles.find(s => s.name === selectedStyle)?.icon || '❧'} Apply {selectedStyle || 'Style'}
                      </span>
                      <span className="tool-card__desc">Transform writing style</span>
                    </button>
                  )}
                </div>

                {/* Error display */}
                {transformError && activeTab === 'style' && (
                  <div className="tool-panel__error">{transformError}</div>
                )}

                {/* Result summary */}
                {transformResult && !transformError && (
                  <div className="tool-panel__result">
                    <span className="tool-panel__result-success">✓ Transformed</span>
                  </div>
                )}

                {/* Content info */}
                <div className="tool-panel__info">
                  <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  <span>{totalChars.toLocaleString()} chars</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            SENTENCING - Narrative Sentencing / Quantum Reading
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'sentencing' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Narrative Sentencing</h3>
              <span className="tool-panel__subtitle">Tetralemma density analysis per sentence</span>
            </div>
            {!activeContent ? (
              <div className="tool-panel__empty">
                <p>Select content to analyze</p>
              </div>
            ) : (
              <div className="tool-panel__body">
                {/* Action buttons */}
                <div className="tool-panel__actions">
                  {isAnalyzing ? (
                    <>
                      <div className="tool-panel__progress">
                        <div className="tool-panel__progress-bar">
                          <div
                            className="tool-panel__progress-fill"
                            style={{
                              width: analysisProgress
                                ? `${(analysisProgress.current / analysisProgress.total) * 100}%`
                                : '0%'
                            }}
                          />
                        </div>
                        <span className="tool-panel__progress-text">
                          {analysisProgress
                            ? `Analyzing sentence ${analysisProgress.current}/${analysisProgress.total}`
                            : 'Starting...'}
                        </span>
                      </div>
                      <button
                        className="tool-card tool-card--cancel"
                        onClick={cancelAnalysis}
                      >
                        <span className="tool-card__name">Cancel</span>
                      </button>
                    </>
                  ) : (
                    <button
                      className="tool-card tool-card--primary"
                      onClick={handleSentenceAnalysis}
                      disabled={!contentText.trim()}
                    >
                      <span className="tool-card__name">◈ Analyze Sentences</span>
                      <span className="tool-card__desc">Tetralemma measurement + entropy tracking</span>
                    </button>
                  )}
                </div>

                {/* Error display */}
                {analysisError && (
                  <div className="tool-panel__error">{analysisError}</div>
                )}

                {/* Results summary */}
                {sentenceResults && !analysisError && (
                  <div className="sentencing-results">
                    {/* Overall stats */}
                    <div className="sentencing-results__summary">
                      <div className="sentencing-stat">
                        <span className="sentencing-stat__value">{sentenceResults.overall.totalSentences}</span>
                        <span className="sentencing-stat__label">Sentences</span>
                      </div>
                      <div className="sentencing-stat">
                        <span className="sentencing-stat__value">{sentenceResults.overall.avgEntropy.toFixed(2)}</span>
                        <span className="sentencing-stat__label">Avg Entropy</span>
                      </div>
                      <div className="sentencing-stat">
                        <span className="sentencing-stat__value sentencing-stat__value--stance">
                          {sentenceResults.overall.dominantStance}
                        </span>
                        <span className="sentencing-stat__label">Dominant</span>
                      </div>
                    </div>

                    {/* Per-sentence results */}
                    <div className="sentencing-results__sentences">
                      {sentenceResults.sentences.map((s) => (
                        <div key={s.index} className="sentencing-sentence">
                          <div className="sentencing-sentence__header">
                            <span className="sentencing-sentence__index">#{s.index + 1}</span>
                            <span className={`sentencing-sentence__stance sentencing-sentence__stance--${s.dominant}`}>
                              {s.dominant}
                            </span>
                          </div>
                          <div className="sentencing-sentence__text">{s.text}</div>
                          <div className="sentencing-sentence__probs">
                            <div className="sentencing-prob" style={{ width: `${s.tetralemma.literal * 100}%` }}>
                              <span title={`Literal: ${(s.tetralemma.literal * 100).toFixed(1)}%`}>L</span>
                            </div>
                            <div className="sentencing-prob sentencing-prob--meta" style={{ width: `${s.tetralemma.metaphorical * 100}%` }}>
                              <span title={`Metaphorical: ${(s.tetralemma.metaphorical * 100).toFixed(1)}%`}>M</span>
                            </div>
                            <div className="sentencing-prob sentencing-prob--both" style={{ width: `${s.tetralemma.both * 100}%` }}>
                              <span title={`Both: ${(s.tetralemma.both * 100).toFixed(1)}%`}>B</span>
                            </div>
                            <div className="sentencing-prob sentencing-prob--neither" style={{ width: `${s.tetralemma.neither * 100}%` }}>
                              <span title={`Neither: ${(s.tetralemma.neither * 100).toFixed(1)}%`}>N</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Content info */}
                <div className="tool-panel__info">
                  <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  <span>{totalChars.toLocaleString()} chars</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            PROFILE - Profile Factory
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'profile' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Profile Factory</h3>
              <span className="tool-panel__subtitle">Create and manage personas</span>
            </div>
            <div className="tool-panel__body">
              <button className="tool-card tool-card--primary">
                <span className="tool-card__name">New Profile</span>
                <span className="tool-card__desc">Create from selected text</span>
              </button>
              <div className="tool-panel__divider" />
              <div className="tool-panel__section">
                <label className="tool-panel__label">Saved Profiles</label>
                <p className="tool-panel__muted">No profiles yet</p>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            EDITOR - Markdown Editor
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'editor' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Editor</h3>
              <span className="tool-panel__subtitle">Direct markdown editing</span>
            </div>
            {!activeContent ? (
              <div className="tool-panel__empty">
                <p>Select content to edit</p>
              </div>
            ) : (
              <div className="tool-panel__body">
                <textarea
                  className="tool-editor"
                  defaultValue={items.map(i => i.text).join('\n\n---\n\n')}
                  placeholder="Edit content here..."
                />
                <button className="tool-card tool-card--primary">
                  <span className="tool-card__name">Save Changes</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Book tab removed - now in BookMakerModal (Cmd+Shift+B) */}

        {/* ═══════════════════════════════════════════════════════════════
            HARVEST - Passage curation queue
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'harvest' && (
          <HarvestQueuePanel
            bookUri={bookshelf.activeBookUri}
            onSelectPassage={(passage) => {
              // Load passage into buffer for viewing
              importText(passage.text || '', passage.sourceRef?.conversationTitle || 'Passage', {
                type: 'passage',
              });
            }}
            onOpenSource={(conversationId) => {
              // Dispatch event to open conversation in Archive
              window.dispatchEvent(
                new CustomEvent('open-conversation', {
                  detail: { conversationId, folder: conversationId },
                })
              );
            }}
            onReviewInWorkspace={onReviewInWorkspace}
          />
        )}

        {/* Book tools (arc, threads, chapters, persona) removed - now in BookMakerModal */}

        {/* ═══════════════════════════════════════════════════════════════
            PIPELINES - Advanced workflows
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'pipelines' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Pipelines</h3>
              <span className="tool-panel__subtitle">Preset workflows</span>
            </div>
            <div className="tool-panel__body">
              {pipelines.map(p => (
                <button
                  key={p.id}
                  className="tool-card"
                  onClick={() => handleApplyPipeline(p.id)}
                >
                  <span className="tool-card__name">{p.name}</span>
                  <span className="tool-card__desc">{p.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            SPLIT - Advanced operator
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'split' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Split</h3>
              <span className="tool-panel__subtitle">Break content apart</span>
            </div>
            <div className="tool-panel__body">
              {operatorsByType['split']?.map(op => (
                <button
                  key={op.id}
                  className="tool-card"
                  onClick={() => handleApplyOperator(op.id)}
                >
                  <span className="tool-card__name">{op.name}</span>
                  <span className="tool-card__desc">{op.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            FILTER - Advanced operator
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'filter' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Filter</h3>
              <span className="tool-panel__subtitle">Select by criteria</span>
            </div>
            <div className="tool-panel__section">
              <label className="tool-panel__label">SIC Score Filter</label>
              <div className="tool-control">
                <select
                  className="tool-control__select"
                  value={filterParams.comparison}
                  onChange={(e) => setFilterParams(p => ({ ...p, comparison: e.target.value as '>' | '<' | '=' }))}
                >
                  <option value=">">&gt; greater than</option>
                  <option value="<">&lt; less than</option>
                  <option value="=">=  equal to</option>
                </select>
                <input
                  type="number"
                  className="tool-control__input"
                  value={filterParams.threshold}
                  onChange={(e) => setFilterParams(p => ({ ...p, threshold: Number(e.target.value) }))}
                  min={0}
                  max={100}
                />
                <button
                  className="tool-control__apply"
                  onClick={() => handleApplyOperator('filter:sic', filterParams)}
                >
                  Apply
                </button>
              </div>
            </div>
            <div className="tool-panel__divider" />
            <div className="tool-panel__body">
              {operatorsByType['filter']?.filter(op => op.id !== 'filter:sic').map(op => (
                <button
                  key={op.id}
                  className="tool-card tool-card--compact"
                  onClick={() => handleApplyOperator(op.id)}
                >
                  <span className="tool-card__name">{op.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            ORDER - Advanced operator
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'order' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Order</h3>
              <span className="tool-panel__subtitle">Arrange content</span>
            </div>
            <div className="tool-panel__body">
              {operatorsByType['order']?.map(op => (
                <button
                  key={op.id}
                  className="tool-card"
                  onClick={() => handleApplyOperator(op.id)}
                >
                  <span className="tool-card__name">{op.name}</span>
                  <span className="tool-card__desc">{op.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            BUFFER - Document operations
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'buffer' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Buffer</h3>
              <span className="tool-panel__subtitle">Current document</span>
            </div>
            <div className="tool-panel__stats">
              <div className="tool-stat">
                <span className="tool-stat__value">{items.length}</span>
                <span className="tool-stat__label">items</span>
              </div>
              <div className="tool-stat">
                <span className="tool-stat__value">{totalChars.toLocaleString()}</span>
                <span className="tool-stat__label">chars</span>
              </div>
              {activeNode?.metadata.avgSicScore !== undefined && (
                <div className="tool-stat">
                  <span className="tool-stat__value">{activeNode.metadata.avgSicScore.toFixed(0)}</span>
                  <span className="tool-stat__label">avg SIC</span>
                </div>
              )}
            </div>
            <div className="tool-panel__divider" />
            <div className="tool-panel__body">
              <button
                className="tool-card"
                onClick={() => activeBuffer && forkBuffer(activeBuffer.id)}
              >
                <span className="tool-card__name">Fork Buffer</span>
                <span className="tool-card__desc">Create a copy to experiment with</span>
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            SETTINGS - Tool visibility
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'settings' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Settings</h3>
              <span className="tool-panel__subtitle">Show or hide tools</span>
            </div>
            <div className="tool-panel__body">
              {(['transform', 'analyze', 'edit', 'advanced'] as const).map(category => (
                <div key={category} className="tool-panel__section">
                  <label className="tool-panel__label">{category}</label>
                  {TOOL_REGISTRY.filter(t => t.category === category).map(tool => (
                    <label key={tool.id} className="tool-toggle">
                      <input
                        type="checkbox"
                        checked={toolVisibility[tool.id] ?? tool.defaultVisible}
                        onChange={() => toggleToolVisibility(tool.id)}
                      />
                      <span className="tool-toggle__icon">{tool.icon}</span>
                      <span className="tool-toggle__label">{tool.label}</span>
                      <span className="tool-toggle__desc">{tool.description}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

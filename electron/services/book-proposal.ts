/**
 * Book Proposal Service
 *
 * Implements the "Make This a Book" pipeline:
 * 1. Analyzes source content (embedding cluster or search results)
 * 2. Proposes narrative arcs
 * 3. Suggests chapter structure
 * 4. Identifies gaps
 * 5. Generates draft when approved
 *
 * This is the intelligent book assembly orchestrator.
 */

import { analyzePassages, type PassageAnalysis } from './passage-analyzer';
import { analyzeDocument, type DocumentChekhovAnalysis } from './chekhov-analyzer';
import { analyzeTrajectory, type AffectTrajectory } from './sentiment-tracker';
import { getModelRouter, type GenerationResult } from './model-router';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface SourceContent {
  id: string;
  text: string;
  metadata?: {
    sourceRef?: string;
    timestamp?: number;
    author?: string;
  };
}

export type ArcType = 'chronological' | 'thematic' | 'dialectical' | 'journey' | 'spiral';

export interface ArcOption {
  type: ArcType;
  name: string;
  description: string;
  confidence: number; // 0-1: How well this arc fits the content
  chapterOutline: ChapterProposal[];
}

export interface ChapterProposal {
  number: number;
  title: string;
  theme: string;
  passageIds: string[]; // Which passages belong here
  estimatedWordCount: number;
}

export interface StyleOption {
  name: string;
  description: string;
  sample: string; // Short example of this style
  suitability: number; // 0-1: How suitable for this content
}

export interface Gap {
  topic: string;
  description: string;
  severity: 'critical' | 'moderate' | 'minor';
  suggestedSearch?: string;
}

export interface BookProposal {
  id: string;
  title: string;
  subtitle?: string;
  description: string;

  // Analysis results
  analysis: {
    totalPassages: number;
    avgQualityScore: number; // From passage analyzer
    dominantThemes: string[];
    emotionalArc: AffectTrajectory['arc']['shape'];
    narrativeTightness: number;
  };

  // Options for user to choose
  arcOptions: ArcOption[];
  styleOptions: StyleOption[];

  // Identified gaps
  gaps: Gap[];

  // Metadata
  createdAt: number;
  status: 'proposed' | 'approved' | 'generating' | 'complete';
}

export interface GenerationConfig {
  selectedArcIndex: number;
  selectedStyleIndex: number;
  additionalGuidance?: string;
  modelTier?: 'local' | 'balanced' | 'quality';
}

// ═══════════════════════════════════════════════════════════════════
// ARC DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Detect potential narrative arcs from content
 */
function detectArcs(
  passages: SourceContent[],
  analyses: PassageAnalysis[],
  trajectory: AffectTrajectory
): ArcOption[] {
  const arcs: ArcOption[] = [];

  // Extract themes from high-quality passages
  const themes = extractThemes(passages, analyses);

  // Chronological arc (if timestamps available)
  const hasTimestamps = passages.some((p) => p.metadata?.timestamp);
  if (hasTimestamps) {
    const sortedByTime = [...passages].sort(
      (a, b) => (a.metadata?.timestamp || 0) - (b.metadata?.timestamp || 0)
    );
    arcs.push({
      type: 'chronological',
      name: 'Timeline',
      description: 'Events and ideas presented in the order they occurred',
      confidence: 0.7,
      chapterOutline: createChronologicalChapters(sortedByTime, themes),
    });
  }

  // Thematic arc (cluster by topics)
  const thematicChapters = createThematicChapters(passages, analyses, themes);
  arcs.push({
    type: 'thematic',
    name: 'Topics',
    description: 'Organized by major themes and concepts',
    confidence: themes.length >= 3 ? 0.85 : 0.6,
    chapterOutline: thematicChapters,
  });

  // Dialectical arc (thesis → antithesis → synthesis)
  if (trajectory.summary.emotionalRange > 0.3) {
    arcs.push({
      type: 'dialectical',
      name: 'Dialectic',
      description: 'Ideas develop through tension and resolution',
      confidence: 0.65,
      chapterOutline: createDialecticalChapters(passages, analyses, trajectory),
    });
  }

  // Journey arc (if emotional arc has clear shape)
  if (trajectory.arc.shape === 'peak' || trajectory.arc.shape === 'rising' || trajectory.arc.shape === 'wave') {
    arcs.push({
      type: 'journey',
      name: 'Journey',
      description: 'A transformative progression from beginning to end',
      confidence: 0.75,
      chapterOutline: createJourneyChapters(passages, trajectory),
    });
  }

  // Spiral arc (returning themes with deepening)
  const repeatThemes = findRepeatThemes(passages, themes);
  if (repeatThemes.length >= 2) {
    arcs.push({
      type: 'spiral',
      name: 'Spiral',
      description: 'Themes return with increasing depth and nuance',
      confidence: 0.7,
      chapterOutline: createSpiralChapters(passages, repeatThemes),
    });
  }

  // Sort by confidence
  return arcs.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Extract dominant themes from passages
 */
function extractThemes(passages: SourceContent[], analyses: PassageAnalysis[]): string[] {
  // Simple keyword extraction
  const wordCounts: Record<string, number> = {};
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'between',
    'this', 'that', 'these', 'those', 'it', 'its', 'and', 'but', 'or', 'nor',
    'so', 'yet', 'both', 'either', 'neither', 'not', 'only', 'own', 'same',
    'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then',
  ]);

  passages.forEach((p) => {
    const words = p.text.toLowerCase().split(/\s+/);
    words.forEach((word) => {
      const cleaned = word.replace(/[^a-z]/g, '');
      if (cleaned.length > 4 && !stopWords.has(cleaned)) {
        wordCounts[cleaned] = (wordCounts[cleaned] || 0) + 1;
      }
    });
  });

  return Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

function createChronologicalChapters(passages: SourceContent[], themes: string[]): ChapterProposal[] {
  // Group into time-based chunks
  const chunkSize = Math.ceil(passages.length / 4);
  const chapters: ChapterProposal[] = [];

  for (let i = 0; i < passages.length; i += chunkSize) {
    const chunk = passages.slice(i, i + chunkSize);
    chapters.push({
      number: chapters.length + 1,
      title: `Part ${chapters.length + 1}`,
      theme: themes[chapters.length % themes.length] || 'Continuation',
      passageIds: chunk.map((p) => p.id),
      estimatedWordCount: chunk.reduce((sum, p) => sum + p.text.split(/\s+/).length, 0),
    });
  }

  return chapters;
}

function createThematicChapters(
  passages: SourceContent[],
  analyses: PassageAnalysis[],
  themes: string[]
): ChapterProposal[] {
  // Group passages by which theme they most match
  const themeGroups: Record<string, SourceContent[]> = {};

  themes.slice(0, 5).forEach((theme) => {
    themeGroups[theme] = [];
  });
  themeGroups['other'] = [];

  passages.forEach((p) => {
    const textLower = p.text.toLowerCase();
    let assigned = false;

    for (const theme of themes.slice(0, 5)) {
      if (textLower.includes(theme)) {
        themeGroups[theme].push(p);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      themeGroups['other'].push(p);
    }
  });

  // Create chapters from non-empty groups
  return Object.entries(themeGroups)
    .filter(([_, group]) => group.length > 0)
    .map(([theme, group], i) => ({
      number: i + 1,
      title: theme.charAt(0).toUpperCase() + theme.slice(1),
      theme,
      passageIds: group.map((p) => p.id),
      estimatedWordCount: group.reduce((sum, p) => sum + p.text.split(/\s+/).length, 0),
    }));
}

function createDialecticalChapters(
  passages: SourceContent[],
  analyses: PassageAnalysis[],
  trajectory: AffectTrajectory
): ChapterProposal[] {
  const third = Math.ceil(passages.length / 3);

  return [
    {
      number: 1,
      title: 'Thesis',
      theme: 'Initial position',
      passageIds: passages.slice(0, third).map((p) => p.id),
      estimatedWordCount: passages.slice(0, third).reduce((sum, p) => sum + p.text.split(/\s+/).length, 0),
    },
    {
      number: 2,
      title: 'Antithesis',
      theme: 'Counterpoint',
      passageIds: passages.slice(third, third * 2).map((p) => p.id),
      estimatedWordCount: passages.slice(third, third * 2).reduce((sum, p) => sum + p.text.split(/\s+/).length, 0),
    },
    {
      number: 3,
      title: 'Synthesis',
      theme: 'Resolution',
      passageIds: passages.slice(third * 2).map((p) => p.id),
      estimatedWordCount: passages.slice(third * 2).reduce((sum, p) => sum + p.text.split(/\s+/).length, 0),
    },
  ];
}

function createJourneyChapters(passages: SourceContent[], trajectory: AffectTrajectory): ChapterProposal[] {
  const sections = ['Departure', 'Challenges', 'Transformation', 'Return'];
  const quarter = Math.ceil(passages.length / 4);

  return sections.map((section, i) => ({
    number: i + 1,
    title: section,
    theme: section.toLowerCase(),
    passageIds: passages.slice(i * quarter, (i + 1) * quarter).map((p) => p.id),
    estimatedWordCount: passages.slice(i * quarter, (i + 1) * quarter).reduce((sum, p) => sum + p.text.split(/\s+/).length, 0),
  }));
}

function findRepeatThemes(passages: SourceContent[], themes: string[]): string[] {
  // Find themes that appear in multiple parts of the text
  const quarterSize = Math.ceil(passages.length / 4);
  const repeating: string[] = [];

  themes.forEach((theme) => {
    let appearances = 0;
    for (let i = 0; i < 4; i++) {
      const chunk = passages.slice(i * quarterSize, (i + 1) * quarterSize);
      if (chunk.some((p) => p.text.toLowerCase().includes(theme))) {
        appearances++;
      }
    }
    if (appearances >= 2) {
      repeating.push(theme);
    }
  });

  return repeating;
}

function createSpiralChapters(passages: SourceContent[], repeatThemes: string[]): ChapterProposal[] {
  // Create chapters that revisit themes
  const chapterCount = Math.min(5, repeatThemes.length * 2);
  const chapterSize = Math.ceil(passages.length / chapterCount);

  return Array.from({ length: chapterCount }, (_, i) => ({
    number: i + 1,
    title: `${repeatThemes[i % repeatThemes.length]} ${Math.floor(i / repeatThemes.length) + 1}`,
    theme: repeatThemes[i % repeatThemes.length],
    passageIds: passages.slice(i * chapterSize, (i + 1) * chapterSize).map((p) => p.id),
    estimatedWordCount: passages.slice(i * chapterSize, (i + 1) * chapterSize).reduce((sum, p) => sum + p.text.split(/\s+/).length, 0),
  }));
}

// ═══════════════════════════════════════════════════════════════════
// GAP DETECTION
// ═══════════════════════════════════════════════════════════════════

function detectGaps(
  passages: SourceContent[],
  analyses: PassageAnalysis[],
  themes: string[]
): Gap[] {
  const gaps: Gap[] = [];

  // Check for thin themes
  const themeWordCounts: Record<string, number> = {};
  themes.forEach((theme) => {
    const matching = passages.filter((p) => p.text.toLowerCase().includes(theme));
    themeWordCounts[theme] = matching.reduce((sum, p) => sum + p.text.split(/\s+/).length, 0);
  });

  themes.forEach((theme) => {
    if (themeWordCounts[theme] < 500) {
      gaps.push({
        topic: theme,
        description: `Theme "${theme}" has limited content (${themeWordCounts[theme]} words)`,
        severity: themeWordCounts[theme] < 200 ? 'critical' : 'moderate',
        suggestedSearch: `${theme} discussion reflection`,
      });
    }
  });

  // Check for low-quality passages
  const lowQuality = analyses.filter((a) => a.recommendation.action === 'reject');
  if (lowQuality.length > passages.length * 0.3) {
    gaps.push({
      topic: 'Content quality',
      description: `${Math.round(lowQuality.length / passages.length * 100)}% of passages scored low quality`,
      severity: 'moderate',
    });
  }

  // Check for missing introduction/conclusion patterns
  const firstPassages = passages.slice(0, 3);
  const hasIntro = firstPassages.some((p) =>
    /\b(begin|start|introduction|overview|first)\b/i.test(p.text)
  );
  if (!hasIntro) {
    gaps.push({
      topic: 'Introduction',
      description: 'No clear introductory content detected',
      severity: 'minor',
      suggestedSearch: 'introduction overview beginning',
    });
  }

  const lastPassages = passages.slice(-3);
  const hasConclusion = lastPassages.some((p) =>
    /\b(conclusion|finally|summary|end|closing)\b/i.test(p.text)
  );
  if (!hasConclusion) {
    gaps.push({
      topic: 'Conclusion',
      description: 'No clear concluding content detected',
      severity: 'minor',
      suggestedSearch: 'conclusion summary reflection',
    });
  }

  return gaps;
}

// ═══════════════════════════════════════════════════════════════════
// STYLE OPTIONS
// ═══════════════════════════════════════════════════════════════════

function generateStyleOptions(trajectory: AffectTrajectory): StyleOption[] {
  const options: StyleOption[] = [
    {
      name: 'Academic',
      description: 'Formal, analytical, with clear argumentation',
      sample: 'This analysis demonstrates the interconnected nature of the phenomena under investigation.',
      suitability: trajectory.summary.dominantEmotion === 'neutral' ? 0.9 : 0.6,
    },
    {
      name: 'Narrative',
      description: 'Story-driven, engaging, with descriptive passages',
      sample: 'The discovery came like a wave, reshaping everything that had come before.',
      suitability: trajectory.arc.shape === 'peak' || trajectory.arc.shape === 'rising' ? 0.9 : 0.7,
    },
    {
      name: 'Conversational',
      description: 'Accessible, direct, as if speaking to the reader',
      sample: "Here's the thing about consciousness—it's always stranger than we expect.",
      suitability: 0.75,
    },
    {
      name: 'Philosophical',
      description: 'Contemplative, exploratory, with deep questioning',
      sample: 'What remains when we strip away all assumptions? The question itself transforms us.',
      suitability: trajectory.summary.emotionalRange > 0.3 ? 0.85 : 0.65,
    },
    {
      name: 'Lyrical',
      description: 'Poetic, rhythmic, with attention to language itself',
      sample: 'Between each thought, silence. Between silence, the seeds of understanding.',
      suitability: trajectory.summary.averageArousal < 0.4 ? 0.8 : 0.5,
    },
  ];

  return options.sort((a, b) => b.suitability - a.suitability);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a book proposal from source content
 */
export async function generateProposal(
  sources: SourceContent[],
  bookTheme?: string
): Promise<BookProposal> {
  // Analyze all passages
  const passageInputs = sources.map((s) => ({ id: s.id, text: s.text }));
  const analyses = await analyzePassages(passageInputs, { bookTheme });

  // Analyze combined text for sentiment
  const combinedText = sources.map((s) => s.text).join('\n\n');
  const trajectory = analyzeTrajectory('combined', combinedText);

  // Analyze for narrative tightness
  const chekhov = analyzeDocument('combined', combinedText);

  // Extract themes
  const themes = extractThemes(sources, analyses);

  // Detect possible arcs
  const arcOptions = detectArcs(sources, analyses, trajectory);

  // Generate style options
  const styleOptions = generateStyleOptions(trajectory);

  // Detect gaps
  const gaps = detectGaps(sources, analyses, themes);

  // Generate title suggestion
  const title = generateTitle(themes, trajectory);

  // Calculate quality score
  const avgQuality = analyses.reduce((sum, a) => sum + a.recommendation.confidence, 0) / analyses.length;

  return {
    id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    subtitle: themes.slice(0, 3).join(', '),
    description: `A ${arcOptions[0]?.name.toLowerCase() || 'thematic'} exploration of ${themes.slice(0, 2).join(' and ')}`,
    analysis: {
      totalPassages: sources.length,
      avgQualityScore: avgQuality,
      dominantThemes: themes.slice(0, 5),
      emotionalArc: trajectory.arc.shape,
      narrativeTightness: chekhov.summary.overallTightness,
    },
    arcOptions,
    styleOptions,
    gaps,
    createdAt: Date.now(),
    status: 'proposed',
  };
}

/**
 * Generate title from themes and trajectory
 */
function generateTitle(themes: string[], trajectory: AffectTrajectory): string {
  if (themes.length >= 2) {
    return `${capitalize(themes[0])} and ${capitalize(themes[1])}`;
  }
  if (themes.length === 1) {
    return `On ${capitalize(themes[0])}`;
  }
  return 'Untitled Work';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Generate a draft based on approved proposal
 */
export async function generateDraft(
  proposal: BookProposal,
  sources: SourceContent[],
  config: GenerationConfig
): Promise<{ success: boolean; chapters?: Array<{ title: string; content: string }>; error?: string }> {
  const selectedArc = proposal.arcOptions[config.selectedArcIndex];
  const selectedStyle = proposal.styleOptions[config.selectedStyleIndex];

  if (!selectedArc || !selectedStyle) {
    return { success: false, error: 'Invalid arc or style selection' };
  }

  const router = getModelRouter();
  const chapters: Array<{ title: string; content: string }> = [];

  for (const chapterProposal of selectedArc.chapterOutline) {
    // Gather passages for this chapter
    const chapterPassages = sources.filter((s) => chapterProposal.passageIds.includes(s.id));
    const passageContent = chapterPassages.map((p) => p.text).join('\n\n---\n\n');

    // Generate chapter
    const prompt = `You are writing Chapter ${chapterProposal.number}: "${chapterProposal.title}" for a book titled "${proposal.title}".

Style: ${selectedStyle.name} - ${selectedStyle.description}

Theme for this chapter: ${chapterProposal.theme}

Use the following passages as source material. Weave them together into a coherent chapter.
${config.additionalGuidance ? `\nAdditional guidance: ${config.additionalGuidance}` : ''}

=== SOURCE PASSAGES ===
${passageContent}
=== END PASSAGES ===

Write the chapter content now (no meta-commentary, just the chapter):`;

    const result: GenerationResult = await router.generate({
      prompt,
      taskType: config.modelTier === 'quality' ? 'final' : config.modelTier === 'local' ? 'draft' : 'deep-analysis',
      maxTokens: 2000,
      temperature: 0.7,
    });

    if (!result.success) {
      return { success: false, error: `Failed to generate chapter ${chapterProposal.number}: ${result.error}` };
    }

    chapters.push({
      title: chapterProposal.title,
      content: result.text || '',
    });
  }

  return { success: true, chapters };
}

export default {
  generateProposal,
  generateDraft,
};

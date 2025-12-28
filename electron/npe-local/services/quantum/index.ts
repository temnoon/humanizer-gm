/**
 * Quantum Analysis Service (Local)
 *
 * Simplified quantum reading analysis for local use.
 * Uses density matrix formalism for meaning evolution tracking.
 */

import { getDatabase, generateId } from '../database';
import { createLLMProvider } from '../llm';
import { splitSentences } from '../detection';

// ============================================================================
// Types
// ============================================================================

export interface DensityMatrixState {
  purity: number;
  entropy: number;
  eigenvalues: number[];
  dimension: number;
}

export interface TetralemmaProbs {
  literal: { probability: number; evidence: string };
  metaphorical: { probability: number; evidence: string };
  both: { probability: number; evidence: string };
  neither: { probability: number; evidence: string };
}

export interface QuantumMeasurement {
  sentenceIndex: number;
  sentence: string;
  measurement: TetralemmaProbs;
  rhoBefore: DensityMatrixState;
  rhoAfter: DensityMatrixState;
}

export interface QuantumSession {
  sessionId: string;
  userId: string;
  text: string;
  sentences: string[];
  totalSentences: number;
  currentSentence: number;
  initialRho: DensityMatrixState;
  currentRho: DensityMatrixState;
  measurements: QuantumMeasurement[];
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Density Matrix Operations
// ============================================================================

/**
 * Create a maximally-mixed initial density matrix
 * In a 4-dimensional tetralemma space (literal, metaphorical, both, neither)
 */
export function createMaximallyMixedState(): DensityMatrixState {
  const dimension = 4;
  const eigenvalue = 1 / dimension;

  return {
    purity: 1 / dimension, // Tr(ρ²) = 1/d for maximally mixed
    entropy: Math.log2(dimension), // S = log2(d) for maximally mixed
    eigenvalues: [eigenvalue, eigenvalue, eigenvalue, eigenvalue],
    dimension,
  };
}

/**
 * Update density matrix after a measurement
 * Simulates collapse toward the measured state
 */
export function updateDensityMatrix(
  current: DensityMatrixState,
  measurement: TetralemmaProbs
): DensityMatrixState {
  // Extract probabilities
  const probs = [
    measurement.literal.probability,
    measurement.metaphorical.probability,
    measurement.both.probability,
    measurement.neither.probability,
  ];

  // Normalize probabilities
  const sum = probs.reduce((a, b) => a + b, 0);
  const normalized = probs.map(p => p / (sum || 1));

  // Blend current eigenvalues with measurement (learning rate 0.3)
  const learningRate = 0.3;
  const newEigenvalues = current.eigenvalues.map((e, i) =>
    e * (1 - learningRate) + normalized[i] * learningRate
  );

  // Renormalize eigenvalues
  const eigenSum = newEigenvalues.reduce((a, b) => a + b, 0);
  const finalEigenvalues = newEigenvalues.map(e => e / eigenSum);

  // Calculate purity: Tr(ρ²) = Σλᵢ²
  const purity = finalEigenvalues.reduce((sum, e) => sum + e * e, 0);

  // Calculate von Neumann entropy: S = -Σλᵢ log₂(λᵢ)
  const entropy = finalEigenvalues.reduce((sum, e) => {
    if (e > 0) {
      return sum - e * Math.log2(e);
    }
    return sum;
  }, 0);

  return {
    purity,
    entropy,
    eigenvalues: finalEigenvalues,
    dimension: 4,
  };
}

// ============================================================================
// LLM-Based Measurement
// ============================================================================

const TETRALEMMA_PROMPT = `You are analyzing a sentence for its meaning modality using the tetralemma framework.

The tetralemma has four possibilities:
1. LITERAL - The sentence means exactly what it says, no hidden meaning
2. METAPHORICAL - The sentence uses figurative language, symbolism, or allusion
3. BOTH - The sentence works on both literal and metaphorical levels simultaneously
4. NEITHER - The sentence is ambiguous, paradoxical, or transcends simple categorization

For the given sentence, estimate the probability (0-100) for each category and provide brief evidence.

Respond in exactly this JSON format:
{
  "literal": { "probability": <number 0-100>, "evidence": "<brief explanation>" },
  "metaphorical": { "probability": <number 0-100>, "evidence": "<brief explanation>" },
  "both": { "probability": <number 0-100>, "evidence": "<brief explanation>" },
  "neither": { "probability": <number 0-100>, "evidence": "<brief explanation>" }
}

IMPORTANT: Probabilities should sum to approximately 100.`;

/**
 * Measure a sentence using LLM to determine tetralemma probabilities
 */
export async function measureSentence(sentence: string): Promise<TetralemmaProbs> {
  try {
    const provider = await createLLMProvider();

    if (!(await provider.isAvailable())) {
      // Fallback to statistical estimation if LLM unavailable
      return estimateTetralemmaStatistically(sentence);
    }

    const response = await provider.call({
      messages: [
        { role: 'system', content: TETRALEMMA_PROMPT },
        { role: 'user', content: `Analyze this sentence:\n\n"${sentence}"` },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });

    // Parse JSON response
    const text = response.response.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        literal: {
          probability: parsed.literal?.probability ?? 25,
          evidence: parsed.literal?.evidence ?? 'N/A',
        },
        metaphorical: {
          probability: parsed.metaphorical?.probability ?? 25,
          evidence: parsed.metaphorical?.evidence ?? 'N/A',
        },
        both: {
          probability: parsed.both?.probability ?? 25,
          evidence: parsed.both?.evidence ?? 'N/A',
        },
        neither: {
          probability: parsed.neither?.probability ?? 25,
          evidence: parsed.neither?.evidence ?? 'N/A',
        },
      };
    }

    // Fallback if parsing fails
    return estimateTetralemmaStatistically(sentence);
  } catch (error) {
    console.error('[Quantum] LLM measurement failed:', error);
    return estimateTetralemmaStatistically(sentence);
  }
}

/**
 * Statistical estimation of tetralemma when LLM is unavailable
 */
function estimateTetralemmaStatistically(sentence: string): TetralemmaProbs {
  // Simple heuristics based on sentence features
  const hasMetaphorMarkers = /like|as if|as though|metaphor|symbol/i.test(sentence);
  const isQuestion = sentence.trim().endsWith('?');
  const hasAbstractNouns = /love|truth|beauty|justice|freedom|time|death/i.test(sentence);
  const isDeclarative = !isQuestion && !sentence.trim().endsWith('!');

  let literal = 40;
  let metaphorical = 20;
  let both = 20;
  let neither = 20;

  if (hasMetaphorMarkers) {
    literal -= 20;
    metaphorical += 20;
  }

  if (hasAbstractNouns) {
    literal -= 10;
    both += 10;
  }

  if (isQuestion) {
    neither += 15;
    literal -= 15;
  }

  if (isDeclarative && !hasMetaphorMarkers && !hasAbstractNouns) {
    literal += 15;
    metaphorical -= 15;
  }

  // Normalize
  const sum = literal + metaphorical + both + neither;
  literal = (literal / sum) * 100;
  metaphorical = (metaphorical / sum) * 100;
  both = (both / sum) * 100;
  neither = (neither / sum) * 100;

  return {
    literal: { probability: literal, evidence: 'Statistical estimation' },
    metaphorical: { probability: metaphorical, evidence: 'Statistical estimation' },
    both: { probability: both, evidence: 'Statistical estimation' },
    neither: { probability: neither, evidence: 'Statistical estimation' },
  };
}

// ============================================================================
// Session Management
// ============================================================================

export function startQuantumSession(text: string, userId: string = 'local'): QuantumSession {
  const db = getDatabase();
  const sessionId = generateId();
  const now = Date.now();

  const sentences = splitSentences(text);
  const initialRho = createMaximallyMixedState();

  db.prepare(`
    INSERT INTO quantum_analysis_sessions (id, user_id, text, total_sentences, current_sentence, initial_rho_json, current_rho_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(
    sessionId,
    userId,
    text,
    sentences.length,
    JSON.stringify(initialRho),
    JSON.stringify(initialRho),
    now,
    now
  );

  return {
    sessionId,
    userId,
    text,
    sentences,
    totalSentences: sentences.length,
    currentSentence: 0,
    initialRho,
    currentRho: initialRho,
    measurements: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function getQuantumSession(sessionId: string, userId: string = 'local'): QuantumSession | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT * FROM quantum_analysis_sessions WHERE id = ? AND user_id = ?
  `).get(sessionId, userId) as any;

  if (!row) return null;

  const sentences = splitSentences(row.text);

  // Get measurements
  const measurementRows = db.prepare(`
    SELECT * FROM quantum_measurements WHERE session_id = ? ORDER BY sentence_index ASC
  `).all(sessionId) as any[];

  const measurements: QuantumMeasurement[] = measurementRows.map(m => ({
    sentenceIndex: m.sentence_index,
    sentence: m.sentence,
    measurement: {
      literal: { probability: m.prob_literal, evidence: m.evidence_literal },
      metaphorical: { probability: m.prob_metaphorical, evidence: m.evidence_metaphorical },
      both: { probability: m.prob_both, evidence: m.evidence_both },
      neither: { probability: m.prob_neither, evidence: m.evidence_neither },
    },
    rhoBefore: {
      purity: 0, entropy: 0, eigenvalues: [], dimension: 4,
    },
    rhoAfter: {
      purity: m.rho_purity,
      entropy: m.rho_entropy,
      eigenvalues: JSON.parse(m.rho_top_eigenvalues || '[]'),
      dimension: 4,
    },
  }));

  return {
    sessionId: row.id,
    userId: row.user_id,
    text: row.text,
    sentences,
    totalSentences: row.total_sentences,
    currentSentence: row.current_sentence,
    initialRho: JSON.parse(row.initial_rho_json),
    currentRho: JSON.parse(row.current_rho_json),
    measurements,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function stepQuantumSession(sessionId: string, userId: string = 'local'): Promise<QuantumMeasurement | null> {
  const db = getDatabase();
  const now = Date.now();

  const session = getQuantumSession(sessionId, userId);
  if (!session) return null;

  if (session.currentSentence >= session.totalSentences) {
    return null; // All sentences processed
  }

  const sentenceIndex = session.currentSentence;
  const sentence = session.sentences[sentenceIndex];
  const rhoBefore = session.currentRho;

  // Measure the sentence
  const measurement = await measureSentence(sentence);

  // Update density matrix
  const rhoAfter = updateDensityMatrix(rhoBefore, measurement);

  // Store measurement
  const measurementId = generateId();
  db.prepare(`
    INSERT INTO quantum_measurements (id, session_id, sentence_index, sentence, prob_literal, prob_metaphorical, prob_both, prob_neither, evidence_literal, evidence_metaphorical, evidence_both, evidence_neither, rho_purity, rho_entropy, rho_top_eigenvalues, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    measurementId,
    sessionId,
    sentenceIndex,
    sentence,
    measurement.literal.probability,
    measurement.metaphorical.probability,
    measurement.both.probability,
    measurement.neither.probability,
    measurement.literal.evidence,
    measurement.metaphorical.evidence,
    measurement.both.evidence,
    measurement.neither.evidence,
    rhoAfter.purity,
    rhoAfter.entropy,
    JSON.stringify(rhoAfter.eigenvalues),
    now
  );

  // Update session
  db.prepare(`
    UPDATE quantum_analysis_sessions SET current_sentence = ?, current_rho_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    sentenceIndex + 1,
    JSON.stringify(rhoAfter),
    now,
    sessionId
  );

  return {
    sentenceIndex,
    sentence,
    measurement,
    rhoBefore,
    rhoAfter,
  };
}

export function deleteQuantumSession(sessionId: string, userId: string = 'local'): boolean {
  const db = getDatabase();

  const result = db.prepare(`
    DELETE FROM quantum_analysis_sessions WHERE id = ? AND user_id = ?
  `).run(sessionId, userId);

  return result.changes > 0;
}

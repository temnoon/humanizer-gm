/**
 * Grading API Client
 *
 * Thin client that calls the backend grading API.
 * All grading logic lives on the server.
 */

// ============================================================================
// Types
// ============================================================================

export interface CardGrade {
  authenticity: number;
  necessity: number;
  inflection: number;
  voice: number;
  overall: number;
  stubType: string;
  sicAnalysis?: {
    score: number;
    category: string;
    signals: string[];
  };
  chekhovAnalysis?: {
    necessity: number;
    signals: {
      hasSpecificDetails: boolean;
      hasEmotionalContent: boolean;
      hasActionableInfo: boolean;
      hasUniqueInsight: boolean;
    };
  };
  quantumHighlights?: {
    dominantModality: string;
    isInflectionPoint: boolean;
    modalityShift?: number;
  };
  gradedAt: string;
  gradedBy: 'auto' | 'manual';
  confidence: number;
}

export interface QueueStatus {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
  workerRunning: boolean;
  recentErrors: Array<{ cardId: string; error: string; updatedAt: number }>;
}

export interface QueueItem {
  id: string;
  bookId: string;
  cardId: string;
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// API Client
// ============================================================================

const BOOK_STUDIO_SERVER_BASE = 'http://localhost:3004';

/**
 * Trigger full grading for a single card
 */
export async function gradeCard(
  cardId: string,
  immediate: boolean = false
): Promise<{ cardId: string; grade?: CardGrade; queued: boolean }> {
  const response = await fetch(
    `${BOOK_STUDIO_SERVER_BASE}/api/grading/cards/${cardId}/grade`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ immediate }),
    }
  );

  if (!response.ok) {
    throw new Error(`Grade request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Quick grade a card (no API calls, synchronous)
 */
export async function quickGradeCard(
  cardId: string
): Promise<{ cardId: string; grade: Partial<CardGrade>; quick: boolean }> {
  const response = await fetch(
    `${BOOK_STUDIO_SERVER_BASE}/api/grading/cards/${cardId}/grade/quick`,
    {
      method: 'POST',
    }
  );

  if (!response.ok) {
    throw new Error(`Quick grade request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Queue all cards in a book for grading
 */
export async function gradeAllCards(
  bookId: string,
  status?: string,
  priority?: number
): Promise<{ bookId: string; queued: number; total: number }> {
  const response = await fetch(
    `${BOOK_STUDIO_SERVER_BASE}/api/grading/books/${bookId}/grade-all`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, priority }),
    }
  );

  if (!response.ok) {
    throw new Error(`Grade all request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Get grading queue status
 */
export async function getQueueStatus(bookId?: string): Promise<QueueStatus> {
  const url = bookId
    ? `${BOOK_STUDIO_SERVER_BASE}/api/grading/queue/${bookId}`
    : `${BOOK_STUDIO_SERVER_BASE}/api/grading/queue`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Queue status request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Get queue items for a book
 */
export async function getQueueItems(
  bookId: string
): Promise<QueueStatus & { items: QueueItem[] }> {
  const response = await fetch(
    `${BOOK_STUDIO_SERVER_BASE}/api/grading/queue/${bookId}`
  );

  if (!response.ok) {
    throw new Error(`Queue items request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Clear the grading queue
 */
export async function clearQueue(bookId?: string): Promise<{ cleared: number }> {
  const url = bookId
    ? `${BOOK_STUDIO_SERVER_BASE}/api/grading/queue/${bookId}`
    : `${BOOK_STUDIO_SERVER_BASE}/api/grading/queue`;

  const response = await fetch(url, { method: 'DELETE' });

  if (!response.ok) {
    throw new Error(`Clear queue request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Retry failed queue items
 */
export async function retryFailed(bookId?: string): Promise<{ retried: number }> {
  const url = bookId
    ? `${BOOK_STUDIO_SERVER_BASE}/api/grading/queue/retry/${bookId}`
    : `${BOOK_STUDIO_SERVER_BASE}/api/grading/queue/retry`;

  const response = await fetch(url, { method: 'POST' });

  if (!response.ok) {
    throw new Error(`Retry failed request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Start the grading worker
 */
export async function startWorker(): Promise<{ running: boolean }> {
  const response = await fetch(
    `${BOOK_STUDIO_SERVER_BASE}/api/grading/worker/start`,
    { method: 'POST' }
  );

  if (!response.ok) {
    throw new Error(`Start worker request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Stop the grading worker
 */
export async function stopWorker(): Promise<{ running: boolean }> {
  const response = await fetch(
    `${BOOK_STUDIO_SERVER_BASE}/api/grading/worker/stop`,
    { method: 'POST' }
  );

  if (!response.ok) {
    throw new Error(`Stop worker request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Get worker status
 */
export async function getWorkerStatus(): Promise<{
  running: boolean;
  queueStatus: QueueStatus;
}> {
  const response = await fetch(
    `${BOOK_STUDIO_SERVER_BASE}/api/grading/worker/status`
  );

  if (!response.ok) {
    throw new Error(`Worker status request failed: ${response.status}`);
  }

  return response.json();
}

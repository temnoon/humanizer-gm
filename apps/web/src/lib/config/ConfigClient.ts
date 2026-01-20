/**
 * ConfigClient - Frontend Configuration API Client
 *
 * Reads/writes configuration from backend APIs.
 * Frontend only READS config from APIs.
 * No localStorage for business config.
 * UI-only preferences (theme, layout) can use localStorage separately.
 */

// ============================================================================
// Types - Archive Server Config
// ============================================================================

export interface HarvestConfig {
  defaultTarget: number;
  searchLimit: number;
  minWordCount: number;
  expandBreadcrumbs: boolean;
  contextSize: number;
  prioritizeConversations: boolean;
}

export interface CacheConfig {
  healthTtlMs: number;
  searchDebounceMs: number;
  embeddingCacheTtlMs: number;
}

export interface QualityGateConfig {
  targetCount: number;
  searchLimit: number;
  minQuality: number;
  minWordCount: number;
}

export interface HybridSearchConfig {
  denseWeight: number;
  sparseWeight: number;
  limit: number;
  fusionK: number;
}

export interface RetrievalConfig {
  qualityGate: QualityGateConfig;
  hybrid: HybridSearchConfig;
}

export interface RateLimitConfig {
  searchMaxRequests: number;
  searchWindowMs: number;
  importMaxRequests: number;
  importWindowMs: number;
}

export interface ArchiveServerConfig {
  harvest: HarvestConfig;
  cache: CacheConfig;
  retrieval: RetrievalConfig;
  rateLimit: RateLimitConfig;
}

// ============================================================================
// Types - Book Studio Server Config
// ============================================================================

export interface GradeWeights {
  authenticity: number;
  necessity: number;
  inflection: number;
  voice: number;
  clarity: number;
}

export interface GradingConfig {
  enableSIC: boolean;
  enableChekhov: boolean;
  enableQuantum: boolean;
  minWordsForAnalysis: number;
  runAt: 'harvest' | 'background' | 'hybrid';
  gradeWeights: GradeWeights;
}

export interface UIConfig {
  defaultStagingView: 'list' | 'cards' | 'kanban';
  showWordCounts: boolean;
  compactCards: boolean;
  autoExpandCards: boolean;
  showGradeDetails: boolean;
}

export interface DraftConfig {
  defaultModel: string;
  temperature: number;
  targetWordCount: number;
  maxTokens: number;
}

export interface OutlineDetectionConfig {
  enabled: boolean;
  minItemsForOutline: number;
}

export interface BookStudioServerConfig {
  grading: GradingConfig;
  ui: UIConfig;
  draft: DraftConfig;
  outlineDetection: OutlineDetectionConfig;
}

// ============================================================================
// API Endpoints
// ============================================================================

const ARCHIVE_SERVER_BASE = 'http://localhost:3002';
const BOOK_STUDIO_SERVER_BASE = 'http://localhost:3004';

// ============================================================================
// Archive Server Config Client
// ============================================================================

export async function getArchiveConfig(): Promise<ArchiveServerConfig> {
  const response = await fetch(`${ARCHIVE_SERVER_BASE}/api/config`);
  if (!response.ok) {
    throw new Error(`Failed to get archive config: ${response.status}`);
  }
  return response.json();
}

export async function getArchiveConfigSection<K extends keyof ArchiveServerConfig>(
  section: K
): Promise<ArchiveServerConfig[K]> {
  const response = await fetch(`${ARCHIVE_SERVER_BASE}/api/config/${section}`);
  if (!response.ok) {
    throw new Error(`Failed to get archive config section: ${response.status}`);
  }
  return response.json();
}

export async function updateArchiveConfig<K extends keyof ArchiveServerConfig>(
  section: K,
  values: Partial<ArchiveServerConfig[K]>
): Promise<ArchiveServerConfig[K]> {
  const response = await fetch(`${ARCHIVE_SERVER_BASE}/api/config/${section}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
  if (!response.ok) {
    throw new Error(`Failed to update archive config: ${response.status}`);
  }
  const result = await response.json();
  return result.config;
}

export async function resetArchiveConfig(): Promise<ArchiveServerConfig> {
  const response = await fetch(`${ARCHIVE_SERVER_BASE}/api/config/reset`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to reset archive config: ${response.status}`);
  }
  const result = await response.json();
  return result.config;
}

// ============================================================================
// Book Studio Server Config Client
// ============================================================================

export async function getBookStudioConfig(): Promise<BookStudioServerConfig> {
  const response = await fetch(`${BOOK_STUDIO_SERVER_BASE}/api/config`);
  if (!response.ok) {
    throw new Error(`Failed to get book studio config: ${response.status}`);
  }
  return response.json();
}

export async function getBookStudioConfigSection<K extends keyof BookStudioServerConfig>(
  section: K
): Promise<BookStudioServerConfig[K]> {
  const response = await fetch(`${BOOK_STUDIO_SERVER_BASE}/api/config/${section}`);
  if (!response.ok) {
    throw new Error(`Failed to get book studio config section: ${response.status}`);
  }
  return response.json();
}

export async function updateBookStudioConfig<K extends keyof BookStudioServerConfig>(
  section: K,
  values: Partial<BookStudioServerConfig[K]>
): Promise<BookStudioServerConfig[K]> {
  const response = await fetch(`${BOOK_STUDIO_SERVER_BASE}/api/config/${section}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
  if (!response.ok) {
    throw new Error(`Failed to update book studio config: ${response.status}`);
  }
  const result = await response.json();
  return result.config;
}

export async function resetBookStudioConfig(): Promise<BookStudioServerConfig> {
  const response = await fetch(`${BOOK_STUDIO_SERVER_BASE}/api/config/reset`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to reset book studio config: ${response.status}`);
  }
  const result = await response.json();
  return result.config;
}

// ============================================================================
// Unified Config Helper
// ============================================================================

export type Server = 'archive' | 'bookstudio';

export async function updateConfig(
  server: Server,
  section: string,
  values: object
): Promise<void> {
  if (server === 'archive') {
    await updateArchiveConfig(section as keyof ArchiveServerConfig, values as any);
  } else {
    await updateBookStudioConfig(section as keyof BookStudioServerConfig, values as any);
  }
}

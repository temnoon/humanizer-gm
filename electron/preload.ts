/**
 * Humanizer Desktop - Preload Script
 *
 * Exposes safe APIs to the renderer process via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface ElectronAPI {
  // Store
  store: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<boolean>;
  };

  // App info
  app: {
    paths: () => Promise<{
      documents: string;
      userData: string;
      home: string;
      temp: string;
    }>;
    info: () => Promise<{
      platform: NodeJS.Platform;
      arch: string;
      version: string;
      isPackaged: boolean;
    }>;
    isFirstRun: () => Promise<boolean>;
    completeFirstRun: () => Promise<boolean>;
  };

  // File dialogs
  dialog: {
    selectFolder: () => Promise<string | null>;
    selectFile: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
  };

  // Archive server (optional)
  archive: {
    port: () => Promise<number | null>;
    enabled: () => Promise<boolean>;
    enable: (archivePath?: string) => Promise<{ success: boolean; port?: number }>;
    disable: () => Promise<{ success: boolean }>;
    restart: (newPath?: string) => Promise<{ success: boolean; port?: number }>;
  };

  // Ollama (optional)
  ollama: {
    enabled: () => Promise<boolean>;
    enable: () => Promise<boolean>;
    disable: () => Promise<boolean>;
    status: () => Promise<{ installed: boolean; running: boolean }>;
  };

  // Whisper (local speech-to-text)
  whisper: {
    status: () => Promise<WhisperStatus>;
    modelsLocal: () => Promise<WhisperModel[]>;
    modelsAvailable: () => Promise<Array<{ name: string; size: string; downloaded: boolean }>>;
    downloadModel: (modelName: string) => Promise<{ success: boolean; error?: string }>;
    transcribe: (audioPath: string, modelName?: string) => Promise<TranscribeResult>;
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
    onTranscribeProgress: (callback: (progress: TranscribeProgress) => void) => () => void;
  };

  // NPE-Local (AI Detection, Transformations)
  npe: {
    port: () => Promise<number | null>;
    status: () => Promise<{
      running: boolean;
      port: number | null;
      service?: string;
      version?: string;
      ollama?: { available: boolean; url: string };
    }>;
  };

  // Cloud drives (to be added)
  cloudDrives: {
    listDrives: () => Promise<CloudDrive[]>;
    google: GoogleDriveAPI;
  };

  // Queue system for batch processing
  queue: QueueAPI;

  // Chat service (AUI)
  chat: ChatAPI;

  // Agent Council
  agents: AgentAPI;

  // AgentMaster (LLM abstraction with tiered prompts)
  agentMaster: AgentMasterAPI;

  // Xanadu Unified Storage (books, personas, styles, passages, chapters)
  xanadu: XanaduAPI;
}

export interface CloudDrive {
  id: string;
  provider: 'google' | 'dropbox' | 'onedrive' | 's3';
  name: string;
  icon: string;
}

export interface GoogleDriveAPI {
  connect: () => Promise<{ success: boolean; error?: string }>;
  isConnected: () => Promise<boolean>;
  disconnect: () => Promise<{ success: boolean }>;
  list: (folderId?: string, pageToken?: string) => Promise<{
    success: boolean;
    files?: GoogleDriveFile[];
    nextPageToken?: string;
    error?: string;
  }>;
  search: (query: string, pageToken?: string) => Promise<{
    success: boolean;
    files?: GoogleDriveFile[];
    nextPageToken?: string;
    error?: string;
  }>;
  download: (fileId: string) => Promise<{ success: boolean; content?: ArrayBuffer; error?: string }>;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  isFolder: boolean;
}

// Whisper (speech-to-text) types
export interface WhisperStatus {
  available: boolean;
  modelLoaded: boolean;
  currentModel: string | null;
  modelsPath: string;
  availableModels: string[];
}

export interface WhisperModel {
  name: string;
  size: string;
  path: string;
}

export interface TranscribeResult {
  success: boolean;
  result?: {
    text: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    language?: string;
    duration?: number;
  };
  error?: string;
}

export interface DownloadProgress {
  model: string;
  percent: number;
  downloaded: number;
  total: number;
}

export interface TranscribeProgress {
  status: 'loading' | 'transcribing' | 'complete' | 'error';
  progress: number;
  message?: string;
}

// ============================================================
// QUEUE TYPES (simplified for preload)
// ============================================================

export type QueueJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
export type QueueJobType = 'image-analysis' | 'image-embedding' | 'summarize' | 'extract' | 'transform' | 'index' | 'batch-read';

export interface QueueFileItem {
  path: string;
  size: number;
  id?: string;
  source?: 'local' | 'r2' | 'gdrive' | 'url';
}

export interface QueueJobSpec {
  type: QueueJobType;
  priority?: number;
  files: QueueFileItem[];
  options?: Record<string, unknown>;
  timeoutPerFile?: number;
  maxRetries?: number;
  concurrency?: number;
}

export interface QueueProgress {
  jobId: string;
  processed: number;
  total: number;
  percentComplete: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
  currentFile?: string;
  bytesProcessed: number;
  totalBytes: number;
  successCount: number;
  errorCount: number;
}

export interface QueueJob {
  id: string;
  spec: QueueJobSpec;
  status: QueueJobStatus;
  progress: QueueProgress;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  results: Array<{
    filePath: string;
    success: boolean;
    data?: unknown;
    error?: string;
    processingTimeMs: number;
  }>;
  error?: string;
}

export interface QueueState {
  isPaused: boolean;
  pendingCount: number;
  processingCount: number;
  totalJobs: number;
  activeConcurrency: number;
  maxConcurrency: number;
}

export interface QueueEvent {
  type: string;
  jobId?: string;
  job?: QueueJob;
  progress?: QueueProgress;
  timestamp: number;
}

export interface QueueAPI {
  createJob: (spec: QueueJobSpec) => Promise<{ success: boolean; jobId?: string; error?: string }>;
  getJob: (jobId: string) => Promise<QueueJob | null>;
  listJobs: (options?: { status?: QueueJobStatus | QueueJobStatus[]; type?: QueueJobType; limit?: number }) => Promise<QueueJob[]>;
  cancelJob: (jobId: string) => Promise<boolean>;
  deleteJob: (jobId: string) => Promise<boolean>;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  getState: () => Promise<QueueState>;
  onEvent: (callback: (event: QueueEvent) => void) => () => void;
}

// ============================================================
// CHAT TYPES
// ============================================================

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolResults?: ChatToolResult[];
  metadata?: Record<string, unknown>;
}

export interface ChatToolResult {
  toolName: string;
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
  agentId?: string;
  teaching?: {
    whatHappened: string;
    guiPath?: string[];
    shortcut?: string;
    why?: string;
  };
}

export interface ChatConversation {
  id: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  messageCount: number;
  tags: string[];
  archived: boolean;
  projectId?: string;
  preview?: string;
}

export interface ChatEvent {
  type: string;
  message?: ChatMessage;
  result?: ChatToolResult;
  error?: string;
  timestamp: number;
}

export interface ChatAPI {
  startConversation: (options?: { projectId?: string; tags?: string[] }) => Promise<ChatConversation>;
  getConversation: () => Promise<ChatConversation | null>;
  loadConversation: (id: string) => Promise<ChatConversation | null>;
  listConversations: (options?: { limit?: number; projectId?: string }) => Promise<ChatConversation[]>;
  getMessages: (conversationId?: string) => Promise<ChatMessage[]>;
  sendMessage: (content: string, options?: { projectId?: string; context?: string; executeTools?: boolean }) => Promise<ChatMessage[]>;
  endConversation: () => Promise<{ success: boolean }>;
  archiveConversation: (conversationId: string) => Promise<{ success: boolean }>;
  searchMessages: (query: string) => Promise<ChatMessage[]>;
  getStats: () => Promise<{ totalConversations: number; totalMessages: number; archivedConversations: number; toolExecutions: number }>;
  updateConfig: (updates: { llm?: { provider?: string; model?: string; apiKey?: string }; archiveUrl?: string; autoArchive?: boolean }) => Promise<{ success: boolean }>;
  onMessage: (callback: (event: ChatEvent) => void) => () => void;
  onToolExecuted: (callback: (event: ChatEvent) => void) => () => void;
  onError: (callback: (event: ChatEvent) => void) => () => void;
}

// ============================================================
// AGENT TYPES
// ============================================================

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'error' | 'disabled';

export interface AgentInfo {
  id: string;
  name: string;
  house: string;
  status: AgentStatus;
  capabilities: string[];
}

export interface AgentProposal {
  id: string;
  agentId: string;
  agentName: string;
  actionType: string;
  title: string;
  description?: string;
  payload: unknown;
  urgency: 'low' | 'normal' | 'high' | 'critical';
  projectId?: string;
  createdAt: number;
  expiresAt?: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto';
}

export interface AgentEvent {
  type: string;
  proposal?: AgentProposal;
  agent?: AgentInfo;
  taskId?: string;
  error?: string;
  timestamp: number;
}

export interface AgentTaskRequest {
  agentId: string;
  taskType: string;
  payload: unknown;
  projectId?: string;
}

export interface AgentAPI {
  // Agent queries
  listAgents: () => Promise<AgentInfo[]>;
  getAgent: (agentId: string) => Promise<AgentInfo | null>;

  // Proposal management
  getPendingProposals: (projectId?: string) => Promise<AgentProposal[]>;
  approveProposal: (proposalId: string) => Promise<{ success: boolean; error?: string }>;
  rejectProposal: (proposalId: string, reason?: string) => Promise<{ success: boolean }>;

  // Task dispatch
  requestTask: (request: AgentTaskRequest) => Promise<{ taskId?: string; error?: string }>;
  getTaskStatus: (taskId: string) => Promise<{ status: string; result?: unknown; error?: string }>;

  // Session management
  startSession: (projectId?: string) => Promise<{ sessionId: string }>;
  endSession: (sessionId: string, summary?: string) => Promise<{ success: boolean }>;

  // Stats
  getStats: () => Promise<{
    activeSessions: number;
    pendingProposals: number;
    registeredAgents: number;
    activeAgents: number;
  }>;

  // Event subscriptions
  onProposal: (callback: (event: AgentEvent) => void) => () => void;
  onAgentStatus: (callback: (event: AgentEvent) => void) => () => void;
  onSessionEvent: (callback: (event: AgentEvent) => void) => () => void;
}

export type MemoryTier = 'tiny' | 'standard' | 'full';

export interface DeviceProfile {
  tier: MemoryTier;
  ramGB: number;
  preferLocal: boolean;
  detectedAt: number;
  userOverride?: boolean;
}

export interface TierInfo {
  tier: MemoryTier;
  description: string;
  recommendedModels: string[];
  profile?: DeviceProfile;
}

export interface AgentMasterAPI {
  // Get current device profile (includes tier)
  getProfile: () => Promise<DeviceProfile>;

  // Set tier override for testing (e.g., simulate 8GB device on 32GB machine)
  setTier: (tier: MemoryTier) => Promise<TierInfo>;

  // Clear tier override and use auto-detection
  clearOverride: () => Promise<TierInfo>;

  // Get info about a specific tier
  getTierInfo: (tier: MemoryTier) => Promise<TierInfo>;

  // List available capabilities
  getCapabilities: () => Promise<string[]>;
}

// ============================================================
// XANADU UNIFIED STORAGE TYPES
// ============================================================

export type CurationStatus = 'candidate' | 'approved' | 'rejected' | 'gem' | 'needs-work';
export type BookStatus = 'harvesting' | 'drafting' | 'revising' | 'mastering' | 'complete';
export type ChapterStatus = 'outline' | 'draft' | 'revision' | 'final';

export interface XanaduBook {
  id: string;
  uri: string;
  name: string;
  subtitle?: string;
  author?: string;
  description?: string;
  status: BookStatus;
  bookType?: 'book' | 'paper';
  personaRefs?: string[];
  styleRefs?: string[];
  sourceRefs?: unknown[];
  threads?: unknown[];
  harvestConfig?: unknown;
  editorial?: unknown;
  thinking?: unknown;
  pyramidId?: string;
  stats?: unknown;
  profile?: unknown;
  tags?: string[];
  isLibrary?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface XanaduPersona {
  id: string;
  uri: string;
  name: string;
  description?: string;
  author?: string;
  voice?: unknown;
  vocabulary?: unknown;
  derivedFrom?: unknown[];
  influences?: unknown[];
  exemplars?: unknown[];
  systemPrompt?: string;
  embedding?: ArrayBuffer;
  embeddingModel?: string;
  tags?: string[];
  isLibrary?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface XanaduStyle {
  id: string;
  uri: string;
  name: string;
  description?: string;
  author?: string;
  characteristics?: unknown;
  structure?: unknown;
  stylePrompt?: string;
  derivedFrom?: unknown[];
  embedding?: ArrayBuffer;
  embeddingModel?: string;
  tags?: string[];
  isLibrary?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface XanaduPassage {
  id: string;
  bookId: string;
  sourceRef?: unknown;
  text: string;
  wordCount?: number;
  role?: string;
  harvestedBy?: string;
  threadId?: string;
  curationStatus: CurationStatus;
  curationNote?: string;
  chapterId?: string;
  tags?: string[];
  embedding?: ArrayBuffer;
  embeddingModel?: string;
  createdAt: number;
}

export interface XanaduChapter {
  id: string;
  bookId: string;
  number: number;
  title: string;
  content?: string;
  wordCount?: number;
  version?: number;
  status: ChapterStatus;
  epigraph?: string;
  sections?: unknown[];
  marginalia?: unknown[];
  metadata?: unknown;
  passageRefs?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface XanaduChapterVersion {
  id: string;
  chapterId: string;
  version: number;
  content: string;
  wordCount?: number;
  changes?: string;
  createdBy?: string;
  createdAt: number;
}

export type HarvestBucketStatus = 'collecting' | 'reviewing' | 'staged' | 'committed' | 'discarded';
export type NarrativeArcType = 'thematic' | 'chronological' | 'argumentative' | 'character';
export type PassageLinkUsageType = 'quote' | 'reference' | 'paraphrase' | 'inspiration';

export interface XanaduHarvestBucket {
  id: string;
  bookId: string;
  bookUri: string;
  status: HarvestBucketStatus;
  queries?: string[];
  candidates?: unknown[];
  approved?: unknown[];
  gems?: unknown[];
  rejected?: unknown[];
  duplicateIds?: string[];
  config?: unknown;
  threadUri?: string;
  stats?: unknown;
  initiatedBy?: 'user' | 'aui';
  createdAt: number;
  updatedAt?: number;
  completedAt?: number;
  finalizedAt?: number;
}

export interface XanaduNarrativeArc {
  id: string;
  bookId: string;
  bookUri: string;
  thesis: string;
  arcType: NarrativeArcType;
  evaluation?: {
    status: 'pending' | 'approved' | 'rejected';
    feedback?: string;
    evaluatedAt?: number;
  };
  proposedBy?: 'user' | 'aui';
  createdAt: number;
  updatedAt?: number;
}

export interface XanaduPassageLink {
  id: string;
  passageId: string;
  chapterId: string;
  position: number;
  sectionId?: string;
  usageType: PassageLinkUsageType;
  createdBy?: 'user' | 'aui';
  createdAt: number;
}

// Harvest curation result types
export interface HarvestCurationResult {
  success: boolean;
  error?: string;
  fromArray?: string;
}

export interface HarvestStageResult {
  success: boolean;
  error?: string;
  approvedCount?: number;
  gemCount?: number;
}

export interface HarvestCommitResult {
  success: boolean;
  error?: string;
  passageCount?: number;
}

export interface XanaduAPI {
  // Harvest curation operations (atomic passage moves + lifecycle)
  harvest: {
    approvePassage: (bucketId: string, passageId: string) => Promise<HarvestCurationResult>;
    rejectPassage: (bucketId: string, passageId: string, reason?: string) => Promise<HarvestCurationResult>;
    gemPassage: (bucketId: string, passageId: string) => Promise<HarvestCurationResult>;
    undoPassage: (bucketId: string, passageId: string) => Promise<HarvestCurationResult>;
    finishCollecting: (bucketId: string) => Promise<{ success: boolean; error?: string }>;
    stageBucket: (bucketId: string) => Promise<HarvestStageResult>;
    commitBucket: (bucketId: string) => Promise<HarvestCommitResult>;
    discardBucket: (bucketId: string) => Promise<{ success: boolean; error?: string }>;
  };

  // Book operations
  books: {
    list: (includeLibrary?: boolean) => Promise<XanaduBook[]>;
    get: (idOrUri: string) => Promise<XanaduBook | null>;
    upsert: (book: Partial<XanaduBook> & { id: string; uri: string; name: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Persona operations
  personas: {
    list: (includeLibrary?: boolean) => Promise<XanaduPersona[]>;
    get: (idOrUri: string) => Promise<XanaduPersona | null>;
    upsert: (persona: Partial<XanaduPersona> & { id: string; uri: string; name: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Style operations
  styles: {
    list: (includeLibrary?: boolean) => Promise<XanaduStyle[]>;
    get: (idOrUri: string) => Promise<XanaduStyle | null>;
    upsert: (style: Partial<XanaduStyle> & { id: string; uri: string; name: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Passage operations
  passages: {
    list: (bookId: string, curationStatus?: CurationStatus) => Promise<XanaduPassage[]>;
    upsert: (passage: Partial<XanaduPassage> & { id: string; bookId: string; text: string }) => Promise<{ success: boolean; id: string }>;
    curate: (id: string, status: CurationStatus, note?: string) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Chapter operations
  chapters: {
    list: (bookId: string) => Promise<XanaduChapter[]>;
    get: (id: string) => Promise<XanaduChapter | null>;
    upsert: (chapter: Partial<XanaduChapter> & { id: string; bookId: string; number: number; title: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
    fill: (chapterId: string, bookId: string, options?: { style?: string; targetWords?: number; additionalQueries?: string[] }) => Promise<{
      success: boolean;
      chapter?: { id: string; title: string; content: string; wordCount: number };
      stats?: { passagesFound: number; passagesUsed: number; generationTimeMs: number; queriesUsed: string[] };
      error?: string;
    }>;
  };

  // Version operations
  versions: {
    list: (chapterId: string) => Promise<XanaduChapterVersion[]>;
    save: (chapterId: string, version: number, content: string, changes?: string, createdBy?: string) => Promise<{ success: boolean }>;
  };

  // Harvest bucket operations
  harvestBuckets: {
    list: (bookUri?: string) => Promise<XanaduHarvestBucket[]>;
    get: (id: string) => Promise<XanaduHarvestBucket | null>;
    upsert: (bucket: Partial<XanaduHarvestBucket> & { id: string; bookId: string; bookUri: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Narrative arc operations
  narrativeArcs: {
    list: (bookUri: string) => Promise<XanaduNarrativeArc[]>;
    get: (id: string) => Promise<XanaduNarrativeArc | null>;
    upsert: (arc: Partial<XanaduNarrativeArc> & { id: string; bookId: string; bookUri: string; thesis: string }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Passage link operations
  passageLinks: {
    listByChapter: (chapterId: string) => Promise<XanaduPassageLink[]>;
    listByPassage: (passageId: string) => Promise<XanaduPassageLink[]>;
    upsert: (link: Partial<XanaduPassageLink> & { id: string; passageId: string; chapterId: string; position: number }) => Promise<{ success: boolean; id: string }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Passage analysis operations
  analyze: {
    passage: (passageId: string, text: string, config?: AnalysisConfig) => Promise<AnalysisResult>;
    passages: (passages: Array<{ id: string; text: string }>, config?: AnalysisConfig) => Promise<AnalysisResultBatch>;
  };

  // Library seeding
  seedLibrary: () => Promise<{ success: boolean; alreadySeeded?: boolean; error?: string }>;
}

// Analysis types
export interface AnalysisConfig {
  bookId?: string;
  bookTheme?: string;
  enableQuantum?: boolean;
  enableAiDetection?: boolean;
  enableResonance?: boolean;
  model?: 'local' | 'cloud';
}

export interface PassageAnalysis {
  passageId: string;
  text: string;
  quantum: {
    stance: 'literal' | 'metaphorical' | 'both' | 'neither';
    probabilities: { literal: number; metaphorical: number; both: number; neither: number };
    entropy: number;
  };
  aiDetection: {
    score: number;
    confidence: number;
    features: { burstiness: number; vocabularyDiversity: number; avgSentenceLength: number; tellPhraseCount: number };
  };
  resonance: {
    score: number;
    matchedThemes: string[];
  };
  recommendation: {
    action: 'approve' | 'gem' | 'reject' | 'review';
    confidence: number;
    reasons: string[];
  };
  analyzedAt: number;
}

export interface AnalysisResult {
  success: boolean;
  error?: string;
  analysis?: PassageAnalysis;
}

export interface AnalysisResultBatch {
  success: boolean;
  error?: string;
  analyses?: PassageAnalysis[];
}

// ============================================================
// EXPOSE API
// ============================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // Store
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  },

  // App info
  app: {
    paths: () => ipcRenderer.invoke('app:paths'),
    info: () => ipcRenderer.invoke('app:info'),
    isFirstRun: () => ipcRenderer.invoke('app:is-first-run'),
    completeFirstRun: () => ipcRenderer.invoke('app:complete-first-run'),
  },

  // File dialogs
  dialog: {
    selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
    selectFile: (options) => ipcRenderer.invoke('dialog:select-file', options),
  },

  // Archive server
  archive: {
    port: () => ipcRenderer.invoke('archive:port'),
    enabled: () => ipcRenderer.invoke('archive:enabled'),
    enable: (archivePath?: string) => ipcRenderer.invoke('archive:enable', archivePath),
    disable: () => ipcRenderer.invoke('archive:disable'),
    restart: (newPath?: string) => ipcRenderer.invoke('archive:restart', newPath),
  },

  // Ollama
  ollama: {
    enabled: () => ipcRenderer.invoke('ollama:enabled'),
    enable: () => ipcRenderer.invoke('ollama:enable'),
    disable: () => ipcRenderer.invoke('ollama:disable'),
    status: () => ipcRenderer.invoke('ollama:status'),
  },

  // Whisper (local speech-to-text)
  whisper: {
    status: () => ipcRenderer.invoke('whisper:status'),
    modelsLocal: () => ipcRenderer.invoke('whisper:models:local'),
    modelsAvailable: () => ipcRenderer.invoke('whisper:models:available'),
    downloadModel: (modelName: string) => ipcRenderer.invoke('whisper:models:download', modelName),
    transcribe: (audioPath: string, modelName?: string) =>
      ipcRenderer.invoke('whisper:transcribe', audioPath, modelName),
    onDownloadProgress: (callback: (progress: { model: string; percent: number; downloaded: number; total: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: { model: string; percent: number; downloaded: number; total: number }) => callback(progress);
      ipcRenderer.on('whisper:download-progress', handler);
      return () => ipcRenderer.removeListener('whisper:download-progress', handler);
    },
    onTranscribeProgress: (callback: (progress: { status: string; progress: number; message?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: { status: string; progress: number; message?: string }) => callback(progress);
      ipcRenderer.on('whisper:transcribe-progress', handler);
      return () => ipcRenderer.removeListener('whisper:transcribe-progress', handler);
    },
  },

  // NPE-Local (AI Detection, Transformations)
  npe: {
    port: () => ipcRenderer.invoke('npe:port'),
    status: () => ipcRenderer.invoke('npe:status'),
  },

  // Shell - open URLs in external browser
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  },

  // Auth - OAuth handling
  auth: {
    // Get OAuth callback port (for development localhost server)
    getCallbackPort: () => ipcRenderer.invoke('auth:callback-port'),
    // Listen for OAuth callback from deep link or localhost server
    onOAuthCallback: (callback: (data: { token: string; isNewUser: boolean }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { token: string; isNewUser: boolean }) => callback(data);
      ipcRenderer.on('auth:oauth-callback', handler);
      return () => ipcRenderer.removeListener('auth:oauth-callback', handler);
    },
  },

  // Cloud drives - stubs for now, will be implemented
  cloudDrives: {
    listDrives: () => ipcRenderer.invoke('cloud:list-drives'),
    google: {
      connect: () => ipcRenderer.invoke('cloud:google:connect'),
      isConnected: () => ipcRenderer.invoke('cloud:google:is-connected'),
      disconnect: () => ipcRenderer.invoke('cloud:google:disconnect'),
      list: (folderId?: string, pageToken?: string) =>
        ipcRenderer.invoke('cloud:google:list', folderId, pageToken),
      search: (query: string, pageToken?: string) =>
        ipcRenderer.invoke('cloud:google:search', query, pageToken),
      download: (fileId: string) => ipcRenderer.invoke('cloud:google:download', fileId),
    },
  },

  // Queue system for batch processing
  queue: {
    createJob: (spec: QueueJobSpec) => ipcRenderer.invoke('queue:create-job', spec),
    getJob: (jobId: string) => ipcRenderer.invoke('queue:get-job', jobId),
    listJobs: (options) => ipcRenderer.invoke('queue:list-jobs', options),
    cancelJob: (jobId: string) => ipcRenderer.invoke('queue:cancel-job', jobId),
    deleteJob: (jobId: string) => ipcRenderer.invoke('queue:delete-job', jobId),
    pause: () => ipcRenderer.invoke('queue:pause'),
    resume: () => ipcRenderer.invoke('queue:resume'),
    getState: () => ipcRenderer.invoke('queue:state'),
    onEvent: (callback: (event: QueueEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, queueEvent: QueueEvent) => {
        callback(queueEvent);
      };
      ipcRenderer.on('queue:event', handler);
      // Return unsubscribe function
      return () => {
        ipcRenderer.removeListener('queue:event', handler);
      };
    },
  },

  // Chat service (AUI)
  chat: {
    startConversation: (options) => ipcRenderer.invoke('chat:start-conversation', options),
    getConversation: () => ipcRenderer.invoke('chat:get-conversation'),
    loadConversation: (id: string) => ipcRenderer.invoke('chat:load-conversation', id),
    listConversations: (options) => ipcRenderer.invoke('chat:list-conversations', options),
    getMessages: (conversationId?: string) => ipcRenderer.invoke('chat:get-messages', conversationId),
    sendMessage: (content: string, options) => ipcRenderer.invoke('chat:send-message', content, options),
    endConversation: () => ipcRenderer.invoke('chat:end-conversation'),
    archiveConversation: (conversationId: string) => ipcRenderer.invoke('chat:archive-conversation', conversationId),
    searchMessages: (query: string) => ipcRenderer.invoke('chat:search-messages', query),
    getStats: () => ipcRenderer.invoke('chat:stats'),
    updateConfig: (updates) => ipcRenderer.invoke('chat:update-config', updates),
    onMessage: (callback: (event: ChatEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, chatEvent: ChatEvent) => {
        callback(chatEvent);
      };
      ipcRenderer.on('chat:message', handler);
      return () => {
        ipcRenderer.removeListener('chat:message', handler);
      };
    },
    onToolExecuted: (callback: (event: ChatEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, chatEvent: ChatEvent) => {
        callback(chatEvent);
      };
      ipcRenderer.on('chat:tool-executed', handler);
      return () => {
        ipcRenderer.removeListener('chat:tool-executed', handler);
      };
    },
    onError: (callback: (event: ChatEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, chatEvent: ChatEvent) => {
        callback(chatEvent);
      };
      ipcRenderer.on('chat:error', handler);
      return () => {
        ipcRenderer.removeListener('chat:error', handler);
      };
    },
  },

  // Agent Council
  agents: {
    // Agent queries
    listAgents: () => ipcRenderer.invoke('agents:list'),
    getAgent: (agentId: string) => ipcRenderer.invoke('agents:get', agentId),

    // Proposal management
    getPendingProposals: (projectId?: string) => ipcRenderer.invoke('agents:proposals:pending', projectId),
    approveProposal: (proposalId: string) => ipcRenderer.invoke('agents:proposals:approve', proposalId),
    rejectProposal: (proposalId: string, reason?: string) => ipcRenderer.invoke('agents:proposals:reject', proposalId, reason),

    // Task dispatch
    requestTask: (request: AgentTaskRequest) => ipcRenderer.invoke('agents:task:request', request),
    getTaskStatus: (taskId: string) => ipcRenderer.invoke('agents:task:status', taskId),

    // Session management
    startSession: (projectId?: string) => ipcRenderer.invoke('agents:session:start', projectId),
    endSession: (sessionId: string, summary?: string) => ipcRenderer.invoke('agents:session:end', sessionId, summary),

    // Stats
    getStats: () => ipcRenderer.invoke('agents:stats'),

    // Event subscriptions
    onProposal: (callback: (event: AgentEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, agentEvent: AgentEvent) => {
        callback(agentEvent);
      };
      ipcRenderer.on('agents:proposal', handler);
      return () => {
        ipcRenderer.removeListener('agents:proposal', handler);
      };
    },
    onAgentStatus: (callback: (event: AgentEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, agentEvent: AgentEvent) => {
        callback(agentEvent);
      };
      ipcRenderer.on('agents:status', handler);
      return () => {
        ipcRenderer.removeListener('agents:status', handler);
      };
    },
    onSessionEvent: (callback: (event: AgentEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, agentEvent: AgentEvent) => {
        callback(agentEvent);
      };
      ipcRenderer.on('agents:session', handler);
      return () => {
        ipcRenderer.removeListener('agents:session', handler);
      };
    },
  },

  // AgentMaster (LLM abstraction with tiered prompts)
  agentMaster: {
    getProfile: () => ipcRenderer.invoke('agent-master:get-profile'),
    setTier: (tier: MemoryTier) => ipcRenderer.invoke('agent-master:set-tier', tier),
    clearOverride: () => ipcRenderer.invoke('agent-master:clear-override'),
    getTierInfo: (tier: MemoryTier) => ipcRenderer.invoke('agent-master:tier-info', tier),
    getCapabilities: () => ipcRenderer.invoke('agent-master:capabilities'),
  },

  // Xanadu Unified Storage
  xanadu: {
    // Harvest curation operations (atomic passage moves + lifecycle)
    harvest: {
      approvePassage: (bucketId: string, passageId: string) =>
        ipcRenderer.invoke('xanadu:harvest:approve-passage', bucketId, passageId),
      rejectPassage: (bucketId: string, passageId: string, reason?: string) =>
        ipcRenderer.invoke('xanadu:harvest:reject-passage', bucketId, passageId, reason),
      gemPassage: (bucketId: string, passageId: string) =>
        ipcRenderer.invoke('xanadu:harvest:gem-passage', bucketId, passageId),
      undoPassage: (bucketId: string, passageId: string) =>
        ipcRenderer.invoke('xanadu:harvest:undo-passage', bucketId, passageId),
      finishCollecting: (bucketId: string) =>
        ipcRenderer.invoke('xanadu:harvest:finish-collecting', bucketId),
      stageBucket: (bucketId: string) =>
        ipcRenderer.invoke('xanadu:harvest:stage-bucket', bucketId),
      commitBucket: (bucketId: string) =>
        ipcRenderer.invoke('xanadu:harvest:commit-bucket', bucketId),
      discardBucket: (bucketId: string) =>
        ipcRenderer.invoke('xanadu:harvest:discard-bucket', bucketId),
    },
    books: {
      list: (includeLibrary?: boolean) => ipcRenderer.invoke('xanadu:book:list', includeLibrary),
      get: (idOrUri: string) => ipcRenderer.invoke('xanadu:book:get', idOrUri),
      upsert: (book) => ipcRenderer.invoke('xanadu:book:upsert', book),
      delete: (id: string) => ipcRenderer.invoke('xanadu:book:delete', id),
    },
    personas: {
      list: (includeLibrary?: boolean) => ipcRenderer.invoke('xanadu:persona:list', includeLibrary),
      get: (idOrUri: string) => ipcRenderer.invoke('xanadu:persona:get', idOrUri),
      upsert: (persona) => ipcRenderer.invoke('xanadu:persona:upsert', persona),
      delete: (id: string) => ipcRenderer.invoke('xanadu:persona:delete', id),
    },
    styles: {
      list: (includeLibrary?: boolean) => ipcRenderer.invoke('xanadu:style:list', includeLibrary),
      get: (idOrUri: string) => ipcRenderer.invoke('xanadu:style:get', idOrUri),
      upsert: (style) => ipcRenderer.invoke('xanadu:style:upsert', style),
      delete: (id: string) => ipcRenderer.invoke('xanadu:style:delete', id),
    },
    passages: {
      list: (bookId: string, curationStatus?: string) => ipcRenderer.invoke('xanadu:passage:list', bookId, curationStatus),
      upsert: (passage) => ipcRenderer.invoke('xanadu:passage:upsert', passage),
      curate: (id: string, status: string, note?: string) => ipcRenderer.invoke('xanadu:passage:curate', id, status, note),
      delete: (id: string) => ipcRenderer.invoke('xanadu:passage:delete', id),
    },
    chapters: {
      list: (bookId: string) => ipcRenderer.invoke('xanadu:chapter:list', bookId),
      get: (id: string) => ipcRenderer.invoke('xanadu:chapter:get', id),
      upsert: (chapter) => ipcRenderer.invoke('xanadu:chapter:upsert', chapter),
      delete: (id: string) => ipcRenderer.invoke('xanadu:chapter:delete', id),
      fill: (chapterId: string, bookId: string, options?: Record<string, unknown>) =>
        ipcRenderer.invoke('xanadu:chapter:fill', chapterId, bookId, options),
    },
    versions: {
      list: (chapterId: string) => ipcRenderer.invoke('xanadu:version:list', chapterId),
      save: (chapterId: string, version: number, content: string, changes?: string, createdBy?: string) =>
        ipcRenderer.invoke('xanadu:version:save', chapterId, version, content, changes, createdBy),
    },
    harvestBuckets: {
      list: (bookUri?: string) => ipcRenderer.invoke('xanadu:harvest-bucket:list', bookUri),
      get: (id: string) => ipcRenderer.invoke('xanadu:harvest-bucket:get', id),
      upsert: (bucket) => ipcRenderer.invoke('xanadu:harvest-bucket:upsert', bucket),
      delete: (id: string) => ipcRenderer.invoke('xanadu:harvest-bucket:delete', id),
    },
    narrativeArcs: {
      list: (bookUri: string) => ipcRenderer.invoke('xanadu:narrative-arc:list', bookUri),
      get: (id: string) => ipcRenderer.invoke('xanadu:narrative-arc:get', id),
      upsert: (arc) => ipcRenderer.invoke('xanadu:narrative-arc:upsert', arc),
      delete: (id: string) => ipcRenderer.invoke('xanadu:narrative-arc:delete', id),
    },
    passageLinks: {
      listByChapter: (chapterId: string) => ipcRenderer.invoke('xanadu:passage-link:list-by-chapter', chapterId),
      listByPassage: (passageId: string) => ipcRenderer.invoke('xanadu:passage-link:list-by-passage', passageId),
      upsert: (link) => ipcRenderer.invoke('xanadu:passage-link:upsert', link),
      delete: (id: string) => ipcRenderer.invoke('xanadu:passage-link:delete', id),
    },
    analyze: {
      passage: (passageId: string, text: string, config?: AnalysisConfig) =>
        ipcRenderer.invoke('xanadu:analyze:passage', passageId, text, config),
      passages: (passages: Array<{ id: string; text: string }>, config?: AnalysisConfig) =>
        ipcRenderer.invoke('xanadu:analyze:passages', passages, config),
    },
    seedLibrary: () => ipcRenderer.invoke('xanadu:seed-library'),
  },
} as ElectronAPI);

// Flag to detect Electron environment
contextBridge.exposeInMainWorld('isElectron', true);

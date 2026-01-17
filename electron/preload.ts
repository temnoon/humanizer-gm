/**
 * Humanizer Desktop - Preload Script
 *
 * Exposes safe APIs to the renderer process via contextBridge.
 * Types are modularized in ./preload/types/
 */

import { contextBridge, ipcRenderer } from 'electron';

// Re-export all types for external use
export type {
  // Core types
  ElectronAPI,
  CloudDrive,
  GoogleDriveAPI,
  GoogleDriveFile,
  WhisperStatus,
  WhisperModel,
  TranscribeResult,
  DownloadProgress,
  TranscribeProgress,
  // Queue types
  QueueJobStatus,
  QueueJobType,
  QueueFileItem,
  QueueJobSpec,
  QueueProgress,
  QueueJob,
  QueueState,
  QueueEvent,
  QueueAPI,
  // Chat types
  MessageRole,
  ChatMessage,
  ChatToolResult,
  ChatConversation,
  ChatEvent,
  ChatAPI,
  // Agent types
  AgentStatus,
  AgentInfo,
  AgentProposal,
  AgentEvent,
  AgentTaskRequest,
  AgentAPI,
  MemoryTier,
  DeviceProfile,
  TierInfo,
  AgentMasterAPI,
  // Xanadu types
  CurationStatus,
  BookStatus,
  ChapterStatus,
  XanaduBook,
  XanaduPersona,
  XanaduStyle,
  XanaduPassage,
  XanaduChapter,
  XanaduChapterVersion,
  HarvestBucketStatus,
  NarrativeArcType,
  PassageLinkUsageType,
  XanaduHarvestBucket,
  XanaduNarrativeArc,
  XanaduPassageLink,
  HarvestCurationResult,
  HarvestStageResult,
  HarvestCommitResult,
  AnalysisConfig,
  PassageAnalysis,
  AnalysisResult,
  AnalysisResultBatch,
  DraftJobStatus,
  DraftStyle,
  DraftProgress,
  DraftEvent,
  XanaduAPI,
} from './preload/types';

// Import types for use in this file
import type {
  ElectronAPI,
  QueueJobSpec,
  QueueEvent,
  ChatEvent,
  AgentEvent,
  AgentTaskRequest,
  MemoryTier,
  AnalysisConfig,
  DraftProgress,
  DraftEvent,
} from './preload/types';

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

    // Draft generation - iterative chapter generation with pause/resume
    draft: {
      start: (params: {
        bookUri: string;
        chapterId: string;
        arcId?: string;
        style?: 'academic' | 'narrative' | 'conversational';
        wordsPerSection?: number;
      }) => ipcRenderer.invoke('draft:start', params),

      pause: (jobId: string) => ipcRenderer.invoke('draft:pause', jobId),

      resume: (jobId: string) => ipcRenderer.invoke('draft:resume', jobId),

      status: (jobId: string) => ipcRenderer.invoke('draft:status', jobId),

      list: () => ipcRenderer.invoke('draft:list'),

      // Subscribe to progress events
      onProgress: (callback: (progress: DraftProgress) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, progress: DraftProgress) => callback(progress);
        ipcRenderer.on('draft:progress', handler);
        return () => ipcRenderer.removeListener('draft:progress', handler);
      },

      // Subscribe to all draft events
      onEvent: (callback: (event: DraftEvent) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, draftEvent: DraftEvent) => callback(draftEvent);
        ipcRenderer.on('draft:event', handler);
        return () => ipcRenderer.removeListener('draft:event', handler);
      },
    },
  },

  // AI Configuration (API keys, model config, usage)
  aiConfig: {
    // Provider management
    getProviders: () => ipcRenderer.invoke('ai-config:get-providers'),
    setApiKey: (provider: string, apiKey: string) =>
      ipcRenderer.invoke('ai-config:set-api-key', provider, apiKey),
    removeKey: (provider: string) =>
      ipcRenderer.invoke('ai-config:remove-key', provider),
    validateKey: (provider: string) =>
      ipcRenderer.invoke('ai-config:validate-key', provider),

    // Usage statistics
    getUsage: () => ipcRenderer.invoke('ai-config:get-usage'),
    getUsageStats: () => ipcRenderer.invoke('ai-config:get-usage-stats'),

    // Usage tracking & sync
    syncUsage: (authToken: string) =>
      ipcRenderer.invoke('ai-config:sync-usage', authToken),
    getRemoteMetrics: (authToken: string) =>
      ipcRenderer.invoke('ai-config:get-remote-metrics', authToken),
    clearLocalUsage: () => ipcRenderer.invoke('ai-config:clear-local-usage'),
    exportUsage: () => ipcRenderer.invoke('ai-config:export-usage'),
    importUsage: (data: { records: unknown[] }) =>
      ipcRenderer.invoke('ai-config:import-usage', data),

    // Model configuration
    getModelConfig: () => ipcRenderer.invoke('ai-config:get-model-config'),
    setModelConfig: (updates: Record<string, unknown>) =>
      ipcRenderer.invoke('ai-config:set-model-config', updates),

    // Provider health
    getHealth: () => ipcRenderer.invoke('ai-config:get-health'),
  },
} as ElectronAPI);

// Flag to detect Electron environment
contextBridge.exposeInMainWorld('isElectron', true);

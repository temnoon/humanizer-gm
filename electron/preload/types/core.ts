/**
 * Core Preload Types
 *
 * ElectronAPI interface, cloud drive types, whisper types
 */

import type { QueueAPI } from './queue';
import type { ChatAPI } from './chat';
import type { AgentAPI, AgentMasterAPI } from './agents';
import type { XanaduAPI } from './xanadu';

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

  // AI Configuration (API keys, model config, usage)
  aiConfig: AIConfigAPI;
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

// AI Configuration types
export interface AIConfigAPI {
  // Provider management
  getProviders: () => Promise<ProviderStatus[]>;
  setApiKey: (provider: string, apiKey: string) => Promise<{ success: boolean; error?: string }>;
  removeKey: (provider: string) => Promise<{ success: boolean; error?: string }>;
  validateKey: (provider: string) => Promise<{ valid: boolean; error?: string }>;

  // Usage statistics
  getUsage: () => Promise<UsageStats>;

  // Model configuration
  getModelConfig: () => Promise<{
    defaultModel: string;
    ollamaUrl: string;
    preferLocal: boolean;
    cloudflareAccountId?: string;
  }>;
  setModelConfig: (updates: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;

  // Provider health
  getHealth: () => Promise<Record<string, { available: boolean; failCount: number; cooldownRemaining: number }>>;
}

export interface ProviderStatus {
  provider: string;
  configured: boolean;
  encrypted: boolean;
  enabled: boolean;
  endpoint?: string;
  health?: {
    available: boolean;
    failCount: number;
    cooldownRemaining: number;
  };
}

export interface UsageStats {
  daily: {
    totalTokens: number;
    totalCost: number;
    requestCount: number;
    successRate: number;
    formatted: {
      tokens: string;
      cost: string;
    };
  };
  monthly: {
    totalTokens: number;
    totalCost: number;
    requestCount: number;
    successRate: number;
    formatted: {
      tokens: string;
      cost: string;
    };
  };
  projected: {
    monthlyCost: number;
    formatted: string;
  };
}

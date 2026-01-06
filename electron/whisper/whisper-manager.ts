/**
 * Whisper Manager
 *
 * Manages whisper.cpp integration for local speech-to-text.
 * Follows the same pattern as Ollama integration.
 *
 * Uses @kutalia/whisper-node-addon for pre-built binaries.
 */

import { app, ipcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

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

export interface TranscriptionResult {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  language?: string;
  duration?: number;
}

export interface TranscriptionProgress {
  status: 'loading' | 'transcribing' | 'complete' | 'error';
  progress: number;
  message?: string;
}

// ═══════════════════════════════════════════════════════════════════
// MODULE STATE
// ═══════════════════════════════════════════════════════════════════

let whisperModule: any = null;
let currentModel: string | null = null;
let modelsPath: string = '';

// Model URLs from Hugging Face
const MODEL_URLS: Record<string, { url: string; size: string }> = {
  'ggml-tiny.en.bin': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    size: '75 MB',
  },
  'ggml-base.en.bin': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    size: '142 MB',
  },
  'ggml-small.en.bin': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    size: '466 MB',
  },
  'ggml-medium.en.bin': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
    size: '1.5 GB',
  },
  'ggml-large-v3-turbo.bin': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
    size: '1.6 GB',
  },
};

// ═══════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Initialize whisper module and models directory
 */
export async function initWhisper(): Promise<boolean> {
  try {
    // Set up models directory
    modelsPath = path.join(app.getPath('userData'), 'whisper-models');
    if (!fs.existsSync(modelsPath)) {
      fs.mkdirSync(modelsPath, { recursive: true });
    }

    // Try to load the whisper module
    try {
      // Dynamic import to handle case where package isn't installed
      whisperModule = await import('@kutalia/whisper-node-addon');
      console.log('[Whisper] Module loaded successfully');
      return true;
    } catch (err) {
      console.log('[Whisper] Module not installed:', (err as Error).message);
      return false;
    }
  } catch (err) {
    console.error('[Whisper] Init failed:', err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// STATUS & MODELS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if whisper is available
 */
export function isWhisperAvailable(): boolean {
  return whisperModule !== null;
}

/**
 * Get whisper status
 */
export async function getWhisperStatus(): Promise<WhisperStatus> {
  const availableModels = await listLocalModels();

  return {
    available: isWhisperAvailable(),
    modelLoaded: currentModel !== null,
    currentModel,
    modelsPath,
    availableModels: availableModels.map(m => m.name),
  };
}

/**
 * List locally downloaded models
 */
export async function listLocalModels(): Promise<WhisperModel[]> {
  if (!modelsPath || !fs.existsSync(modelsPath)) {
    return [];
  }

  const files = fs.readdirSync(modelsPath);
  return files
    .filter(f => f.endsWith('.bin'))
    .map(f => {
      const stats = fs.statSync(path.join(modelsPath, f));
      return {
        name: f,
        size: formatBytes(stats.size),
        path: path.join(modelsPath, f),
      };
    });
}

/**
 * List available models for download
 */
export function listAvailableModels(): Array<{ name: string; size: string; downloaded: boolean }> {
  const localModels = fs.existsSync(modelsPath)
    ? fs.readdirSync(modelsPath).filter(f => f.endsWith('.bin'))
    : [];

  return Object.entries(MODEL_URLS).map(([name, info]) => ({
    name,
    size: info.size,
    downloaded: localModels.includes(name),
  }));
}

// ═══════════════════════════════════════════════════════════════════
// MODEL DOWNLOAD
// ═══════════════════════════════════════════════════════════════════

/**
 * Download a model from Hugging Face
 */
export async function downloadModel(
  modelName: string,
  onProgress?: (progress: { percent: number; downloaded: number; total: number }) => void
): Promise<boolean> {
  const modelInfo = MODEL_URLS[modelName];
  if (!modelInfo) {
    console.error('[Whisper] Unknown model:', modelName);
    return false;
  }

  const destPath = path.join(modelsPath, modelName);

  // Skip if already downloaded
  if (fs.existsSync(destPath)) {
    console.log('[Whisper] Model already exists:', modelName);
    return true;
  }

  console.log('[Whisper] Downloading model:', modelName);

  try {
    const response = await fetch(modelInfo.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const chunks: Uint8Array[] = [];
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      downloaded += value.length;

      if (onProgress && contentLength > 0) {
        onProgress({
          percent: Math.round((downloaded / contentLength) * 100),
          downloaded,
          total: contentLength,
        });
      }
    }

    // Combine chunks and write to file
    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(destPath, buffer);

    console.log('[Whisper] Model downloaded:', modelName);
    return true;
  } catch (err) {
    console.error('[Whisper] Download failed:', err);
    // Clean up partial download
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TRANSCRIPTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Transcribe an audio file
 */
export async function transcribeAudio(
  audioPath: string,
  modelName: string = 'ggml-base.en.bin',
  onProgress?: (progress: TranscriptionProgress) => void
): Promise<TranscriptionResult> {
  if (!whisperModule) {
    throw new Error('Whisper module not loaded');
  }

  const modelPath = path.join(modelsPath, modelName);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model not found: ${modelName}. Please download it first.`);
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  onProgress?.({ status: 'loading', progress: 0, message: 'Loading model...' });

  try {
    onProgress?.({ status: 'transcribing', progress: 10, message: 'Transcribing...' });

    const result = await whisperModule.default.transcribe({
      fname_inp: audioPath,
      model: modelPath,
      language: 'en',
      use_gpu: true,
    });

    onProgress?.({ status: 'complete', progress: 100, message: 'Done' });

    // Parse result - format depends on whisper-node-addon output
    if (typeof result === 'string') {
      return { text: result };
    }

    return {
      text: result.text || result.transcription || '',
      segments: result.segments,
      language: result.language,
      duration: result.duration,
    };
  } catch (err) {
    onProgress?.({ status: 'error', progress: 0, message: (err as Error).message });
    throw err;
  }
}

/**
 * Transcribe audio from PCM buffer (for real-time streaming)
 */
export async function transcribePCM(
  pcmData: Float32Array,
  sampleRate: number = 16000,
  modelName: string = 'ggml-base.en.bin'
): Promise<TranscriptionResult> {
  if (!whisperModule) {
    throw new Error('Whisper module not loaded');
  }

  const modelPath = path.join(modelsPath, modelName);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model not found: ${modelName}`);
  }

  try {
    // whisper-node-addon supports PCM32 data directly
    const result = await whisperModule.default.transcribe({
      pcmData,
      sampleRate,
      model: modelPath,
      language: 'en',
      use_gpu: true,
    });

    if (typeof result === 'string') {
      return { text: result };
    }

    return {
      text: result.text || result.transcription || '',
      segments: result.segments,
      language: result.language,
    };
  } catch (err) {
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════
// IPC HANDLERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Register all whisper IPC handlers
 */
export function registerWhisperHandlers(): void {
  // Status
  ipcMain.handle('whisper:status', async () => {
    return getWhisperStatus();
  });

  // List local models
  ipcMain.handle('whisper:models:local', async () => {
    return listLocalModels();
  });

  // List available models
  ipcMain.handle('whisper:models:available', () => {
    return listAvailableModels();
  });

  // Download model
  ipcMain.handle('whisper:models:download', async (event, modelName: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    try {
      const success = await downloadModel(modelName, (progress) => {
        window?.webContents.send('whisper:download-progress', {
          model: modelName,
          ...progress,
        });
      });
      return { success };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Transcribe file
  ipcMain.handle('whisper:transcribe', async (event, audioPath: string, modelName?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    try {
      const result = await transcribeAudio(audioPath, modelName, (progress) => {
        window?.webContents.send('whisper:transcribe-progress', progress);
      });
      return { success: true, result };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Transcribe PCM data (for streaming)
  ipcMain.handle('whisper:transcribe-pcm', async (_event, pcmData: Float32Array, sampleRate: number, modelName?: string) => {
    try {
      const result = await transcribePCM(pcmData, sampleRate, modelName);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  console.log('[Whisper] IPC handlers registered');
}

// ═══════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

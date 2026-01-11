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
      const imported = await import('@kutalia/whisper-node-addon');
      // Handle both default export and module itself
      whisperModule = imported.default || imported;
      console.log('[Whisper] Module loaded successfully');
      console.log('[Whisper] Module has transcribe:', typeof whisperModule.transcribe);
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
  // Auto-initialize if not already done
  if (!whisperModule) {
    console.log('[Whisper] Auto-initializing for transcription...');
    try {
      const imported = await import('@kutalia/whisper-node-addon');
      // Handle both default export and named export
      whisperModule = imported.default || imported;
      console.log('[Whisper] Module loaded successfully via auto-init');
      console.log('[Whisper] Module keys:', Object.keys(whisperModule));
    } catch (err) {
      throw new Error(`Whisper module not available: ${(err as Error).message}`);
    }
  }

  // Ensure modelsPath is set (fallback if initWhisper wasn't called)
  if (!modelsPath) {
    modelsPath = path.join(app.getPath('userData'), 'whisper-models');
    if (!fs.existsSync(modelsPath)) {
      fs.mkdirSync(modelsPath, { recursive: true });
    }
  }

  const modelPath = path.join(modelsPath, modelName);
  console.log(`[Whisper] Looking for model at: ${modelPath}`);
  if (!fs.existsSync(modelPath)) {
    console.log(`[Whisper] Model not found at ${modelPath}`);
    throw new Error(`Model not found: ${modelName}. Please download it first.`);
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  onProgress?.({ status: 'loading', progress: 0, message: 'Loading model...' });

  try {
    onProgress?.({ status: 'transcribing', progress: 10, message: 'Transcribing...' });

    // Handle both whisperModule.transcribe() and whisperModule.default.transcribe()
    const transcribeFn = whisperModule.transcribe || whisperModule.default?.transcribe;
    if (!transcribeFn) {
      console.error('[Whisper] Module structure:', {
        keys: Object.keys(whisperModule),
        hasDefault: !!whisperModule.default,
        defaultKeys: whisperModule.default ? Object.keys(whisperModule.default) : [],
      });
      throw new Error('Whisper transcribe function not found in module');
    }

    const result = await transcribeFn({
      fname_inp: audioPath,
      model: modelPath,
      language: 'en',
      use_gpu: true,
    });

    onProgress?.({ status: 'complete', progress: 100, message: 'Done' });

    // Parse result - format from @kutalia/whisper-node-addon is:
    // { transcription: [["00:00:00.000", "00:00:10.320", " text"], ...] }
    if (typeof result === 'string') {
      return { text: result };
    }

    // Handle the array-of-arrays format
    if (result.transcription && Array.isArray(result.transcription)) {
      const segments: Array<{ start: number; end: number; text: string }> = [];
      const textParts: string[] = [];

      for (const segment of result.transcription) {
        if (Array.isArray(segment) && segment.length >= 3) {
          const [startTime, endTime, text] = segment;
          const startSeconds = parseTimestamp(startTime);
          const endSeconds = parseTimestamp(endTime);

          segments.push({
            start: startSeconds,
            end: endSeconds,
            text: text.trim(),
          });

          textParts.push(text.trim());
        }
      }

      const fullText = textParts.join(' ').trim();
      const duration = segments.length > 0 ? segments[segments.length - 1].end : 0;

      return {
        text: fullText,
        segments,
        language: 'en',
        duration,
      };
    }

    // Fallback for other formats
    return {
      text: result.text || '',
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
 * Parse timestamp string "HH:MM:SS.mmm" to seconds
 */
function parseTimestamp(ts: string): number {
  const parts = ts.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  }
  return 0;
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

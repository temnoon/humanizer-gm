/**
 * Audio Transcription Handler
 *
 * Transcribes audio files using the whisper manager.
 * Supports MP3, WAV, M4A, and other common audio formats.
 */

import * as fs from 'fs';
import type { AudioTranscriptionResult } from '../types';
import {
  isWhisperAvailable,
  transcribeAudio as whisperTranscribe,
  type TranscriptionResult,
} from '../../whisper/whisper-manager';

// Supported audio formats
const SUPPORTED_FORMATS = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm'];

/**
 * Check if audio transcription is available
 */
export function isAudioTranscriptionAvailable(): boolean {
  return isWhisperAvailable();
}

/**
 * Check if a file is a supported audio format
 */
export function isSupportedAudioFormat(filePath: string): boolean {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  return SUPPORTED_FORMATS.includes(ext);
}

/**
 * Transcribe an audio file
 */
export async function transcribeAudio(
  filePath: string,
  options?: {
    model?: string;
    language?: string;
  }
): Promise<AudioTranscriptionResult> {
  // Verify file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  // Check format
  if (!isSupportedAudioFormat(filePath)) {
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    throw new Error(
      `Unsupported audio format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(', ')}`
    );
  }

  // Check if whisper is available
  if (!isWhisperAvailable()) {
    throw new Error(
      'Whisper not available. Install @kutalia/whisper-node-addon and download a model.'
    );
  }

  // Use the model from options or default
  const modelName = options?.model || 'ggml-base.en.bin';

  // Transcribe using whisper manager
  const result: TranscriptionResult = await whisperTranscribe(filePath, modelName);

  return {
    text: result.text,
    segments: result.segments,
    language: result.language || options?.language || 'en',
    duration: result.duration,
    model: modelName,
  };
}

/**
 * Type declarations for @kutalia/whisper-node-addon
 *
 * This is an optional dependency - the app will work without it,
 * but speech-to-text features won't be available.
 */

declare module '@kutalia/whisper-node-addon' {
  interface TranscribeOptions {
    /** Path to audio file (WAV format) */
    fname_inp: string;
    /** Path to GGML model file */
    model: string;
    /** Language code (e.g., 'en', 'auto') */
    language?: string;
    /** Use GPU acceleration if available */
    use_gpu?: boolean;
    /** PCM audio data for streaming transcription */
    pcmData?: Float32Array;
    /** Sample rate for PCM data */
    sampleRate?: number;
  }

  interface TranscribeResult {
    text?: string;
    transcription?: string;
    segments?: Array<{
      start: number;
      end: number;
      text: string;
    }>;
    language?: string;
    duration?: number;
  }

  interface WhisperModule {
    transcribe(options: TranscribeOptions): Promise<TranscribeResult | string>;
  }

  const whisper: { default: WhisperModule };
  export default whisper;
}

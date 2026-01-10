/**
 * Test script for whisper transcription
 *
 * Usage: npx ts-node scripts/test-whisper.ts <video_path>
 */

import path from 'path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';

const MODELS_PATH = '/Users/tem/Library/Application Support/Humanizer/whisper-models';
const MODEL_NAME = 'ggml-tiny.en.bin';
const ARCHIVE_ROOT = '/Users/tem/openai-export-parser/output_v13_final';

// Test video
const TEST_VIDEO = process.argv[2] || '/Users/tem/humanizer_root/archives/facebook/facebook-temnoon-2025-11-18-5XY1dvj4/your_facebook_activity/messages/e2ee_cutover/hilaryoak_10208079054071275/videos/2133736783394753.mp4';

async function convertToWav(inputPath: string): Promise<string> {
  const ffmpegPath = require('ffmpeg-static');
  const outputPath = path.join(ARCHIVE_ROOT, '.audio-cache', `test_${Date.now()}.wav`);

  // Ensure cache dir exists
  const cacheDir = path.dirname(outputPath);
  if (!existsSync(cacheDir)) {
    const fs = require('fs');
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    console.log('Converting to WAV...');
    console.log('  Input:', inputPath);
    console.log('  Output:', outputPath);

    const proc = spawn(ffmpegPath, [
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '-y',
      outputPath,
    ]);

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && existsSync(outputPath)) {
        console.log('✅ Conversion successful');
        resolve(outputPath);
      } else {
        console.error('❌ Conversion failed:', stderr.slice(-500));
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

async function transcribe(wavPath: string): Promise<string> {
  const modelPath = path.join(MODELS_PATH, MODEL_NAME);

  if (!existsSync(modelPath)) {
    throw new Error(`Model not found: ${modelPath}`);
  }

  console.log('Loading whisper module...');
  const whisper = await import('@kutalia/whisper-node-addon');

  console.log('Transcribing...');
  console.log('  Model:', MODEL_NAME);
  console.log('  Audio:', wavPath);

  const result = await whisper.default.transcribe({
    fname_inp: wavPath,
    model: modelPath,
    language: 'en',
    use_gpu: true,
  }) as any;

  console.log('Raw result type:', typeof result);
  console.log('Raw result:', JSON.stringify(result).slice(0, 500));

  if (typeof result === 'string') {
    return result;
  }

  // Handle array result
  if (Array.isArray(result)) {
    return result.flat().join(' ');
  }

  // Handle object result
  if (result.transcription) {
    if (Array.isArray(result.transcription)) {
      return result.transcription.flat().join(' ');
    }
    return result.transcription;
  }

  return result.text || '';
}

async function main() {
  console.log('=== Whisper Transcription Test ===\n');

  // Check if test video exists
  if (!existsSync(TEST_VIDEO)) {
    console.error('❌ Video not found:', TEST_VIDEO);
    process.exit(1);
  }

  console.log('Video:', TEST_VIDEO);
  console.log('');

  try {
    // Convert to WAV
    const wavPath = await convertToWav(TEST_VIDEO);

    // Transcribe
    const transcript = await transcribe(wavPath);

    console.log('\n=== TRANSCRIPT ===\n');
    console.log(transcript);
    console.log('\n==================\n');

    // Cleanup
    const fs = require('fs');
    fs.unlinkSync(wavPath);
    console.log('✅ Test complete');
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

main();

/**
 * Test Vision Providers
 *
 * Run with: npx tsx electron/vision/test-providers.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  VisionProviderFactory,
  OllamaVisionProvider,
  getVisionProfile,
  filterVisionOutput,
} from './index';

// Test image path
const TEST_IMAGE = '/Users/tem/humanizer_root/narrative-studio/data/marginalia-book/images/dalle_2024-01-23_Vintage_C.png';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Vision Provider Test Suite');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check test image exists
  if (!fs.existsSync(TEST_IMAGE)) {
    console.error('❌ Test image not found:', TEST_IMAGE);
    process.exit(1);
  }

  const imageStats = fs.statSync(TEST_IMAGE);
  console.log(`📷 Test image: ${path.basename(TEST_IMAGE)}`);
  console.log(`   Size: ${(imageStats.size / 1024).toFixed(1)} KB\n`);

  // Test 1: Check Ollama availability
  console.log('─── Test 1: Ollama Provider Availability ───\n');

  const ollamaProvider = new OllamaVisionProvider({
    type: 'ollama',
    endpoint: 'http://localhost:11434',
    model: 'qwen3-vl:8b',
  });

  const ollamaAvailable = await ollamaProvider.isAvailable();
  console.log(`Ollama available: ${ollamaAvailable ? '✅ Yes' : '❌ No'}`);

  if (ollamaAvailable) {
    const models = await ollamaProvider.listModels();
    console.log(`Vision models: ${models.length > 0 ? models.join(', ') : 'none found'}\n`);
  }

  // Test 2: Model vetting profiles
  console.log('─── Test 2: Model Vetting Profiles ───\n');

  const testModels = ['qwen3-vl:8b', 'llava:13b', 'gpt-4o', 'claude-3.5-sonnet', 'unknown-model'];
  for (const model of testModels) {
    const profile = getVisionProfile(model);
    if (profile) {
      console.log(`${model}: ✅ Vetted (${profile.outputStrategy})`);
    } else {
      console.log(`${model}: ⚠️  Not vetted`);
    }
  }
  console.log();

  // Test 3: Output filtering
  console.log('─── Test 3: Output Filtering ───\n');

  const testOutputs = [
    {
      name: 'Clean JSON',
      model: 'gpt-4o',
      output: '{"description": "A vintage camera", "categories": ["photography", "retro"], "objects": ["camera"], "scene": "studio", "mood": "nostalgic"}',
    },
    {
      name: 'JSON in code block',
      model: 'llava:13b',
      output: 'Here is my analysis:\n\n```json\n{"description": "An old camera", "categories": ["vintage"], "objects": ["camera", "lens"], "scene": "indoor", "mood": "artistic"}\n```\n\nLet me know if you need more details.',
    },
    {
      name: 'With thinking tags',
      model: 'qwen3-vl:8b',
      output: '<think>The user wants me to analyze this image. I can see a camera...</think>\n{"description": "A classic camera", "categories": ["retro"], "objects": ["camera"], "scene": "studio"}',
    },
  ];

  for (const test of testOutputs) {
    const result = filterVisionOutput(test.output, test.model);
    console.log(`${test.name} (${test.model}):`);
    console.log(`  Strategy: ${result.strategy}`);
    console.log(`  Success: ${result.success ? '✅' : '❌'}`);
    if (result.json) {
      console.log(`  Description: "${(result.json as any).description}"`);
    }
    if (result.hadThinkingTags) console.log('  Stripped: thinking tags');
    if (result.hadPreamble) console.log('  Stripped: preamble');
    if (result.hadCodeBlock) console.log('  Stripped: code block');
    console.log();
  }

  // Test 4: Full analysis (only if Ollama available)
  if (ollamaAvailable) {
    console.log('─── Test 4: Full Image Analysis ───\n');

    const models = await ollamaProvider.listModels();
    const testModel = models[0] || 'qwen3-vl:8b';

    console.log(`Using model: ${testModel}`);
    console.log('Analyzing image... (this may take 30-60 seconds)\n');

    const startTime = Date.now();

    try {
      const imageBuffer = fs.readFileSync(TEST_IMAGE);

      const result = await ollamaProvider.analyze({
        imageBuffer,
        temperature: 0.3,
      }, testModel);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log('✅ Analysis complete!\n');
      console.log(`Description: ${result.description}`);
      console.log(`Categories: ${result.categories.join(', ')}`);
      console.log(`Objects: ${result.objects.join(', ')}`);
      console.log(`Scene: ${result.scene}`);
      console.log(`Mood: ${result.mood || 'N/A'}`);
      console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      console.log(`Time: ${elapsed}s`);
      console.log(`Filtered: ${result.filtered ? 'Yes' : 'No'}`);

      if (result.rawOutput) {
        console.log(`\n─── Raw Output (first 500 chars) ───\n`);
        console.log(result.rawOutput.slice(0, 500));
      }
    } catch (error) {
      console.error('❌ Analysis failed:', error instanceof Error ? error.message : error);
    }
  } else {
    console.log('─── Test 4: Skipped (Ollama not available) ───\n');
    console.log('To run the full analysis test:');
    console.log('1. Start Ollama: ollama serve');
    console.log('2. Pull a vision model: ollama pull qwen3-vl:8b');
    console.log('3. Re-run this test\n');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Test Complete');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);

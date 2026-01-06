/**
 * ContentChunker Tests
 *
 * Run with: npx ts-node electron/archive-server/services/embeddings/ContentChunker.test.ts
 */

import { ContentAnalyzer } from './ContentAnalyzer';
import { ContentChunker } from './ContentChunker';

// Test content with mixed types
const MIXED_CONTENT = `
# Introduction

This is a paragraph of prose text. It contains multiple sentences.
Here's another sentence that continues the thought.

## Code Example

Here's some Python code:

\`\`\`python
def hello_world():
    print("Hello, World!")
    return True
\`\`\`

## Math Section

The quadratic formula is:

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

And inline math like $E = mc^2$ is also detected.

## Data Table

| Name | Value |
|------|-------|
| Alpha | 1.0 |
| Beta | 2.0 |
| Gamma | 3.0 |

## Conclusion

This demonstrates content-type aware chunking.
`;

function runTests() {
  console.log('=== ContentAnalyzer Tests ===\n');

  const analyzer = new ContentAnalyzer();
  const segments = analyzer.analyze(MIXED_CONTENT);

  console.log(`Found ${segments.length} segments:\n`);

  for (const segment of segments) {
    const preview = segment.content.slice(0, 60).replace(/\n/g, '\\n');
    console.log(`  [${segment.type}] offset ${segment.startOffset}-${segment.endOffset}`);
    console.log(`    "${preview}${segment.content.length > 60 ? '...' : ''}"`);
    if (segment.language) {
      console.log(`    language: ${segment.language}`);
    }
    console.log();
  }

  console.log('\n=== ContentChunker Tests ===\n');

  const chunker = new ContentChunker({ targetProseWords: 50 });
  const chunks = chunker.chunk(MIXED_CONTENT);

  console.log(`Generated ${chunks.length} chunks:\n`);

  for (const chunk of chunks) {
    const preview = chunk.content.slice(0, 50).replace(/\n/g, '\\n');
    console.log(`  ${chunk.id} [${chunk.contentType}]`);
    console.log(`    words: ${chunk.wordCount}, tokens: ~${chunk.tokenCount}`);
    console.log(`    "${preview}${chunk.content.length > 50 ? '...' : ''}"`);
    if (chunk.contextBefore) {
      console.log(`    context before: "${chunk.contextBefore.slice(-30)}"`);
    }
    console.log();
  }

  // Verify content types detected
  const types = new Set(chunks.map(c => c.contentType));
  console.log('\n=== Content Types Found ===');
  console.log(`  ${Array.from(types).join(', ')}`);

  // Verify code block stays whole
  const codeChunks = chunks.filter(c => c.contentType === 'code');
  console.log(`\n=== Code Blocks: ${codeChunks.length} ===`);
  for (const code of codeChunks) {
    console.log(`  language: ${code.language || 'unknown'}`);
    console.log(`  content:\n${code.content}`);
  }

  // Verify math stays atomic
  const mathChunks = chunks.filter(c => c.contentType === 'math');
  console.log(`\n=== Math Blocks: ${mathChunks.length} ===`);
  for (const math of mathChunks) {
    console.log(`  "${math.content}"`);
  }

  // Verify table stays whole
  const tableChunks = chunks.filter(c => c.contentType === 'table');
  console.log(`\n=== Tables: ${tableChunks.length} ===`);
  for (const table of tableChunks) {
    console.log(`  rows: ${table.content.split('\n').length}`);
  }

  console.log('\n=== Tests Complete ===');

  // Summary
  console.log('\nSummary:');
  console.log(`  - Total segments: ${segments.length}`);
  console.log(`  - Total chunks: ${chunks.length}`);
  console.log(`  - Content types: ${Array.from(types).join(', ')}`);
  console.log(`  - Code blocks preserved: ${codeChunks.length > 0 ? 'YES' : 'NO'}`);
  console.log(`  - Math blocks preserved: ${mathChunks.length > 0 ? 'YES' : 'NO'}`);
  console.log(`  - Tables preserved: ${tableChunks.length > 0 ? 'YES' : 'NO'}`);
}

runTests();

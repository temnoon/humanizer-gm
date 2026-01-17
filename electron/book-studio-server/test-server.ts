/**
 * Test script to run the Book Studio server standalone
 * Usage: npx tsx electron/book-studio-server/test-server.ts
 */

import { startBookStudioServer, stopBookStudioServer } from './index';

async function main() {
  console.log('Starting Book Studio server for testing...');

  try {
    const url = await startBookStudioServer(3004);
    console.log(`Server running at ${url}`);
    console.log('Press Ctrl+C to stop');

    // Keep running
    process.on('SIGINT', async () => {
      console.log('\nStopping server...');
      await stopBookStudioServer();
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();

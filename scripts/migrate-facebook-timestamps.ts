/**
 * One-time migration script to fix Facebook media timestamps
 *
 * Reads message_*.json files to extract creation_timestamp for photos/videos
 * and updates the facebook_media table
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = '/Users/tem/openai-export-parser/output_v13_final/.embeddings.db';
const FACEBOOK_EXPORT = '/Users/tem/humanizer_root/archives/facebook/facebook-temnoon-2025-11-18-5XY1dvj4';

interface MediaTimestamp {
  uri: string;
  creation_timestamp: number;
}

async function extractTimestampsFromThread(threadDir: string): Promise<Map<string, number>> {
  const timestampMap = new Map<string, number>();

  try {
    const files = fs.readdirSync(threadDir);
    const messageFiles = files.filter(f => f.startsWith('message_') && f.endsWith('.json'));

    for (const messageFile of messageFiles) {
      try {
        const content = fs.readFileSync(path.join(threadDir, messageFile), 'utf-8');
        const data = JSON.parse(content);

        for (const msg of data.messages || []) {
          // Extract photo timestamps
          for (const photo of msg.photos || []) {
            if (photo.uri && photo.creation_timestamp) {
              timestampMap.set(photo.uri, photo.creation_timestamp);
            }
          }

          // Extract video timestamps
          for (const video of msg.videos || []) {
            if (video.uri && video.creation_timestamp) {
              timestampMap.set(video.uri, video.creation_timestamp);
            }
          }
        }
      } catch {
        // Error reading/parsing message file
      }
    }
  } catch {
    // Error reading thread directory
  }

  return timestampMap;
}

async function buildTimestampMap(): Promise<Map<string, number>> {
  const allTimestamps = new Map<string, number>();
  const messagesDir = path.join(FACEBOOK_EXPORT, 'your_facebook_activity/messages');
  const threadDirs = ['inbox', 'archived_threads', 'filtered_threads', 'e2ee_cutover'];

  for (const threadType of threadDirs) {
    const threadPath = path.join(messagesDir, threadType);
    try {
      const threads = fs.readdirSync(threadPath);
      for (const thread of threads) {
        const threadDir = path.join(threadPath, thread);
        const stats = fs.statSync(threadDir);
        if (stats.isDirectory()) {
          const timestamps = await extractTimestampsFromThread(threadDir);
          for (const [uri, ts] of timestamps) {
            allTimestamps.set(uri, ts);
          }
        }
      }
    } catch {
      // Thread type doesn't exist
    }
  }

  return allTimestamps;
}

async function main() {
  console.log('Building timestamp map from Facebook JSON files...');
  const timestampMap = await buildTimestampMap();
  console.log(`Found ${timestampMap.size} media timestamps in JSON files`);

  // Connect to database
  const db = new Database(DB_PATH);

  // Get all message/video source media that needs updating
  const media = db.prepare(`
    SELECT id, file_path, source_type, created_at
    FROM facebook_media
    WHERE source_type IN ('message', 'video')
  `).all() as Array<{ id: string; file_path: string; source_type: string; created_at: number }>;

  console.log(`Found ${media.length} media items to check`);

  // Prepare update statement
  const updateStmt = db.prepare(`
    UPDATE facebook_media SET created_at = ?, original_timestamp = ? WHERE id = ?
  `);

  let updated = 0;
  let skipped = 0;

  const updateMany = db.transaction((items: Array<{ id: string; newTimestamp: number }>) => {
    for (const item of items) {
      updateStmt.run(item.newTimestamp, item.newTimestamp, item.id);
      updated++;
    }
  });

  const updates: Array<{ id: string; newTimestamp: number }> = [];

  for (const item of media) {
    // Convert file_path to relative URI format
    const relativeUri = item.file_path.replace(FACEBOOK_EXPORT + '/', '');

    const newTimestamp = timestampMap.get(relativeUri);
    if (newTimestamp && newTimestamp !== item.created_at) {
      updates.push({ id: item.id, newTimestamp });
    } else {
      skipped++;
    }
  }

  if (updates.length > 0) {
    updateMany(updates);
    console.log(`Updated ${updated} media items with correct timestamps`);
  }

  console.log(`Skipped ${skipped} items (no timestamp found or already correct)`);

  db.close();
  console.log('Migration complete!');
}

main().catch(console.error);

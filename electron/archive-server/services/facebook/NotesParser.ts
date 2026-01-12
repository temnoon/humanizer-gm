/**
 * NotesParser - Parse Facebook Notes from export JSON
 *
 * Facebook Notes were long-form blog-style posts that users could write.
 * They contain substantial writing - essays, reflections, philosophical work.
 * This is high-value content for book material.
 *
 * Parses: your_facebook_activity/other_activity/notes.json
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface ParsedNote {
  id: string;
  title: string;
  text: string;
  wordCount: number;
  charCount: number;
  createdTimestamp: number;
  updatedTimestamp: number;
  hasMedia: boolean;
  mediaCount: number;
  mediaPaths: string[];
  tags: string[];  // People tagged in the note
}

export interface NotesParseResult {
  notes: ParsedNote[];
  stats: {
    totalNotes: number;
    uniqueNotes: number;  // After deduplication
    duplicatesRemoved: number;
    totalWordCount: number;
    totalCharCount: number;
    averageWordCount: number;
    longestNote: { title: string; wordCount: number };
    shortestNote: { title: string; wordCount: number };
    withMedia: number;
    dateRange: { earliest: number; latest: number };
    emptyNotes: number;
  };
}

interface RawNote {
  title?: string;
  text?: string;
  media?: Array<{
    uri: string;
    creation_timestamp?: number;
    description?: string;
  }>;
  created_timestamp?: number;
  updated_timestamp?: number;
  tags?: Array<{ name: string }>;
}

export class NotesParser {
  /**
   * Parse notes from the Facebook export
   */
  async parse(exportPath: string): Promise<NotesParseResult> {
    const notesFile = path.join(
      exportPath,
      'your_facebook_activity',
      'other_activity',
      'notes.json'
    );

    console.log(`📝 Parsing notes from: ${notesFile}`);

    const rawData = await fs.readFile(notesFile, 'utf-8');
    const data = JSON.parse(rawData);

    const rawNotes: RawNote[] = data.notes_v2 || [];
    console.log(`   Found ${rawNotes.length} raw note entries`);

    // Parse and deduplicate
    const parsedNotes: ParsedNote[] = [];
    const seenHashes = new Set<string>();
    let duplicatesRemoved = 0;
    let emptyNotes = 0;

    for (const rawNote of rawNotes) {
      const text = this.decodeFacebookUnicode(rawNote.text || '');
      const title = this.decodeFacebookUnicode(rawNote.title || 'Untitled');

      // Skip empty notes
      if (!text.trim()) {
        emptyNotes++;
        continue;
      }

      // Deduplicate based on content hash
      const contentHash = this.generateContentHash(title, text);
      if (seenHashes.has(contentHash)) {
        duplicatesRemoved++;
        continue;
      }
      seenHashes.add(contentHash);

      const parsed = this.parseNote(rawNote, title, text);
      parsedNotes.push(parsed);
    }

    // Sort by creation date (oldest first)
    parsedNotes.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Calculate stats
    const wordCounts = parsedNotes.map(n => n.wordCount);
    const charCounts = parsedNotes.map(n => n.charCount);
    const timestamps = parsedNotes.map(n => n.createdTimestamp).filter(t => t > 1000);

    const longestNote = parsedNotes.reduce(
      (max, n) => (n.wordCount > max.wordCount ? n : max),
      { title: '', wordCount: 0 }
    );
    const shortestNote = parsedNotes
      .filter(n => n.wordCount > 0)
      .reduce(
        (min, n) => (n.wordCount < min.wordCount ? n : min),
        { title: '', wordCount: Infinity }
      );

    const stats = {
      totalNotes: rawNotes.length,
      uniqueNotes: parsedNotes.length,
      duplicatesRemoved,
      totalWordCount: wordCounts.reduce((a, b) => a + b, 0),
      totalCharCount: charCounts.reduce((a, b) => a + b, 0),
      averageWordCount: Math.round(wordCounts.reduce((a, b) => a + b, 0) / parsedNotes.length),
      longestNote: { title: longestNote.title, wordCount: longestNote.wordCount },
      shortestNote: shortestNote.wordCount < Infinity
        ? { title: shortestNote.title, wordCount: shortestNote.wordCount }
        : { title: '', wordCount: 0 },
      withMedia: parsedNotes.filter(n => n.hasMedia).length,
      dateRange: {
        earliest: timestamps.length > 0 ? Math.min(...timestamps) : 0,
        latest: timestamps.length > 0 ? Math.max(...timestamps) : 0,
      },
      emptyNotes,
    };

    console.log(`\n✅ Notes parsing complete:`);
    console.log(`   Total entries: ${stats.totalNotes}`);
    console.log(`   Unique notes: ${stats.uniqueNotes}`);
    console.log(`   Duplicates removed: ${stats.duplicatesRemoved}`);
    console.log(`   Empty notes skipped: ${stats.emptyNotes}`);
    console.log(`   Total word count: ${stats.totalWordCount.toLocaleString()}`);
    console.log(`   Average words per note: ${stats.averageWordCount}`);
    console.log(`   Longest note: "${stats.longestNote.title.substring(0, 40)}..." (${stats.longestNote.wordCount} words)`);
    console.log(`   Notes with media: ${stats.withMedia}`);
    if (stats.dateRange.earliest > 0) {
      console.log(`   Date range: ${new Date(stats.dateRange.earliest * 1000).toISOString().split('T')[0]} to ${new Date(stats.dateRange.latest * 1000).toISOString().split('T')[0]}`);
    }

    return { notes: parsedNotes, stats };
  }

  /**
   * Parse a single note
   */
  private parseNote(rawNote: RawNote, title: string, text: string): ParsedNote {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const mediaPaths = (rawNote.media || []).map(m => m.uri);
    const tags = (rawNote.tags || [])
      .map(t => this.decodeFacebookUnicode(t.name))
      .filter(name => name.length > 0);

    return {
      id: this.generateNoteId(title, rawNote.created_timestamp || 0),
      title,
      text,
      wordCount: words.length,
      charCount: text.length,
      createdTimestamp: rawNote.created_timestamp || 0,
      updatedTimestamp: rawNote.updated_timestamp || rawNote.created_timestamp || 0,
      hasMedia: mediaPaths.length > 0,
      mediaCount: mediaPaths.length,
      mediaPaths,
      tags,
    };
  }

  /**
   * Generate a stable ID for a note
   */
  private generateNoteId(title: string, timestamp: number): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .substring(0, 30);
    return `fb_note_${slug}_${timestamp}`;
  }

  /**
   * Generate a content hash for deduplication
   */
  private generateContentHash(title: string, text: string): string {
    // Use first 1000 chars of text to handle slight variations
    const content = `${title}::${text.substring(0, 1000)}`;
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Decode Facebook's non-standard Unicode encoding
   */
  private decodeFacebookUnicode(text: string): string {
    if (!text) return '';

    // Facebook exports use a weird encoding where UTF-8 bytes are escaped as \u00xx
    try {
      // First try standard JSON unescape
      const parsed = JSON.parse(`"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`);
      // Then fix the mojibake by treating as latin1 and decoding as UTF-8
      const bytes = new Uint8Array([...parsed].map(c => c.charCodeAt(0)));
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      // Fallback: simple replacement of common patterns
      return text
        .replace(/\\u00([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        // Also fix the Â prefix that appears before special chars
        .replace(/Â\u00a0/g, ' ')
        .replace(/Â /g, ' ')
        .replace(/\u00c2\u00a0/g, ' ');
    }
  }

  /**
   * Check if notes file exists
   */
  async exists(exportPath: string): Promise<boolean> {
    const notesFile = path.join(
      exportPath,
      'your_facebook_activity',
      'other_activity',
      'notes.json'
    );

    try {
      await fs.access(notesFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get quick stats without full parsing
   */
  async getQuickStats(exportPath: string): Promise<{
    count: number;
    hasData: boolean;
    fileSizeKb: number;
  }> {
    const notesFile = path.join(
      exportPath,
      'your_facebook_activity',
      'other_activity',
      'notes.json'
    );

    try {
      const stat = await fs.stat(notesFile);
      const rawData = await fs.readFile(notesFile, 'utf-8');
      const data = JSON.parse(rawData);
      const count = (data.notes_v2 || []).length;

      return {
        count,
        hasData: count > 0,
        fileSizeKb: Math.round(stat.size / 1024),
      };
    } catch {
      return { count: 0, hasData: false, fileSizeKb: 0 };
    }
  }
}

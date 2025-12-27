// AlbumMediaLinker - Links Facebook album photos to posts in the database
// Parses album JSON files and matches them to "shared an album" posts by timestamp

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

interface AlbumPhoto {
  uri: string;
  creation_timestamp: number;
  title?: string;
  description?: string;
}

interface Album {
  name: string;
  photos: AlbumPhoto[];
  cover_photo?: AlbumPhoto;
  last_modified_timestamp?: number;
  description?: string;
}

interface LinkResult {
  albumsProcessed: number;
  photosLinked: number;
  postsUpdated: number;
  mediaItemsUpdated: number;
  errors: string[];
  unmatchedAlbums: string[];
}

export class AlbumMediaLinker {
  private db: Database.Database;
  private exportPath: string;

  constructor(archivePath: string, exportPath: string) {
    this.exportPath = exportPath;
    this.db = new Database(path.join(archivePath, '.embeddings.db'));
  }

  /**
   * Main entry point: link all album photos to posts
   */
  async linkAll(options: {
    onProgress?: (current: number, total: number, albumName: string) => void;
    dryRun?: boolean;
  } = {}): Promise<LinkResult> {
    const { onProgress, dryRun = false } = options;

    const result: LinkResult = {
      albumsProcessed: 0,
      photosLinked: 0,
      postsUpdated: 0,
      mediaItemsUpdated: 0,
      errors: [],
      unmatchedAlbums: []
    };

    // Find all album JSON files
    const albumDir = path.join(this.exportPath, 'your_facebook_activity/posts/album');
    if (!fs.existsSync(albumDir)) {
      result.errors.push(`Album directory not found: ${albumDir}`);
      return result;
    }

    const albumFiles = fs.readdirSync(albumDir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(albumDir, f));

    console.log(`📚 Found ${albumFiles.length} album JSON files`);

    // Get all "shared an album" posts for matching
    const albumPosts = this.getAlbumPosts();
    console.log(`📝 Found ${albumPosts.length} album-related posts`);

    // Process each album
    for (let i = 0; i < albumFiles.length; i++) {
      const albumFile = albumFiles[i];

      try {
        const album = JSON.parse(fs.readFileSync(albumFile, 'utf-8')) as Album;

        if (!album.photos || album.photos.length === 0) continue;

        if (onProgress) {
          onProgress(i + 1, albumFiles.length, album.name || 'Unknown');
        }

        result.albumsProcessed++;

        // Find matching post
        const matchedPost = this.findMatchingPost(album, albumPosts);

        if (!matchedPost) {
          result.unmatchedAlbums.push(album.name || 'Unknown');
          continue;
        }

        // Build full file paths for all photos
        const photoPaths = album.photos.map(photo =>
          path.join(this.exportPath, photo.uri)
        );

        if (!dryRun) {
          // Update content_items.media_refs
          const existingRefs = this.getExistingMediaRefs(matchedPost.id);
          const newRefs = [...new Set([...existingRefs, ...photoPaths])];

          this.db.prepare(`
            UPDATE content_items
            SET media_refs = ?, media_count = ?
            WHERE id = ?
          `).run(JSON.stringify(newRefs), newRefs.length, matchedPost.id);

          result.postsUpdated++;

          // Update media_items.related_post_id for each photo
          for (const photoPath of photoPaths) {
            const updated = this.db.prepare(`
              UPDATE media_items
              SET related_post_id = ?,
                  context = ?
              WHERE file_path = ?
            `).run(
              matchedPost.id,
              JSON.stringify({ album: album.name, post_title: matchedPost.title }),
              photoPath
            );

            if (updated.changes > 0) {
              result.mediaItemsUpdated++;
            }
          }
        }

        result.photosLinked += album.photos.length;

      } catch (e) {
        result.errors.push(`Error processing ${albumFile}: ${e}`);
      }
    }

    console.log(`✅ Linked ${result.photosLinked} photos from ${result.albumsProcessed} albums`);
    console.log(`📊 Updated ${result.postsUpdated} posts, ${result.mediaItemsUpdated} media items`);

    if (result.unmatchedAlbums.length > 0) {
      console.log(`⚠️ ${result.unmatchedAlbums.length} albums could not be matched to posts`);
    }

    return result;
  }

  /**
   * Get all posts that mention sharing an album
   */
  private getAlbumPosts(): Array<{ id: string; title: string; created_at: number; text: string }> {
    return this.db.prepare(`
      SELECT id, title, created_at, text
      FROM content_items
      WHERE type = 'post'
        AND (title LIKE '%album%' OR title LIKE '%photos%' OR title LIKE '%Photo%')
      ORDER BY created_at
    `).all() as Array<{ id: string; title: string; created_at: number; text: string }>;
  }

  /**
   * Get existing media_refs for a post
   */
  private getExistingMediaRefs(postId: string): string[] {
    const result = this.db.prepare(`
      SELECT media_refs FROM content_items WHERE id = ?
    `).get(postId) as { media_refs: string } | undefined;

    if (!result || !result.media_refs) return [];

    try {
      const refs = JSON.parse(result.media_refs);
      return Array.isArray(refs) ? refs : [];
    } catch {
      return [];
    }
  }

  /**
   * Find the best matching post for an album
   * Uses timestamp correlation and text matching
   */
  private findMatchingPost(
    album: Album,
    posts: Array<{ id: string; title: string; created_at: number; text: string }>
  ): { id: string; title: string } | null {

    // Get album timestamp (first photo or last_modified)
    const albumTimestamp = album.last_modified_timestamp
      || (album.photos[0]?.creation_timestamp)
      || 0;

    if (albumTimestamp === 0) return null;

    // Extract album ID from first photo URI (e.g., "BurningManMyJourney_1597174046398")
    const firstPhotoUri = album.photos[0]?.uri || '';
    const folderMatch = firstPhotoUri.match(/\/([^/]+_(\d+))\//);
    const albumFolderId = folderMatch ? folderMatch[2] : null;

    // Strategy 1: Match by album folder ID if it looks like a timestamp
    if (albumFolderId && albumFolderId.length >= 10) {
      const folderTimestamp = parseInt(albumFolderId, 10);
      // Check if this could be a Unix timestamp (roughly 2008-2025)
      if (folderTimestamp > 1200000000 && folderTimestamp < 2000000000) {
        // Look for posts close to this timestamp (within 1 day)
        const matching = posts.filter(p =>
          Math.abs(p.created_at - folderTimestamp) < 86400
        );
        if (matching.length > 0) {
          // Prefer posts that mention albums
          const albumPost = matching.find(p =>
            p.title?.toLowerCase().includes('album')
          );
          if (albumPost) return { id: albumPost.id, title: albumPost.title };
          return { id: matching[0].id, title: matching[0].title };
        }
      }
    }

    // Strategy 2: Match by album name in post text
    const albumNameLower = (album.name || '').toLowerCase();
    if (albumNameLower) {
      const nameMatch = posts.find(p =>
        (p.text || '').toLowerCase().includes(albumNameLower) ||
        (p.title || '').toLowerCase().includes(albumNameLower)
      );
      if (nameMatch) return { id: nameMatch.id, title: nameMatch.title };
    }

    // Strategy 3: Match by first photo timestamp (within 2 days of post)
    const firstPhotoTime = album.photos[0]?.creation_timestamp || 0;
    if (firstPhotoTime > 0) {
      // Find the closest post after the first photo was created
      const candidates = posts.filter(p =>
        p.created_at >= firstPhotoTime - 3600 && // 1 hour before
        p.created_at <= firstPhotoTime + 172800   // 2 days after
      );

      // Prefer posts that explicitly mention albums
      const albumPosts = candidates.filter(p =>
        p.title?.toLowerCase().includes('album')
      );

      if (albumPosts.length > 0) {
        // Return the closest one
        albumPosts.sort((a, b) =>
          Math.abs(a.created_at - firstPhotoTime) - Math.abs(b.created_at - firstPhotoTime)
        );
        return { id: albumPosts[0].id, title: albumPosts[0].title };
      }

      // Otherwise return closest candidate
      if (candidates.length > 0) {
        candidates.sort((a, b) =>
          Math.abs(a.created_at - firstPhotoTime) - Math.abs(b.created_at - firstPhotoTime)
        );
        return { id: candidates[0].id, title: candidates[0].title };
      }
    }

    return null;
  }

  /**
   * Link uncategorized photos (photos not in albums)
   */
  async linkUncategorizedPhotos(): Promise<{ linked: number; errors: string[] }> {
    const result = { linked: 0, errors: [] as string[] };

    const uncatPath = path.join(
      this.exportPath,
      'your_facebook_activity/posts/your_uncategorized_photos.json'
    );

    if (!fs.existsSync(uncatPath)) {
      return result;
    }

    try {
      const data = JSON.parse(fs.readFileSync(uncatPath, 'utf-8')) as {
        other_photos_v2: Array<{
          uri: string;
          creation_timestamp: number;
          description?: string;
        }>;
      };

      if (!data.other_photos_v2) return result;

      console.log(`📷 Processing ${data.other_photos_v2.length} uncategorized photos`);

      // Get all posts to match against
      const posts = this.db.prepare(`
        SELECT id, title, created_at, text
        FROM content_items
        WHERE type = 'post'
        ORDER BY created_at
      `).all() as Array<{ id: string; title: string; created_at: number; text: string }>;

      for (const photo of data.other_photos_v2) {
        const fullPath = path.join(this.exportPath, photo.uri);
        const photoTime = photo.creation_timestamp;

        // Find closest post within 1 hour
        const matchedPost = posts.find(p =>
          Math.abs(p.created_at - photoTime) < 3600
        );

        if (matchedPost) {
          // Update media_items
          const updated = this.db.prepare(`
            UPDATE media_items
            SET related_post_id = ?,
                context = ?,
                description = COALESCE(description, ?)
            WHERE file_path = ?
          `).run(
            matchedPost.id,
            JSON.stringify({ source: 'uncategorized', post_title: matchedPost.title }),
            photo.description || null,
            fullPath
          );

          if (updated.changes > 0) {
            result.linked++;
          }

          // Update post's media_refs
          const existing = this.getExistingMediaRefs(matchedPost.id);
          if (!existing.includes(fullPath)) {
            const newRefs = [...existing, fullPath];
            this.db.prepare(`
              UPDATE content_items
              SET media_refs = ?, media_count = ?
              WHERE id = ?
            `).run(JSON.stringify(newRefs), newRefs.length, matchedPost.id);
          }
        }
      }

    } catch (e) {
      result.errors.push(`Error processing uncategorized photos: ${e}`);
    }

    console.log(`✅ Linked ${result.linked} uncategorized photos`);
    return result;
  }

  /**
   * Get linking statistics
   */
  getStats(): {
    totalMedia: number;
    linkedMedia: number;
    unlinkedMedia: number;
    postsWithMedia: number;
  } {
    const totalMedia = (this.db.prepare(
      'SELECT COUNT(*) as count FROM media_items'
    ).get() as { count: number }).count;

    const linkedMedia = (this.db.prepare(
      'SELECT COUNT(*) as count FROM media_items WHERE related_post_id IS NOT NULL'
    ).get() as { count: number }).count;

    const postsWithMedia = (this.db.prepare(
      "SELECT COUNT(*) as count FROM content_items WHERE media_count > 0"
    ).get() as { count: number }).count;

    return {
      totalMedia,
      linkedMedia,
      unlinkedMedia: totalMedia - linkedMedia,
      postsWithMedia
    };
  }

  /**
   * Link Messenger photos to their messages
   * Messenger photos are in inbox/{thread}/photos/ folders
   */
  async linkMessengerPhotos(): Promise<{ linked: number; errors: string[] }> {
    const result = { linked: 0, errors: [] as string[] };

    const messagesDir = path.join(
      this.exportPath,
      'your_facebook_activity/messages/inbox'
    );

    if (!fs.existsSync(messagesDir)) {
      return result;
    }

    console.log('📱 Linking Messenger photos to messages...');

    // Get all unlinked Messenger media
    const unlinkedMessengerMedia = this.db.prepare(`
      SELECT id, file_path, created_at
      FROM media_items
      WHERE related_post_id IS NULL
        AND file_path LIKE '%/messages/inbox/%'
    `).all() as Array<{ id: string; file_path: string; created_at: number }>;

    console.log(`   Found ${unlinkedMessengerMedia.length} unlinked Messenger photos`);

    // For each unlinked photo, try to find a matching message
    for (const media of unlinkedMessengerMedia) {
      // Extract thread name from path: .../inbox/ThreadName_123/photos/...
      const threadMatch = media.file_path.match(/inbox\/([^/]+)\//);
      if (!threadMatch) continue;

      const threadFolder = threadMatch[1];
      // Thread name is everything before the last underscore+ID
      const threadName = threadFolder.replace(/_\d+$/, '').replace(/_/g, ' ');

      // Find messages from this thread that are close in time to the photo
      const messages = this.db.prepare(`
        SELECT id, thread_id, created_at, author_name
        FROM content_items
        WHERE type = 'message'
          AND (thread_id LIKE ? OR context LIKE ?)
          AND ABS(created_at - ?) < 60
        LIMIT 1
      `).all(`%${threadName}%`, `%${threadFolder}%`, media.created_at) as Array<{
        id: string;
        thread_id: string;
        created_at: number;
        author_name: string;
      }>;

      if (messages.length > 0) {
        const msg = messages[0];
        this.db.prepare(`
          UPDATE media_items
          SET related_post_id = ?,
              context = ?
          WHERE id = ?
        `).run(
          msg.id,
          JSON.stringify({ thread: threadName, author: msg.author_name }),
          media.id
        );
        result.linked++;
      } else {
        // Try broader match: any message from the same thread
        const anyMessage = this.db.prepare(`
          SELECT id, thread_id, author_name
          FROM content_items
          WHERE type = 'message'
            AND (thread_id LIKE ? OR context LIKE ?)
          ORDER BY created_at DESC
          LIMIT 1
        `).get(`%${threadName}%`, `%${threadFolder}%`) as {
          id: string;
          thread_id: string;
          author_name: string;
        } | undefined;

        if (anyMessage) {
          // Link to thread's first message as a fallback
          this.db.prepare(`
            UPDATE media_items
            SET related_post_id = ?,
                context = ?
            WHERE id = ?
          `).run(
            anyMessage.id,
            JSON.stringify({ thread: threadName, author: anyMessage.author_name, match: 'thread' }),
            media.id
          );
          result.linked++;
        }
      }
    }

    console.log(`   ✅ Linked ${result.linked} Messenger photos`);
    return result;
  }

  /**
   * Try to link remaining albums by searching for album name in posts
   * Folder names like "AftertheDogs_123" -> search for "After the Dogs" in post text/title
   */
  async linkByAlbumName(): Promise<{ linked: number; errors: string[] }> {
    const result = { linked: 0, errors: [] as string[] };

    // Get unlinked media with album folder pattern
    const unlinked = this.db.prepare(`
      SELECT DISTINCT
        SUBSTR(file_path, INSTR(file_path, '/media/') + 7) as relative_path,
        file_path
      FROM media_items
      WHERE related_post_id IS NULL
        AND file_path LIKE '%/posts/media/%'
        AND file_path NOT LIKE '%stickers_used%'
    `).all() as Array<{ relative_path: string; file_path: string }>;

    // Group by album folder
    const albumFolders = new Map<string, string[]>();
    for (const item of unlinked) {
      const folderMatch = item.relative_path.match(/^([^/]+)\//);
      if (folderMatch) {
        const folder = folderMatch[1];
        if (!albumFolders.has(folder)) {
          albumFolders.set(folder, []);
        }
        albumFolders.get(folder)!.push(item.file_path);
      }
    }

    console.log(`🔍 Found ${albumFolders.size} unlinked album folders`);

    // Get all posts for searching
    const allPosts = this.db.prepare(`
      SELECT id, title, text, created_at
      FROM content_items
      WHERE type = 'post'
    `).all() as Array<{ id: string; title: string; text: string; created_at: number }>;

    // For each album folder, try to find matching posts by name
    for (const [folder, filePaths] of albumFolders) {
      // Extract album name from folder (everything before _ID)
      const nameMatch = folder.match(/^(.+?)_\d+$/);
      if (!nameMatch) continue;

      // Convert CamelCase/concatenated to searchable form
      // "AftertheDogs" -> "after the dogs"
      // "BestofMay282011" -> "best of may 28 2011"
      const rawName = nameMatch[1];
      const searchName = rawName
        .replace(/([a-z])([A-Z])/g, '$1 $2')  // CamelCase -> spaces
        .replace(/(\d+)/g, ' $1 ')            // numbers get spaces
        .toLowerCase()
        .trim();

      // Search for posts that mention this album name
      const matchingPosts = allPosts.filter(p => {
        const textLower = (p.text || '').toLowerCase();
        const titleLower = (p.title || '').toLowerCase();
        return textLower.includes(searchName) || titleLower.includes(searchName);
      });

      if (matchingPosts.length > 0) {
        // Use the first matching post
        const post = matchingPosts[0];
        for (const filePath of filePaths) {
          this.db.prepare(`
            UPDATE media_items
            SET related_post_id = ?,
                context = ?
            WHERE file_path = ?
          `).run(
            post.id,
            JSON.stringify({ album_folder: folder, matched_by: 'name_search', search_term: searchName }),
            filePath
          );
          result.linked++;
        }
        continue;
      }

      // Try partial name matching (first 2-3 words)
      const words = searchName.split(/\s+/).filter(w => w.length > 2);
      if (words.length >= 2) {
        const partialSearch = words.slice(0, 3).join(' ');
        const partialMatches = allPosts.filter(p => {
          const textLower = (p.text || '').toLowerCase();
          const titleLower = (p.title || '').toLowerCase();
          return textLower.includes(partialSearch) || titleLower.includes(partialSearch);
        });

        if (partialMatches.length > 0) {
          const post = partialMatches[0];
          for (const filePath of filePaths) {
            this.db.prepare(`
              UPDATE media_items
              SET related_post_id = ?,
                  context = ?
              WHERE file_path = ?
            `).run(
              post.id,
              JSON.stringify({ album_folder: folder, matched_by: 'partial_name', search_term: partialSearch }),
              filePath
            );
            result.linked++;
          }
        }
      }
    }

    console.log(`   ✅ Linked ${result.linked} photos by album name`);
    return result;
  }

  close(): void {
    this.db.close();
  }
}

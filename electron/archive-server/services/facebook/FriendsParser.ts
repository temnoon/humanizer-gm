/**
 * FriendsParser - Parse Facebook friends data from export JSON
 *
 * Parses:
 * - your_friends.json - Current friends with friendship dates
 * - removed_friends.json - Unfriended/removed people
 * - sent_friend_requests.json - Requests you sent
 * - rejected_friend_requests.json - Requests you rejected
 */

import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface ParsedFriend {
  id: string;
  name: string;
  friendshipDate: number;  // Unix timestamp
  status: 'friend' | 'removed' | 'sent_request' | 'rejected_request';
  removedDate?: number;    // For removed friends
}

export interface FriendsParseResult {
  friends: ParsedFriend[];
  removed: ParsedFriend[];
  sentRequests: ParsedFriend[];
  rejectedRequests: ParsedFriend[];
  stats: {
    totalFriends: number;
    totalRemoved: number;
    totalSentRequests: number;
    totalRejectedRequests: number;
    earliestFriendship: number;
    latestFriendship: number;
  };
}

interface RawFriend {
  name: string;
  timestamp: number;
}

export class FriendsParser {
  /**
   * Parse all friends data from the Facebook export
   */
  async parseAll(connectionsDir: string): Promise<FriendsParseResult> {
    console.log(`👥 Parsing friends data from: ${connectionsDir}`);

    const friendsDir = path.join(connectionsDir, 'friends');

    const friends: ParsedFriend[] = [];
    const removed: ParsedFriend[] = [];
    const sentRequests: ParsedFriend[] = [];
    const rejectedRequests: ParsedFriend[] = [];

    // Parse current friends
    const friendsFile = path.join(friendsDir, 'your_friends.json');
    try {
      const friendsData = await this.parseFriendsFile(friendsFile, 'friend');
      friends.push(...friendsData);
      console.log(`   ✓ Parsed ${friendsData.length} current friends`);
    } catch (err) {
      console.log(`   ⚠ Could not parse your_friends.json: ${err}`);
    }

    // Parse removed friends
    const removedFile = path.join(friendsDir, 'removed_friends.json');
    try {
      const removedData = await this.parseRemovedFile(removedFile);
      removed.push(...removedData);
      console.log(`   ✓ Parsed ${removedData.length} removed friends`);
    } catch (err) {
      console.log(`   ⚠ Could not parse removed_friends.json: ${err}`);
    }

    // Parse sent friend requests
    const sentFile = path.join(friendsDir, 'sent_friend_requests.json');
    try {
      const sentData = await this.parseFriendsFile(sentFile, 'sent_request');
      sentRequests.push(...sentData);
      console.log(`   ✓ Parsed ${sentData.length} sent friend requests`);
    } catch (err) {
      console.log(`   ⚠ Could not parse sent_friend_requests.json: ${err}`);
    }

    // Parse rejected friend requests
    const rejectedFile = path.join(friendsDir, 'rejected_friend_requests.json');
    try {
      const rejectedData = await this.parseRejectedFile(rejectedFile);
      rejectedRequests.push(...rejectedData);
      console.log(`   ✓ Parsed ${rejectedData.length} rejected friend requests`);
    } catch (err) {
      console.log(`   ⚠ Could not parse rejected_friend_requests.json: ${err}`);
    }

    // Calculate stats
    const allTimestamps = [
      ...friends.map(f => f.friendshipDate),
      ...removed.map(f => f.friendshipDate),
    ].filter(t => t > 1000); // Filter out invalid timestamps

    const stats = {
      totalFriends: friends.length,
      totalRemoved: removed.length,
      totalSentRequests: sentRequests.length,
      totalRejectedRequests: rejectedRequests.length,
      earliestFriendship: allTimestamps.length > 0 ? Math.min(...allTimestamps) : 0,
      latestFriendship: allTimestamps.length > 0 ? Math.max(...allTimestamps) : 0,
    };

    console.log(`\n✅ Friends parsing complete:`);
    console.log(`   Current friends: ${stats.totalFriends}`);
    console.log(`   Removed friends: ${stats.totalRemoved}`);
    console.log(`   Sent requests: ${stats.totalSentRequests}`);
    console.log(`   Rejected requests: ${stats.totalRejectedRequests}`);
    if (stats.earliestFriendship > 0) {
      console.log(`   Date range: ${new Date(stats.earliestFriendship * 1000).toISOString().split('T')[0]} to ${new Date(stats.latestFriendship * 1000).toISOString().split('T')[0]}`);
    }

    return { friends, removed, sentRequests, rejectedRequests, stats };
  }

  /**
   * Parse a standard friends file (your_friends.json or sent_friend_requests.json)
   */
  private async parseFriendsFile(filePath: string, status: 'friend' | 'sent_request'): Promise<ParsedFriend[]> {
    const rawData = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(rawData);

    // Handle both friends_v2 and sent_requests_v2 formats
    const rawFriends: RawFriend[] = data.friends_v2 || data.sent_requests_v2 || [];

    return rawFriends.map(friend => ({
      id: this.generateFriendId(friend.name),
      name: this.decodeFacebookUnicode(friend.name),
      friendshipDate: friend.timestamp,
      status,
    }));
  }

  /**
   * Parse removed friends file
   */
  private async parseRemovedFile(filePath: string): Promise<ParsedFriend[]> {
    const rawData = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(rawData);

    const rawFriends: RawFriend[] = data.deleted_friends_v2 || [];

    return rawFriends.map(friend => ({
      id: this.generateFriendId(friend.name),
      name: this.decodeFacebookUnicode(friend.name),
      friendshipDate: 0, // We don't know when they became friends
      status: 'removed' as const,
      removedDate: friend.timestamp,
    }));
  }

  /**
   * Parse rejected friend requests file
   */
  private async parseRejectedFile(filePath: string): Promise<ParsedFriend[]> {
    const rawData = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(rawData);

    const rawFriends: RawFriend[] = data.rejected_requests_v2 || [];

    return rawFriends.map(friend => ({
      id: this.generateFriendId(friend.name),
      name: this.decodeFacebookUnicode(friend.name),
      friendshipDate: friend.timestamp, // This is when request was rejected
      status: 'rejected_request' as const,
    }));
  }

  /**
   * Generate a stable ID from a friend's name
   */
  private generateFriendId(name: string): string {
    const normalizedName = this.decodeFacebookUnicode(name).toLowerCase().replace(/\s+/g, '_');
    return `fb_friend_${normalizedName}_${uuidv4().substring(0, 8)}`;
  }

  /**
   * Decode Facebook's non-standard Unicode encoding
   */
  private decodeFacebookUnicode(text: string): string {
    // Facebook exports use a weird encoding where UTF-8 bytes are escaped as \u00xx
    try {
      // First try standard JSON unescape
      const parsed = JSON.parse(`"${text.replace(/"/g, '\\"')}"`);
      // Then fix the mojibake by treating as latin1 and decoding as UTF-8
      const bytes = new Uint8Array([...parsed].map(c => c.charCodeAt(0)));
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      // Fallback: simple replacement of common patterns
      return text
        .replace(/\\u00([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
  }

  /**
   * Get quick stats without full parsing
   */
  async getStats(connectionsDir: string): Promise<{
    friendsCount: number;
    removedCount: number;
    hasData: boolean;
  }> {
    const friendsDir = path.join(connectionsDir, 'friends');
    let friendsCount = 0;
    let removedCount = 0;

    try {
      const friendsFile = path.join(friendsDir, 'your_friends.json');
      const friendsData = await fs.readFile(friendsFile, 'utf-8');
      const friends = JSON.parse(friendsData);
      friendsCount = (friends.friends_v2 || []).length;
    } catch { /* ignore */ }

    try {
      const removedFile = path.join(friendsDir, 'removed_friends.json');
      const removedData = await fs.readFile(removedFile, 'utf-8');
      const removed = JSON.parse(removedData);
      removedCount = (removed.deleted_friends_v2 || []).length;
    } catch { /* ignore */ }

    return {
      friendsCount,
      removedCount,
      hasData: friendsCount > 0 || removedCount > 0,
    };
  }
}

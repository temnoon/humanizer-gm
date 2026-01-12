/**
 * AdvertisersAndPagesParser - Parse Facebook advertisers and pages data
 *
 * Parses:
 * - ads_information/advertisers_using_your_activity_or_information.json
 * - ads_information/advertisers_you've_interacted_with.json
 * - ads_information/ad_preferences.json
 * - your_facebook_activity/pages/pages_you've_liked.json
 * - your_facebook_activity/pages/pages_and_profiles_you_follow.json
 * - your_facebook_activity/pages/pages_and_profiles_you've_unfollowed.json
 */

import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';

// Known data brokers (companies that aggregate and sell personal data)
const DATA_BROKERS = new Set([
  'LiveRamp',
  'Oracle Data Cloud',
  'Experian Marketing Services',
  'Experian Marketing Services - Audiences',
  'Nielsen Marketing Cloud',
  'Acxiom',
  'Epsilon',
  'TransUnion',
  'Equifax',
  'Neustar',
  'Foursquare',
  'Foursquare City Guide',
  'Samba TV',
  'Cross Screen Media',
  'Lotame',
  'Eyeota',
  'ShareThis',
  'Tapad',
  'Drawbridge',
]);

export interface ParsedAdvertiser {
  id: string;
  name: string;
  targetingType: string;
  interactionCount: number;
  firstSeen?: number;
  lastSeen?: number;
  isDataBroker: boolean;
}

export interface ParsedPage {
  id: string;
  name: string;
  facebookId?: string;
  url?: string;
  isLiked: boolean;
  likedAt?: number;
  isFollowing: boolean;
  followedAt?: number;
  unfollowedAt?: number;
}

export interface AdvertisersParseResult {
  advertisers: ParsedAdvertiser[];
  stats: {
    total: number;
    dataBrokers: number;
    byTargetingType: Record<string, number>;
  };
}

export interface PagesParseResult {
  pages: ParsedPage[];
  stats: {
    totalLiked: number;
    totalFollowed: number;
    totalUnfollowed: number;
    earliestLike?: number;
    latestLike?: number;
  };
}

export class AdvertisersAndPagesParser {
  /**
   * Parse all advertisers data from the Facebook export
   */
  async parseAdvertisers(exportPath: string): Promise<AdvertisersParseResult> {
    console.log(`📊 Parsing advertisers data from: ${exportPath}`);

    const advertisers = new Map<string, ParsedAdvertiser>();
    const byTargetingType: Record<string, number> = {};

    // Parse advertisers using your activity
    const adsPath = path.join(exportPath, 'ads_information/advertisers_using_your_activity_or_information.json');
    try {
      const rawData = await fs.readFile(adsPath, 'utf-8');
      const data = JSON.parse(rawData);
      const labelValues = data.label_values || [];

      for (const category of labelValues) {
        const targetingType = this.categorizeTargetingType(category.label);
        const names = category.vec || [];

        for (const item of names) {
          const name = item.value;
          if (!name) continue;

          const id = this.generateId('advertiser', name);
          const existing = advertisers.get(id);

          if (existing) {
            existing.interactionCount++;
          } else {
            advertisers.set(id, {
              id,
              name: this.decodeFacebookUnicode(name),
              targetingType,
              interactionCount: 1,
              isDataBroker: DATA_BROKERS.has(name),
            });
          }

          byTargetingType[targetingType] = (byTargetingType[targetingType] || 0) + 1;
        }
      }
      console.log(`   ✓ Parsed ${advertisers.size} advertisers from activity data`);
    } catch (err) {
      console.log(`   ⚠ Could not parse advertisers_using_your_activity: ${err}`);
    }

    // Parse advertisers you've interacted with
    const interactedPath = path.join(exportPath, "ads_information/advertisers_you've_interacted_with.json");
    try {
      const rawData = await fs.readFile(interactedPath, 'utf-8');
      const data = JSON.parse(rawData);
      // This file is an array, not an object with history_v2
      const interactions = Array.isArray(data) ? data : (data.history_v2 || []);

      let interactedCount = 0;
      for (const interaction of interactions) {
        // Extract title from label_values
        let name: string | undefined;
        let timestamp: number | undefined = interaction.timestamp;

        for (const lv of interaction.label_values || []) {
          if (lv.label === 'Title' && lv.value) {
            name = lv.value;
          }
        }

        if (!name) continue;

        const id = this.generateId('advertiser', name);
        const existing = advertisers.get(id);

        if (existing) {
          existing.interactionCount++;
          if (timestamp) {
            if (!existing.firstSeen || timestamp < existing.firstSeen) {
              existing.firstSeen = timestamp;
            }
            if (!existing.lastSeen || timestamp > existing.lastSeen) {
              existing.lastSeen = timestamp;
            }
          }
        } else {
          advertisers.set(id, {
            id,
            name: this.decodeFacebookUnicode(name),
            targetingType: 'interacted',
            interactionCount: 1,
            firstSeen: timestamp,
            lastSeen: timestamp,
            isDataBroker: DATA_BROKERS.has(name),
          });
        }
        interactedCount++;
      }
      console.log(`   ✓ Parsed ${interactedCount} ad interactions`);
    } catch (err) {
      console.log(`   ⚠ Could not parse advertisers_you've_interacted_with: ${err}`);
    }

    const dataBrokerCount = Array.from(advertisers.values()).filter(a => a.isDataBroker).length;

    console.log(`\n✅ Advertisers parsing complete:`);
    console.log(`   Total advertisers: ${advertisers.size}`);
    console.log(`   Data brokers: ${dataBrokerCount}`);

    return {
      advertisers: Array.from(advertisers.values()),
      stats: {
        total: advertisers.size,
        dataBrokers: dataBrokerCount,
        byTargetingType,
      },
    };
  }

  /**
   * Parse all pages data from the Facebook export
   */
  async parsePages(exportPath: string): Promise<PagesParseResult> {
    console.log(`📄 Parsing pages data from: ${exportPath}`);

    const pages = new Map<string, ParsedPage>();
    let totalLiked = 0;
    let totalFollowed = 0;
    let totalUnfollowed = 0;
    let earliestLike: number | undefined;
    let latestLike: number | undefined;

    // Parse pages you've liked
    const likedPath = path.join(exportPath, "your_facebook_activity/pages/pages_you've_liked.json");
    try {
      const rawData = await fs.readFile(likedPath, 'utf-8');
      const data = JSON.parse(rawData);
      const likedPages = data.page_likes_v2 || [];

      for (const page of likedPages) {
        const id = this.generateId('page', page.name);
        const existing = pages.get(id);

        // Extract Facebook ID from URL
        let facebookId: string | undefined;
        if (page.url) {
          const match = page.url.match(/facebook\.com\/(\d+)/);
          if (match) facebookId = match[1];
        }

        if (existing) {
          existing.isLiked = true;
          existing.likedAt = page.timestamp;
          if (!existing.url) existing.url = page.url;
          if (!existing.facebookId) existing.facebookId = facebookId;
        } else {
          pages.set(id, {
            id,
            name: this.decodeFacebookUnicode(page.name),
            facebookId,
            url: page.url,
            isLiked: true,
            likedAt: page.timestamp,
            isFollowing: false,
          });
        }

        // Track date range
        if (page.timestamp) {
          if (!earliestLike || page.timestamp < earliestLike) earliestLike = page.timestamp;
          if (!latestLike || page.timestamp > latestLike) latestLike = page.timestamp;
        }
        totalLiked++;
      }
      console.log(`   ✓ Parsed ${likedPages.length} liked pages`);
    } catch (err) {
      console.log(`   ⚠ Could not parse pages_you've_liked: ${err}`);
    }

    // Parse pages and profiles you follow
    const followedPath = path.join(exportPath, 'your_facebook_activity/pages/pages_and_profiles_you_follow.json');
    try {
      const rawData = await fs.readFile(followedPath, 'utf-8');
      const data = JSON.parse(rawData);
      const followedPages = data.pages_followed_v2 || [];

      for (const page of followedPages) {
        const name = page.title || page.data?.[0]?.name;
        if (!name) continue;

        const id = this.generateId('page', name);
        const existing = pages.get(id);

        if (existing) {
          existing.isFollowing = true;
          existing.followedAt = page.timestamp;
        } else {
          pages.set(id, {
            id,
            name: this.decodeFacebookUnicode(name),
            isLiked: false,
            isFollowing: true,
            followedAt: page.timestamp,
          });
        }
        totalFollowed++;
      }
      console.log(`   ✓ Parsed ${followedPages.length} followed pages`);
    } catch (err) {
      console.log(`   ⚠ Could not parse pages_and_profiles_you_follow: ${err}`);
    }

    // Parse unfollowed pages
    const unfollowedPath = path.join(exportPath, "your_facebook_activity/pages/pages_and_profiles_you've_unfollowed.json");
    try {
      const rawData = await fs.readFile(unfollowedPath, 'utf-8');
      const data = JSON.parse(rawData);
      const unfollowedPages = data.pages_unfollowed_v2 || [];

      for (const page of unfollowedPages) {
        const name = page.title || page.data?.[0]?.name;
        if (!name) continue;

        const id = this.generateId('page', name);
        const existing = pages.get(id);

        if (existing) {
          existing.unfollowedAt = page.timestamp;
        } else {
          pages.set(id, {
            id,
            name: this.decodeFacebookUnicode(name),
            isLiked: false,
            isFollowing: false,
            unfollowedAt: page.timestamp,
          });
        }
        totalUnfollowed++;
      }
      console.log(`   ✓ Parsed ${unfollowedPages.length} unfollowed pages`);
    } catch (err) {
      console.log(`   ⚠ Could not parse unfollowed pages: ${err}`);
    }

    console.log(`\n✅ Pages parsing complete:`);
    console.log(`   Total pages: ${pages.size}`);
    console.log(`   Liked: ${totalLiked}`);
    console.log(`   Followed: ${totalFollowed}`);
    console.log(`   Unfollowed: ${totalUnfollowed}`);

    return {
      pages: Array.from(pages.values()),
      stats: {
        totalLiked,
        totalFollowed,
        totalUnfollowed,
        earliestLike,
        latestLike,
      },
    };
  }

  /**
   * Generate a stable ID from a name
   */
  private generateId(type: string, name: string): string {
    const hash = createHash('md5').update(name.toLowerCase()).digest('hex').slice(0, 12);
    return `fb_${type}_${hash}`;
  }

  /**
   * Categorize advertiser targeting type based on label
   */
  private categorizeTargetingType(label: string): string {
    if (!label) return 'unknown';
    const lower = label.toLowerCase();
    if (lower.includes('uploaded') || lower.includes('list')) return 'uploaded_list';
    if (lower.includes('activity')) return 'activity';
    if (lower.includes('interest')) return 'interest';
    if (lower.includes('retarget') || lower.includes('visited')) return 'retargeting';
    if (lower.includes('custom')) return 'custom';
    return 'other';
  }

  /**
   * Decode Facebook's non-standard Unicode encoding
   */
  private decodeFacebookUnicode(text: string): string {
    if (!text) return text;
    try {
      // Facebook exports use a weird encoding where UTF-8 bytes are escaped as \u00xx
      const parsed = JSON.parse(`"${text.replace(/"/g, '\\"')}"`);
      const bytes = new Uint8Array([...parsed].map(c => c.charCodeAt(0)));
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return text;
    }
  }
}

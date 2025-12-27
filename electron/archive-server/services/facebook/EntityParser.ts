/**
 * EntityParser - Extracts entities from Facebook export for relationship graph
 *
 * Parses: Friends, Followers, Check-ins/Places, Events, Advertisers, Off-Facebook Activity
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type {
  FbPerson,
  FbPlace,
  FbEvent,
  FbAdvertiser,
  FbOffFacebookActivity,
  RawFacebookFriend,
  RawFacebookCheckIn,
  RawFacebookAdvertiser,
  RawFacebookOffFacebookActivity,
  RawFacebookEventInvitation,
} from './types.js';

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
  'Samba TV',
  'Cross Screen Media',
  'Lotame',
  'Eyeota',
  'ShareThis',
  'Tapad',
  'Drawbridge',
]);

export interface EntityParserResult {
  people: FbPerson[];
  places: FbPlace[];
  events: FbEvent[];
  advertisers: FbAdvertiser[];
  offFacebookActivity: FbOffFacebookActivity[];
}

export class EntityParser {
  private exportPath: string;
  private now: number;

  constructor(exportPath: string) {
    this.exportPath = exportPath;
    this.now = Date.now() / 1000;
  }

  /**
   * Parse all entity types from the Facebook export
   */
  async parseAll(): Promise<EntityParserResult> {
    console.log('📊 Starting entity parsing...');

    const [people, places, events, advertisers, offFacebookActivity] = await Promise.all([
      this.parsePeople(),
      this.parsePlaces(),
      this.parseEvents(),
      this.parseAdvertisers(),
      this.parseOffFacebookActivity(),
    ]);

    console.log(`✅ Entity parsing complete:`);
    console.log(`   People: ${people.length}`);
    console.log(`   Places: ${places.length}`);
    console.log(`   Events: ${events.length}`);
    console.log(`   Advertisers: ${advertisers.length}`);
    console.log(`   Off-Facebook apps: ${offFacebookActivity.length}`);

    return { people, places, events, advertisers, offFacebookActivity };
  }

  /**
   * Parse friends, followers, and following into fb_people
   */
  async parsePeople(): Promise<FbPerson[]> {
    const people = new Map<string, FbPerson>();

    // Friends
    const friendsPath = path.join(this.exportPath, 'connections/friends/your_friends.json');
    if (fs.existsSync(friendsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(friendsPath, 'utf-8'));
        const friends: RawFacebookFriend[] = data.friends_v2 || [];

        for (const friend of friends) {
          const id = this.generatePersonId(friend.name);
          const existing = people.get(id);

          if (existing) {
            existing.is_friend = true;
            existing.friend_since = friend.timestamp;
          } else {
            people.set(id, {
              id,
              name: friend.name,
              is_friend: true,
              friend_since: friend.timestamp,
              is_follower: false,
              is_following: false,
              interaction_count: 0,
              tag_count: 0,
              created_at: this.now,
            });
          }
        }
        console.log(`   Parsed ${friends.length} friends`);
      } catch (err) {
        console.error('Error parsing friends:', err);
      }
    }

    // Followers
    const followersPath = path.join(this.exportPath, 'connections/followers/people_who_followed_you.json');
    if (fs.existsSync(followersPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(followersPath, 'utf-8'));
        const followers: RawFacebookFriend[] = data.followers_v2 || [];

        for (const follower of followers) {
          const id = this.generatePersonId(follower.name);
          const existing = people.get(id);

          if (existing) {
            existing.is_follower = true;
          } else {
            people.set(id, {
              id,
              name: follower.name,
              is_friend: false,
              is_follower: true,
              is_following: false,
              interaction_count: 0,
              tag_count: 0,
              created_at: this.now,
            });
          }
        }
        console.log(`   Parsed ${followers.length} followers`);
      } catch (err) {
        console.error('Error parsing followers:', err);
      }
    }

    // Following
    const followingPath = path.join(this.exportPath, 'connections/followers/who_you\'ve_followed.json');
    if (fs.existsSync(followingPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(followingPath, 'utf-8'));
        const following: RawFacebookFriend[] = data.following_v2 || [];

        for (const person of following) {
          const id = this.generatePersonId(person.name);
          const existing = people.get(id);

          if (existing) {
            existing.is_following = true;
          } else {
            people.set(id, {
              id,
              name: person.name,
              is_friend: false,
              is_follower: false,
              is_following: true,
              interaction_count: 0,
              tag_count: 0,
              created_at: this.now,
            });
          }
        }
        console.log(`   Parsed ${following.length} following`);
      } catch (err) {
        console.error('Error parsing following:', err);
      }
    }

    return Array.from(people.values());
  }

  /**
   * Parse check-ins into fb_places
   */
  async parsePlaces(): Promise<FbPlace[]> {
    const places = new Map<string, FbPlace>();

    const checkInsPath = path.join(this.exportPath, 'your_facebook_activity/posts/check-ins.json');
    if (fs.existsSync(checkInsPath)) {
      try {
        const checkIns: RawFacebookCheckIn[] = JSON.parse(fs.readFileSync(checkInsPath, 'utf-8'));

        for (const checkIn of checkIns) {
          const placeInfo = this.extractPlaceFromCheckIn(checkIn);
          if (!placeInfo) continue;

          const id = this.generatePlaceId(placeInfo.name);
          const existing = places.get(id);

          if (existing) {
            existing.visit_count++;
            if (!existing.first_visit || checkIn.timestamp < existing.first_visit) {
              existing.first_visit = checkIn.timestamp;
            }
            if (!existing.last_visit || checkIn.timestamp > existing.last_visit) {
              existing.last_visit = checkIn.timestamp;
            }
          } else {
            places.set(id, {
              id,
              name: placeInfo.name,
              address: placeInfo.address,
              latitude: placeInfo.latitude,
              longitude: placeInfo.longitude,
              visit_count: 1,
              first_visit: checkIn.timestamp,
              last_visit: checkIn.timestamp,
              created_at: this.now,
            });
          }
        }
        console.log(`   Parsed ${checkIns.length} check-ins → ${places.size} unique places`);
      } catch (err) {
        console.error('Error parsing check-ins:', err);
      }
    }

    return Array.from(places.values());
  }

  /**
   * Parse events (invitations, responses, hosted)
   */
  async parseEvents(): Promise<FbEvent[]> {
    const events = new Map<string, FbEvent>();

    // Event invitations
    const invitationsPath = path.join(this.exportPath, 'your_facebook_activity/events/event_invitations.json');
    if (fs.existsSync(invitationsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(invitationsPath, 'utf-8'));
        const invitations: RawFacebookEventInvitation[] = data.events_invited_v2 || [];

        for (const event of invitations) {
          const id = this.generateEventId(event.name, event.start_timestamp);
          events.set(id, {
            id,
            name: this.decodeUtf8(event.name),
            start_timestamp: event.start_timestamp,
            end_timestamp: event.end_timestamp || undefined,
            response_type: 'invited',
            created_at: this.now,
          });
        }
        console.log(`   Parsed ${invitations.length} event invitations`);
      } catch (err) {
        console.error('Error parsing event invitations:', err);
      }
    }

    // Event responses (joined, interested, etc.)
    const responsesPath = path.join(this.exportPath, 'your_facebook_activity/events/your_event_responses.json');
    if (fs.existsSync(responsesPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(responsesPath, 'utf-8'));

        // events_joined
        const joined: RawFacebookEventInvitation[] = data.event_responses_v2?.events_joined || [];
        for (const event of joined) {
          const id = this.generateEventId(event.name, event.start_timestamp);
          const existing = events.get(id);
          if (existing) {
            existing.response_type = 'joined';
          } else {
            events.set(id, {
              id,
              name: this.decodeUtf8(event.name),
              start_timestamp: event.start_timestamp,
              end_timestamp: event.end_timestamp || undefined,
              response_type: 'joined',
              created_at: this.now,
            });
          }
        }

        // events_interested (if exists)
        const interested: RawFacebookEventInvitation[] = data.event_responses_v2?.events_interested || [];
        for (const event of interested) {
          const id = this.generateEventId(event.name, event.start_timestamp);
          const existing = events.get(id);
          if (existing) {
            existing.response_type = 'interested';
          } else {
            events.set(id, {
              id,
              name: this.decodeUtf8(event.name),
              start_timestamp: event.start_timestamp,
              end_timestamp: event.end_timestamp || undefined,
              response_type: 'interested',
              created_at: this.now,
            });
          }
        }

        console.log(`   Parsed ${joined.length} joined + ${interested.length} interested events`);
      } catch (err) {
        console.error('Error parsing event responses:', err);
      }
    }

    // Events hosted
    const hostedPath = path.join(this.exportPath, 'your_facebook_activity/events/events_you_hosted.json');
    if (fs.existsSync(hostedPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(hostedPath, 'utf-8'));
        const hosted: RawFacebookEventInvitation[] = data.events_you_hosted_v2 || [];

        for (const event of hosted) {
          const id = this.generateEventId(event.name, event.start_timestamp);
          const existing = events.get(id);
          if (existing) {
            existing.response_type = 'hosted';
          } else {
            events.set(id, {
              id,
              name: this.decodeUtf8(event.name),
              start_timestamp: event.start_timestamp,
              end_timestamp: event.end_timestamp || undefined,
              response_type: 'hosted',
              created_at: this.now,
            });
          }
        }
        console.log(`   Parsed ${hosted.length} hosted events`);
      } catch (err) {
        console.error('Error parsing hosted events:', err);
      }
    }

    return Array.from(events.values());
  }

  /**
   * Parse advertisers who have your data
   */
  async parseAdvertisers(): Promise<FbAdvertiser[]> {
    const advertisers = new Map<string, FbAdvertiser>();

    const adsPath = path.join(this.exportPath, 'ads_information/advertisers_using_your_activity_or_information.json');
    if (fs.existsSync(adsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(adsPath, 'utf-8'));
        const labelValues: RawFacebookAdvertiser[] = data.label_values || [];

        for (const category of labelValues) {
          const targetingType = this.categorizeTargetingType(category.label);
          const names = category.vec || [];

          for (const item of names) {
            const name = item.value;
            if (!name) continue;

            const id = this.generateAdvertiserId(name);
            const existing = advertisers.get(id);

            if (existing) {
              existing.interaction_count++;
            } else {
              advertisers.set(id, {
                id,
                name,
                targeting_type: targetingType,
                interaction_count: 1,
                first_seen: this.now,
                last_seen: this.now,
                is_data_broker: DATA_BROKERS.has(name),
                created_at: this.now,
              });
            }
          }
        }
        console.log(`   Parsed ${advertisers.size} advertisers`);
      } catch (err) {
        console.error('Error parsing advertisers:', err);
      }
    }

    // Also parse advertisers you've interacted with
    const interactedPath = path.join(this.exportPath, 'ads_information/advertisers_you\'ve_interacted_with.json');
    if (fs.existsSync(interactedPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(interactedPath, 'utf-8'));
        const history = data.history_v2 || [];

        for (const interaction of history) {
          const name = interaction.title;
          if (!name) continue;

          const id = this.generateAdvertiserId(name);
          const existing = advertisers.get(id);

          if (existing) {
            existing.interaction_count++;
            if (interaction.timestamp) {
              if (!existing.first_seen || interaction.timestamp < existing.first_seen) {
                existing.first_seen = interaction.timestamp;
              }
              if (!existing.last_seen || interaction.timestamp > existing.last_seen) {
                existing.last_seen = interaction.timestamp;
              }
            }
          } else {
            advertisers.set(id, {
              id,
              name,
              targeting_type: 'activity',
              interaction_count: 1,
              first_seen: interaction.timestamp,
              last_seen: interaction.timestamp,
              is_data_broker: DATA_BROKERS.has(name),
              created_at: this.now,
            });
          }
        }
      } catch (err) {
        console.error('Error parsing interacted advertisers:', err);
      }
    }

    return Array.from(advertisers.values());
  }

  /**
   * Parse off-Facebook activity (third-party tracking)
   */
  async parseOffFacebookActivity(): Promise<FbOffFacebookActivity[]> {
    const activities = new Map<string, FbOffFacebookActivity>();

    const offFbPath = path.join(this.exportPath, 'apps_and_websites_off_of_facebook/your_activity_off_meta_technologies.json');
    if (fs.existsSync(offFbPath)) {
      try {
        const data: RawFacebookOffFacebookActivity[] = JSON.parse(fs.readFileSync(offFbPath, 'utf-8'));

        for (const app of data) {
          const appName = app.title;
          if (!appName) continue;

          const id = this.generateOffFacebookId(appName);

          // Count events and find timestamp range
          let eventCount = 0;
          let firstEvent: number | undefined;
          let lastEvent: number | undefined;

          for (const labelValue of app.label_values || []) {
            if (labelValue.label === 'Events') {
              for (const vec of labelValue.vec || []) {
                eventCount++;
                for (const dict of vec.dict || []) {
                  if (dict.label === 'Received on' && dict.timestamp_value) {
                    if (!firstEvent || dict.timestamp_value < firstEvent) {
                      firstEvent = dict.timestamp_value;
                    }
                    if (!lastEvent || dict.timestamp_value > lastEvent) {
                      lastEvent = dict.timestamp_value;
                    }
                  }
                }
              }
            }
          }

          const existing = activities.get(id);
          if (existing) {
            existing.event_count += eventCount;
            if (firstEvent && (!existing.first_event || firstEvent < existing.first_event)) {
              existing.first_event = firstEvent;
            }
            if (lastEvent && (!existing.last_event || lastEvent > existing.last_event)) {
              existing.last_event = lastEvent;
            }
          } else {
            activities.set(id, {
              id,
              app_name: appName,
              event_count: eventCount,
              first_event: firstEvent,
              last_event: lastEvent,
              created_at: this.now,
            });
          }
        }
        console.log(`   Parsed ${activities.size} off-Facebook apps`);
      } catch (err) {
        console.error('Error parsing off-Facebook activity:', err);
      }
    }

    return Array.from(activities.values());
  }

  // ============================================================
  // Helper methods
  // ============================================================

  private generatePersonId(name: string): string {
    const hash = createHash('md5').update(name.toLowerCase()).digest('hex').slice(0, 12);
    return `fb_person_${hash}`;
  }

  private generatePlaceId(name: string): string {
    const hash = createHash('md5').update(name.toLowerCase()).digest('hex').slice(0, 12);
    return `fb_place_${hash}`;
  }

  private generateEventId(name: string, startTimestamp: number): string {
    const hash = createHash('md5').update(`${name.toLowerCase()}_${startTimestamp}`).digest('hex').slice(0, 12);
    return `fb_event_${hash}`;
  }

  private generateAdvertiserId(name: string): string {
    const hash = createHash('md5').update(name.toLowerCase()).digest('hex').slice(0, 12);
    return `fb_advertiser_${hash}`;
  }

  private generateOffFacebookId(appName: string): string {
    const hash = createHash('md5').update(appName.toLowerCase()).digest('hex').slice(0, 12);
    return `fb_offfb_${hash}`;
  }

  private extractPlaceFromCheckIn(checkIn: RawFacebookCheckIn): { name: string; address?: string; latitude?: number; longitude?: number } | null {
    for (const labelValue of checkIn.label_values || []) {
      if (labelValue.label === 'Place tags' && labelValue.dict) {
        let name: string | undefined;
        let address: string | undefined;
        let latitude: number | undefined;
        let longitude: number | undefined;

        for (const item of labelValue.dict) {
          if (item.label === 'Name') name = item.value;
          if (item.label === 'Address') address = item.value;
          if (item.label === 'Coordinates' && item.value) {
            const match = item.value.match(/\(([-\d.]+)\s*,\s*([-\d.]+)\)/);
            if (match) {
              latitude = parseFloat(match[1]);
              longitude = parseFloat(match[2]);
            }
          }
        }

        if (name) {
          return { name, address, latitude, longitude };
        }
      }
    }
    return null;
  }

  private categorizeTargetingType(label: string): FbAdvertiser['targeting_type'] {
    if (label.includes('uploaded') || label.includes('list')) return 'uploaded_list';
    if (label.includes('activity')) return 'activity';
    if (label.includes('interest')) return 'interest';
    if (label.includes('retarget') || label.includes('visited')) return 'retargeting';
    return 'custom';
  }

  private decodeUtf8(str: string): string {
    // Facebook exports sometimes have double-encoded UTF-8
    try {
      return decodeURIComponent(escape(str));
    } catch {
      return str;
    }
  }
}

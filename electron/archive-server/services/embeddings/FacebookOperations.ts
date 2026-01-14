/**
 * FacebookOperations - Facebook entity graph, relationships, and image analysis
 *
 * Extracted from EmbeddingDatabase for maintainability.
 */

import { DatabaseOperations } from './DatabaseOperations.js';
import { EMBEDDING_DIM } from './EmbeddingMigrations.js';

export class FacebookOperations extends DatabaseOperations {
  // ===========================================================================
  // Facebook Entity Graph
  // ===========================================================================

  insertFbPerson(person: {
    id: string;
    name: string;
    facebook_id?: string;
    profile_url?: string;
    is_friend: number;
    friend_since?: number;
    is_follower: number;
    is_following: number;
    interaction_count: number;
    tag_count: number;
    last_interaction?: number;
    first_interaction?: number;
    relationship_strength?: number;
    created_at: number;
    updated_at?: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO fb_people
      (id, name, facebook_id, profile_url, is_friend, friend_since, is_follower, is_following,
       interaction_count, tag_count, last_interaction, first_interaction, relationship_strength, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      person.id, person.name, person.facebook_id || null, person.profile_url || null,
      person.is_friend, person.friend_since || null, person.is_follower, person.is_following,
      person.interaction_count, person.tag_count, person.last_interaction || null,
      person.first_interaction || null, person.relationship_strength || null,
      person.created_at, person.updated_at || null
    );
  }

  insertFbPeopleBatch(people: Array<{
    id: string;
    name: string;
    facebook_id?: string;
    profile_url?: string;
    is_friend: boolean;
    friend_since?: number;
    is_follower: boolean;
    is_following: boolean;
    interaction_count: number;
    tag_count: number;
    last_interaction?: number;
    first_interaction?: number;
    relationship_strength?: number;
    created_at: number;
    updated_at?: number;
  }>): number {
    const insertMany = this.db.transaction((items: typeof people) => {
      for (const p of items) {
        this.insertFbPerson({
          ...p,
          is_friend: p.is_friend ? 1 : 0,
          is_follower: p.is_follower ? 1 : 0,
          is_following: p.is_following ? 1 : 0,
        });
      }
    });
    insertMany(people);
    return people.length;
  }

  insertFbPlace(place: {
    id: string;
    name: string;
    address?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    visit_count: number;
    first_visit?: number;
    last_visit?: number;
    place_type?: string;
    metadata?: string;
    created_at: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO fb_places
      (id, name, address, city, latitude, longitude, visit_count, first_visit, last_visit, place_type, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      place.id, place.name, place.address || null, place.city || null,
      place.latitude || null, place.longitude || null, place.visit_count,
      place.first_visit || null, place.last_visit || null,
      place.place_type || null, place.metadata || null, place.created_at
    );
  }

  insertFbPlacesBatch(places: Array<{
    id: string;
    name: string;
    address?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    visit_count: number;
    first_visit?: number;
    last_visit?: number;
    place_type?: string;
    metadata?: Record<string, unknown>;
    created_at: number;
  }>): number {
    const insertMany = this.db.transaction((items: typeof places) => {
      for (const p of items) {
        this.insertFbPlace({
          ...p,
          metadata: p.metadata ? JSON.stringify(p.metadata) : undefined,
        });
      }
    });
    insertMany(places);
    return places.length;
  }

  insertFbEvent(event: {
    id: string;
    name: string;
    start_timestamp?: number;
    end_timestamp?: number;
    place_id?: string;
    response_type?: string;
    response_timestamp?: number;
    metadata?: string;
    created_at: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO fb_events
      (id, name, start_timestamp, end_timestamp, place_id, response_type, response_timestamp, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id, event.name, event.start_timestamp || null, event.end_timestamp || null,
      event.place_id || null, event.response_type || null, event.response_timestamp || null,
      event.metadata || null, event.created_at
    );
  }

  insertFbEventsBatch(events: Array<{
    id: string;
    name: string;
    start_timestamp?: number;
    end_timestamp?: number;
    place_id?: string;
    response_type?: string;
    response_timestamp?: number;
    metadata?: Record<string, unknown>;
    created_at: number;
  }>): number {
    const insertMany = this.db.transaction((items: typeof events) => {
      for (const e of items) {
        this.insertFbEvent({
          ...e,
          metadata: e.metadata ? JSON.stringify(e.metadata) : undefined,
        });
      }
    });
    insertMany(events);
    return events.length;
  }

  insertFbAdvertiser(advertiser: {
    id: string;
    name: string;
    targeting_type?: string;
    interaction_count: number;
    first_seen?: number;
    last_seen?: number;
    is_data_broker: number;
    metadata?: string;
    created_at: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO fb_advertisers
      (id, name, targeting_type, interaction_count, first_seen, last_seen, is_data_broker, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      advertiser.id, advertiser.name, advertiser.targeting_type || null,
      advertiser.interaction_count, advertiser.first_seen || null, advertiser.last_seen || null,
      advertiser.is_data_broker, advertiser.metadata || null, advertiser.created_at
    );
  }

  insertFbAdvertisersBatch(advertisers: Array<{
    id: string;
    name: string;
    targeting_type?: string;
    interaction_count: number;
    first_seen?: number;
    last_seen?: number;
    is_data_broker: boolean;
    metadata?: Record<string, unknown>;
    created_at: number;
  }>): number {
    const insertMany = this.db.transaction((items: typeof advertisers) => {
      for (const a of items) {
        this.insertFbAdvertiser({
          ...a,
          is_data_broker: a.is_data_broker ? 1 : 0,
          metadata: a.metadata ? JSON.stringify(a.metadata) : undefined,
        });
      }
    });
    insertMany(advertisers);
    return advertisers.length;
  }

  insertFbOffFacebookActivity(activity: {
    id: string;
    app_name: string;
    event_type?: string;
    event_count: number;
    first_event?: number;
    last_event?: number;
    metadata?: string;
    created_at: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO fb_off_facebook_activity
      (id, app_name, event_type, event_count, first_event, last_event, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      activity.id, activity.app_name, activity.event_type || null,
      activity.event_count, activity.first_event || null, activity.last_event || null,
      activity.metadata || null, activity.created_at
    );
  }

  insertFbOffFacebookBatch(activities: Array<{
    id: string;
    app_name: string;
    event_type?: string;
    event_count: number;
    first_event?: number;
    last_event?: number;
    metadata?: Record<string, unknown>;
    created_at: number;
  }>): number {
    const insertMany = this.db.transaction((items: typeof activities) => {
      for (const a of items) {
        this.insertFbOffFacebookActivity({
          ...a,
          metadata: a.metadata ? JSON.stringify(a.metadata) : undefined,
        });
      }
    });
    insertMany(activities);
    return activities.length;
  }

  // Query methods for entities
  getFbPeople(options?: { isFriend?: boolean; limit?: number }): Record<string, unknown>[] {
    let sql = 'SELECT * FROM fb_people';
    const params: unknown[] = [];

    if (options?.isFriend !== undefined) {
      sql += ' WHERE is_friend = ?';
      params.push(options.isFriend ? 1 : 0);
    }

    sql += ' ORDER BY interaction_count DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return this.db.prepare(sql).all(...params) as Record<string, unknown>[];
  }

  getFbPlaces(options?: { limit?: number }): Record<string, unknown>[] {
    let sql = 'SELECT * FROM fb_places ORDER BY visit_count DESC';
    if (options?.limit) {
      sql += ' LIMIT ?';
      return this.db.prepare(sql).all(options.limit) as Record<string, unknown>[];
    }
    return this.db.prepare(sql).all() as Record<string, unknown>[];
  }

  getFbEvents(options?: { responseType?: string; limit?: number }): Record<string, unknown>[] {
    let sql = 'SELECT * FROM fb_events';
    const params: unknown[] = [];

    if (options?.responseType) {
      sql += ' WHERE response_type = ?';
      params.push(options.responseType);
    }

    sql += ' ORDER BY start_timestamp DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return this.db.prepare(sql).all(...params) as Record<string, unknown>[];
  }

  getFbAdvertisers(options?: { isDataBroker?: boolean; limit?: number }): Record<string, unknown>[] {
    let sql = 'SELECT * FROM fb_advertisers';
    const params: unknown[] = [];

    if (options?.isDataBroker !== undefined) {
      sql += ' WHERE is_data_broker = ?';
      params.push(options.isDataBroker ? 1 : 0);
    }

    sql += ' ORDER BY interaction_count DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return this.db.prepare(sql).all(...params) as Record<string, unknown>[];
  }

  getFbOffFacebookActivity(options?: { limit?: number }): Record<string, unknown>[] {
    let sql = 'SELECT * FROM fb_off_facebook_activity ORDER BY event_count DESC';
    if (options?.limit) {
      sql += ' LIMIT ?';
      return this.db.prepare(sql).all(options.limit) as Record<string, unknown>[];
    }
    return this.db.prepare(sql).all() as Record<string, unknown>[];
  }

  getEntityStats(): {
    people: number;
    places: number;
    events: number;
    advertisers: number;
    offFacebook: number;
    dataBrokers: number;
  } {
    return {
      people: (this.db.prepare('SELECT COUNT(*) as count FROM fb_people').get() as { count: number }).count,
      places: (this.db.prepare('SELECT COUNT(*) as count FROM fb_places').get() as { count: number }).count,
      events: (this.db.prepare('SELECT COUNT(*) as count FROM fb_events').get() as { count: number }).count,
      advertisers: (this.db.prepare('SELECT COUNT(*) as count FROM fb_advertisers').get() as { count: number }).count,
      offFacebook: (this.db.prepare('SELECT COUNT(*) as count FROM fb_off_facebook_activity').get() as { count: number }).count,
      dataBrokers: (this.db.prepare('SELECT COUNT(*) as count FROM fb_advertisers WHERE is_data_broker = 1').get() as { count: number }).count,
    };
  }

  // ===========================================================================
  // Relationship Operations
  // ===========================================================================

  insertFbRelationship(rel: {
    id: string;
    source_type: string;
    source_id: string;
    target_type: string;
    target_id: string;
    relationship_type: string;
    context_type?: string;
    context_id?: string;
    timestamp?: number;
    weight: number;
    metadata?: string;
    created_at: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO fb_relationships
      (id, source_type, source_id, target_type, target_id, relationship_type,
       context_type, context_id, timestamp, weight, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rel.id, rel.source_type, rel.source_id, rel.target_type, rel.target_id,
      rel.relationship_type, rel.context_type || null, rel.context_id || null,
      rel.timestamp || null, rel.weight, rel.metadata || null, rel.created_at
    );
  }

  insertFbRelationshipsBatch(relationships: Array<{
    id: string;
    source_type: string;
    source_id: string;
    target_type: string;
    target_id: string;
    relationship_type: string;
    context_type?: string;
    context_id?: string;
    timestamp?: number;
    weight: number;
    metadata?: Record<string, unknown>;
    created_at: number;
  }>): number {
    const insertMany = this.db.transaction((items: typeof relationships) => {
      for (const r of items) {
        this.insertFbRelationship({
          ...r,
          metadata: r.metadata ? JSON.stringify(r.metadata) : undefined,
        });
      }
    });
    insertMany(relationships);
    return relationships.length;
  }

  getFbRelationships(options?: {
    sourceType?: string;
    sourceId?: string;
    targetType?: string;
    targetId?: string;
    relationshipType?: string;
    limit?: number;
  }): Record<string, unknown>[] {
    let sql = 'SELECT * FROM fb_relationships WHERE 1=1';
    const params: unknown[] = [];

    if (options?.sourceType) {
      sql += ' AND source_type = ?';
      params.push(options.sourceType);
    }
    if (options?.sourceId) {
      sql += ' AND source_id = ?';
      params.push(options.sourceId);
    }
    if (options?.targetType) {
      sql += ' AND target_type = ?';
      params.push(options.targetType);
    }
    if (options?.targetId) {
      sql += ' AND target_id = ?';
      params.push(options.targetId);
    }
    if (options?.relationshipType) {
      sql += ' AND relationship_type = ?';
      params.push(options.relationshipType);
    }

    sql += ' ORDER BY weight DESC, timestamp DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return this.db.prepare(sql).all(...params) as Record<string, unknown>[];
  }

  getFbPersonConnections(personId: string, options?: { limit?: number }): Array<{
    person: Record<string, unknown>;
    relationship_type: string;
    weight: number;
    timestamp?: number;
    direction: 'outgoing' | 'incoming';
  }> {
    const limit = options?.limit || 100;

    // Outgoing relationships (this person → others)
    const outgoing = this.db.prepare(`
      SELECT r.*, p.name, p.is_friend, p.is_follower, p.interaction_count
      FROM fb_relationships r
      JOIN fb_people p ON r.target_id = p.id
      WHERE r.source_id = ? AND r.target_type = 'person'
      ORDER BY r.weight DESC
      LIMIT ?
    `).all(personId, limit) as Record<string, unknown>[];

    // Incoming relationships (others → this person)
    const incoming = this.db.prepare(`
      SELECT r.*, p.name, p.is_friend, p.is_follower, p.interaction_count
      FROM fb_relationships r
      JOIN fb_people p ON r.source_id = p.id
      WHERE r.target_id = ? AND r.source_type = 'person'
      ORDER BY r.weight DESC
      LIMIT ?
    `).all(personId, limit) as Record<string, unknown>[];

    const results: Array<{
      person: Record<string, unknown>;
      relationship_type: string;
      weight: number;
      timestamp?: number;
      direction: 'outgoing' | 'incoming';
    }> = [];

    for (const row of outgoing) {
      results.push({
        person: {
          id: row.target_id,
          name: row.name,
          is_friend: row.is_friend === 1,
          is_follower: row.is_follower === 1,
          interaction_count: row.interaction_count,
        },
        relationship_type: row.relationship_type as string,
        weight: row.weight as number,
        timestamp: row.timestamp as number | undefined,
        direction: 'outgoing',
      });
    }

    for (const row of incoming) {
      results.push({
        person: {
          id: row.source_id,
          name: row.name,
          is_friend: row.is_friend === 1,
          is_follower: row.is_follower === 1,
          interaction_count: row.interaction_count,
        },
        relationship_type: row.relationship_type as string,
        weight: row.weight as number,
        timestamp: row.timestamp as number | undefined,
        direction: 'incoming',
      });
    }

    // Sort by weight and dedupe
    results.sort((a, b) => b.weight - a.weight);
    return results.slice(0, limit);
  }

  getTopConnectedPeople(options?: { limit?: number }): Array<{
    person: Record<string, unknown>;
    total_weight: number;
    relationship_count: number;
  }> {
    const limit = options?.limit || 50;

    const rows = this.db.prepare(`
      SELECT
        p.id, p.name, p.is_friend, p.is_follower, p.interaction_count,
        SUM(r.weight) as total_weight,
        COUNT(r.id) as relationship_count
      FROM fb_people p
      JOIN fb_relationships r ON (r.source_id = p.id OR r.target_id = p.id)
      WHERE p.id != ?
      GROUP BY p.id
      ORDER BY total_weight DESC
      LIMIT ?
    `).all('fb_person_self', limit) as Record<string, unknown>[];

    return rows.map(row => ({
      person: {
        id: row.id,
        name: row.name,
        is_friend: row.is_friend === 1,
        is_follower: row.is_follower === 1,
        interaction_count: row.interaction_count,
      },
      total_weight: row.total_weight as number,
      relationship_count: row.relationship_count as number,
    }));
  }

  getRelationshipStats(): {
    totalRelationships: number;
    byType: Record<string, number>;
    avgWeight: number;
    topRelationshipTypes: Array<{ type: string; count: number; avg_weight: number }>;
  } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM fb_relationships').get() as { count: number }).count;
    const avgWeight = (this.db.prepare('SELECT AVG(weight) as avg FROM fb_relationships').get() as { avg: number }).avg || 0;

    const byTypeRows = this.db.prepare(`
      SELECT relationship_type, COUNT(*) as count, AVG(weight) as avg_weight
      FROM fb_relationships
      GROUP BY relationship_type
      ORDER BY count DESC
    `).all() as Array<{ relationship_type: string; count: number; avg_weight: number }>;

    const byType: Record<string, number> = {};
    for (const row of byTypeRows) {
      byType[row.relationship_type] = row.count;
    }

    return {
      totalRelationships: total,
      byType,
      avgWeight,
      topRelationshipTypes: byTypeRows.slice(0, 10).map(r => ({
        type: r.relationship_type,
        count: r.count,
        avg_weight: r.avg_weight,
      })),
    };
  }

  updatePersonInteractionStats(): void {
    // Update interaction counts based on relationship weights
    this.db.exec(`
      UPDATE fb_people
      SET
        interaction_count = (
          SELECT COALESCE(SUM(weight), 0)
          FROM fb_relationships
          WHERE (source_id = fb_people.id AND source_type = 'person')
             OR (target_id = fb_people.id AND target_type = 'person')
        ),
        relationship_strength = (
          SELECT COALESCE(SUM(weight), 0)
          FROM fb_relationships
          WHERE (source_id = fb_people.id OR target_id = fb_people.id)
        )
    `);
  }

  // ===========================================================================
  // Image Analysis Operations
  // ===========================================================================

  upsertImageAnalysis(analysis: {
    id: string;
    file_path: string;
    file_hash?: string;
    source: string;
    description?: string;
    categories?: string[];
    objects?: string[];
    scene?: string;
    mood?: string;
    model_used?: string;
    confidence?: number;
    processing_time_ms?: number;
    media_file_id?: string;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO image_analysis
      (id, file_path, file_hash, source, description, categories, objects, scene, mood,
       model_used, confidence, processing_time_ms, analyzed_at, updated_at, media_file_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        description = excluded.description,
        categories = excluded.categories,
        objects = excluded.objects,
        scene = excluded.scene,
        mood = excluded.mood,
        model_used = excluded.model_used,
        confidence = excluded.confidence,
        processing_time_ms = excluded.processing_time_ms,
        updated_at = excluded.updated_at
    `).run(
      analysis.id,
      analysis.file_path,
      analysis.file_hash || null,
      analysis.source,
      analysis.description || null,
      analysis.categories ? JSON.stringify(analysis.categories) : null,
      analysis.objects ? JSON.stringify(analysis.objects) : null,
      analysis.scene || null,
      analysis.mood || null,
      analysis.model_used || null,
      analysis.confidence || null,
      analysis.processing_time_ms || null,
      now,
      now,
      analysis.media_file_id || null
    );
  }

  getImageAnalysisByPath(filePath: string): {
    id: string;
    file_path: string;
    file_hash: string | null;
    source: string;
    description: string | null;
    categories: string[];
    objects: string[];
    scene: string | null;
    mood: string | null;
    model_used: string | null;
    confidence: number | null;
    analyzed_at: number;
  } | null {
    const row = this.db.prepare(`
      SELECT * FROM image_analysis WHERE file_path = ?
    `).get(filePath) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      file_path: row.file_path as string,
      file_hash: row.file_hash as string | null,
      source: row.source as string,
      description: row.description as string | null,
      categories: row.categories ? JSON.parse(row.categories as string) : [],
      objects: row.objects ? JSON.parse(row.objects as string) : [],
      scene: row.scene as string | null,
      mood: row.mood as string | null,
      model_used: row.model_used as string | null,
      confidence: row.confidence as number | null,
      analyzed_at: row.analyzed_at as number,
    };
  }

  getImageAnalysisById(id: string): {
    id: string;
    file_path: string;
    file_hash: string | null;
    source: string;
    description: string | null;
    categories: string[];
    objects: string[];
    scene: string | null;
    mood: string | null;
    model_used: string | null;
    confidence: number | null;
    processing_time_ms: number | null;
    analyzed_at: number;
  } | null {
    const row = this.db.prepare(`
      SELECT * FROM image_analysis WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      file_path: row.file_path as string,
      file_hash: row.file_hash as string | null,
      source: row.source as string,
      description: row.description as string | null,
      categories: row.categories ? JSON.parse(row.categories as string) : [],
      objects: row.objects ? JSON.parse(row.objects as string) : [],
      scene: row.scene as string | null,
      mood: row.mood as string | null,
      model_used: row.model_used as string | null,
      confidence: row.confidence as number | null,
      processing_time_ms: row.processing_time_ms as number | null,
      analyzed_at: row.analyzed_at as number,
    };
  }

  searchImagesFTS(query: string, options?: {
    limit?: number;
    source?: string;
  }): Array<{
    id: string;
    file_path: string;
    description: string | null;
    categories: string[];
    source: string;
    rank: number;
  }> {
    const limit = options?.limit || 20;
    let sql = `
      SELECT ia.id, ia.file_path, ia.description, ia.categories, ia.source,
             bm25(image_fts) as rank
      FROM image_fts
      JOIN image_analysis ia ON ia.rowid = image_fts.rowid
      WHERE image_fts MATCH ?
    `;

    const params: (string | number)[] = [query];

    if (options?.source) {
      sql += ` AND ia.source = ?`;
      params.push(options.source);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      file_path: row.file_path as string,
      description: row.description as string | null,
      categories: row.categories ? JSON.parse(row.categories as string) : [],
      source: row.source as string,
      rank: row.rank as number,
    }));
  }

  insertImageEmbedding(data: {
    id: string;
    image_analysis_id: string;
    embedding: Float32Array | number[];
    model: string;
    dimensions: number;
  }): void {
    const embeddingBuffer = Buffer.from(
      data.embedding instanceof Float32Array
        ? data.embedding.buffer
        : new Float32Array(data.embedding).buffer
    );

    this.db.prepare(`
      INSERT OR REPLACE INTO image_embeddings
      (id, image_analysis_id, embedding, model, dimensions, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      data.image_analysis_id,
      embeddingBuffer,
      data.model,
      data.dimensions,
      Date.now()
    );

    // Also insert into vec table if available
    if (this.vecLoaded) {
      const analysis = this.db.prepare('SELECT source FROM image_analysis WHERE id = ?')
        .get(data.image_analysis_id) as { source: string } | undefined;

      if (analysis) {
        this.db.prepare(`
          INSERT OR REPLACE INTO vec_image_embeddings (id, image_analysis_id, source, embedding)
          VALUES (?, ?, ?, ?)
        `).run(data.id, data.image_analysis_id, analysis.source, embeddingBuffer);
      }
    }
  }

  searchImagesByVector(
    queryEmbedding: Float32Array | number[],
    options?: { limit?: number; source?: string }
  ): Array<{
    id: string;
    file_path: string;
    description: string | null;
    categories: string[];
    source: string;
    similarity: number;
  }> {
    if (!this.vecLoaded) {
      console.warn('Vector search not available - sqlite-vec not loaded');
      return [];
    }

    const limit = options?.limit || 20;
    const embeddingBuffer = Buffer.from(
      queryEmbedding instanceof Float32Array
        ? queryEmbedding.buffer
        : new Float32Array(queryEmbedding).buffer
    );

    let sql = `
      SELECT v.image_analysis_id, v.distance,
             ia.id, ia.file_path, ia.description, ia.categories, ia.source
      FROM vec_image_embeddings v
      JOIN image_analysis ia ON ia.id = v.image_analysis_id
      WHERE v.embedding MATCH ?
    `;

    const params: (Buffer | string | number)[] = [embeddingBuffer];

    if (options?.source) {
      sql += ` AND v.source = ?`;
      params.push(options.source);
    }

    sql += ` ORDER BY v.distance LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      file_path: row.file_path as string,
      description: row.description as string | null,
      categories: row.categories ? JSON.parse(row.categories as string) : [],
      source: row.source as string,
      similarity: 1 - (row.distance as number), // Convert distance to similarity
    }));
  }

  // ===========================================================================
  // Image Description Embedding Operations (Text embeddings for semantic search)
  // ===========================================================================

  insertImageDescriptionEmbedding(data: {
    id: string;
    imageAnalysisId: string;
    text: string;
    embedding: Float32Array | number[];
  }): void {
    const embeddingBuffer = Buffer.from(
      data.embedding instanceof Float32Array
        ? data.embedding.buffer
        : new Float32Array(data.embedding).buffer
    );

    this.db.prepare(`
      INSERT OR REPLACE INTO image_description_embeddings
      (id, image_analysis_id, text, embedding, model, dimensions, created_at)
      VALUES (?, ?, ?, ?, 'nomic-embed-text', ?, ?)
    `).run(
      data.id,
      data.imageAnalysisId,
      data.text,
      embeddingBuffer,
      EMBEDDING_DIM,
      Date.now() / 1000
    );

    // Also insert into vec table if available
    if (this.vecLoaded) {
      const analysis = this.db.prepare('SELECT source FROM image_analysis WHERE id = ?')
        .get(data.imageAnalysisId) as { source: string } | undefined;

      if (analysis) {
        this.db.prepare(`
          INSERT OR REPLACE INTO vec_image_descriptions (id, image_analysis_id, source, embedding)
          VALUES (?, ?, ?, ?)
        `).run(data.id, data.imageAnalysisId, analysis.source, embeddingBuffer);
      }
    }
  }

  searchImageDescriptionsByVector(
    queryEmbedding: Float32Array | number[],
    options?: { limit?: number; source?: string }
  ): Array<{
    id: string;
    imageAnalysisId: string;
    filePath: string;
    description: string;
    source: string;
    similarity: number;
  }> {
    if (!this.vecLoaded) {
      console.warn('[FacebookOperations] Vector search not available - sqlite-vec not loaded');
      return [];
    }

    const limit = options?.limit || 20;
    const embeddingBuffer = Buffer.from(
      queryEmbedding instanceof Float32Array
        ? queryEmbedding.buffer
        : new Float32Array(queryEmbedding).buffer
    );

    let sql = `
      SELECT v.id, v.image_analysis_id, v.distance,
             ia.file_path, ia.description, ia.source
      FROM vec_image_descriptions v
      JOIN image_analysis ia ON ia.id = v.image_analysis_id
      WHERE v.embedding MATCH ?
    `;

    const params: (Buffer | string | number)[] = [embeddingBuffer];

    if (options?.source) {
      sql += ` AND v.source = ?`;
      params.push(options.source);
    }

    sql += ` ORDER BY v.distance LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      imageAnalysisId: row.image_analysis_id as string,
      filePath: row.file_path as string,
      description: (row.description as string) || '',
      source: row.source as string,
      similarity: 1 - (row.distance as number), // Convert distance to similarity
    }));
  }

  getImageAnalysesWithoutDescriptionEmbeddings(limit: number = 100): Array<{
    id: string;
    description: string;
    source: string;
  }> {
    return this.db.prepare(`
      SELECT ia.id, ia.description, ia.source
      FROM image_analysis ia
      LEFT JOIN image_description_embeddings ide ON ide.image_analysis_id = ia.id
      WHERE ia.description IS NOT NULL
        AND ia.description != ''
        AND ide.id IS NULL
      LIMIT ?
    `).all(limit) as Array<{ id: string; description: string; source: string }>;
  }

  getImageDescriptionEmbeddingCount(): number {
    const result = this.db.prepare(
      'SELECT COUNT(*) as count FROM image_description_embeddings'
    ).get() as { count: number };
    return result.count;
  }

  getUnanalyzedImages(options?: { source?: string; limit?: number }): Array<{
    id: string;
    file_path: string;
    content_item_id: string | null;
  }> {
    const limit = options?.limit || 1000;
    let sql = `
      SELECT mf.id, mf.file_path, mf.content_item_id
      FROM media_files mf
      LEFT JOIN image_analysis ia ON ia.file_path = mf.file_path
      WHERE ia.id IS NULL
        AND mf.type IN ('photo', 'image')
    `;

    const params: (string | number)[] = [];

    if (options?.source) {
      sql += ` AND mf.file_path LIKE ?`;
      params.push(`%${options.source}%`);
    }

    sql += ` LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as Array<{
      id: string;
      file_path: string;
      content_item_id: string | null;
    }>;
  }

  getImageAnalysisStats(): {
    total: number;
    bySource: Record<string, number>;
    byScene: Record<string, number>;
    byMood: Record<string, number>;
  } {
    // Count all analyzed images
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM image_analysis').get() as { count: number }).count;

    const bySourceRows = this.db.prepare(`
      SELECT source, COUNT(*) as count FROM image_analysis GROUP BY source
    `).all() as Array<{ source: string; count: number }>;

    const bySource: Record<string, number> = {};
    for (const row of bySourceRows) {
      bySource[row.source] = row.count;
    }

    const bySceneRows = this.db.prepare(`
      SELECT scene, COUNT(*) as count FROM image_analysis WHERE scene IS NOT NULL GROUP BY scene
    `).all() as Array<{ scene: string; count: number }>;

    const byScene: Record<string, number> = {};
    for (const row of bySceneRows) {
      byScene[row.scene] = row.count;
    }

    const byMoodRows = this.db.prepare(`
      SELECT mood, COUNT(*) as count FROM image_analysis WHERE mood IS NOT NULL GROUP BY mood
    `).all() as Array<{ mood: string; count: number }>;

    const byMood: Record<string, number> = {};
    for (const row of byMoodRows) {
      byMood[row.mood] = row.count;
    }

    return { total, bySource, byScene, byMood };
  }

  // ===========================================================================
  // Image Cluster Operations
  // ===========================================================================

  upsertImageCluster(cluster: {
    id: string;
    cluster_index: number;
    name?: string;
    description?: string;
    representative_image_id?: string;
    image_count: number;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO image_clusters
      (id, cluster_index, name, description, representative_image_id, image_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        representative_image_id = excluded.representative_image_id,
        image_count = excluded.image_count,
        updated_at = excluded.updated_at
    `).run(
      cluster.id,
      cluster.cluster_index,
      cluster.name || null,
      cluster.description || null,
      cluster.representative_image_id || null,
      cluster.image_count,
      now,
      now
    );
  }

  addImageToCluster(clusterId: string, imageAnalysisId: string, distance: number, isRepresentative = false): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO image_cluster_members
      (cluster_id, image_analysis_id, distance_to_center, is_representative)
      VALUES (?, ?, ?, ?)
    `).run(clusterId, imageAnalysisId, distance, isRepresentative ? 1 : 0);
  }

  getImageClusters(): Array<{
    id: string;
    cluster_index: number;
    name: string | null;
    description: string | null;
    image_count: number;
    representative: { id: string; file_path: string; description: string | null } | null;
  }> {
    const rows = this.db.prepare(`
      SELECT c.*, ia.file_path as rep_path, ia.description as rep_desc
      FROM image_clusters c
      LEFT JOIN image_analysis ia ON ia.id = c.representative_image_id
      ORDER BY c.image_count DESC
    `).all() as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      cluster_index: row.cluster_index as number,
      name: row.name as string | null,
      description: row.description as string | null,
      image_count: row.image_count as number,
      representative: row.representative_image_id ? {
        id: row.representative_image_id as string,
        file_path: row.rep_path as string,
        description: row.rep_desc as string | null,
      } : null,
    }));
  }

  getClusterImages(clusterId: string): Array<{
    id: string;
    file_path: string;
    description: string | null;
    categories: string[];
    distance: number;
    is_representative: boolean;
  }> {
    const rows = this.db.prepare(`
      SELECT ia.id, ia.file_path, ia.description, ia.categories,
             cm.distance_to_center as distance, cm.is_representative
      FROM image_cluster_members cm
      JOIN image_analysis ia ON ia.id = cm.image_analysis_id
      WHERE cm.cluster_id = ?
      ORDER BY cm.distance_to_center ASC
    `).all(clusterId) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      file_path: row.file_path as string,
      description: row.description as string | null,
      categories: row.categories ? JSON.parse(row.categories as string) : [],
      distance: row.distance as number,
      is_representative: row.is_representative === 1,
    }));
  }

  clearImageClusters(): void {
    this.db.exec(`
      DELETE FROM image_cluster_members;
      DELETE FROM image_clusters;
    `);
  }
}

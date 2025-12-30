/**
 * Explorer Agent
 *
 * The format discovery specialist. Explores unknown file structures,
 * formulates hypotheses about data formats, and learns from user feedback.
 *
 * Concerns:
 * - Folder structure exploration and mapping
 * - File format detection and hypothesis generation
 * - Interactive discovery through user queries
 * - Pattern learning and persistence
 * - Parser generation recommendations
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { AgentBase } from '../runtime/agent-base';
import type { AgentMessage, HouseType } from '../runtime/types';

// ═══════════════════════════════════════════════════════════════════
// EXPLORER TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Structure insight from folder exploration
 */
export interface StructureInsight {
  path: string;
  type: 'folder' | 'file';
  name: string;
  children?: StructureInsight[];
  fileCount?: number;
  folderCount?: number;
  sizeBytes?: number;

  // For files
  extension?: string;
  mimeType?: string;

  // Pattern detection
  patterns?: DetectedPattern[];
}

/**
 * Detected pattern in the structure
 */
export interface DetectedPattern {
  type: 'naming' | 'nesting' | 'content' | 'meta';
  pattern: string;
  confidence: number;
  examples: string[];
  description: string;
}

/**
 * Format hypothesis generated from exploration
 */
export interface FormatHypothesis {
  id: string;
  formatName: string;
  confidence: number;
  source: 'known' | 'inferred' | 'user-confirmed';

  // Evidence
  evidence: Array<{
    type: 'file-pattern' | 'folder-structure' | 'content-sample' | 'user-input';
    description: string;
    weight: number;
  }>;

  // Related known formats
  similarTo?: string[];

  // Recommended parser
  parserRecommendation?: {
    useExisting?: string;
    createNew?: boolean;
    modifications?: string[];
  };
}

/**
 * Sample from probing a file
 */
export interface ProbeSample {
  path: string;
  success: boolean;
  content?: unknown;
  structure?: Record<string, unknown>;
  error?: string;

  // For JSON/structured data
  keys?: string[];
  arrayLength?: number;
  sampleValues?: Record<string, unknown>;
}

/**
 * User query for clarification
 */
export interface UserQuery {
  id: string;
  question: string;
  options?: string[];
  context?: string;
  response?: string;
  respondedAt?: number;
}

/**
 * Learned format pattern
 */
export interface LearnedFormat {
  id: string;
  name: string;
  description: string;

  // Detection signatures
  signatures: Array<{
    type: 'folder-name' | 'file-pattern' | 'json-structure' | 'content-marker';
    pattern: string;
    required: boolean;
  }>;

  // Parser mapping
  parserName: string;
  parserConfig?: Record<string, unknown>;

  // Learning metadata
  learnedAt: number;
  confirmedByUser: boolean;
  successfulImports: number;
}

/**
 * Discovery session state
 */
export interface DiscoverySession {
  id: string;
  sourcePath: string;
  startedAt: number;

  // Exploration results
  structure?: StructureInsight;
  samples: ProbeSample[];

  // Hypotheses
  hypotheses: FormatHypothesis[];
  selectedHypothesis?: string;

  // User interaction
  queries: UserQuery[];

  // Final result
  status: 'exploring' | 'awaiting-input' | 'confirmed' | 'failed';
  result?: {
    formatName: string;
    parser: string;
    config?: Record<string, unknown>;
  };
}

// ═══════════════════════════════════════════════════════════════════
// KNOWN FORMAT SIGNATURES
// ═══════════════════════════════════════════════════════════════════

const KNOWN_FORMATS: Array<{
  name: string;
  signatures: Array<{
    type: 'folder' | 'file' | 'json-key' | 'json-structure';
    pattern: string | RegExp;
    weight: number;
  }>;
  parser: string;
  description: string;
}> = [
  {
    name: 'instagram-export',
    signatures: [
      { type: 'folder', pattern: 'your_instagram_activity', weight: 0.9 },
      { type: 'folder', pattern: /messages\/(inbox|message_requests)/, weight: 0.8 },
      { type: 'file', pattern: /message_\d+\.json$/, weight: 0.7 },
      { type: 'json-key', pattern: 'participants', weight: 0.5 },
      { type: 'json-key', pattern: 'sender_name', weight: 0.6 },
    ],
    parser: 'instagram', // or 'facebook' if reusing
    description: 'Instagram data export from Meta',
  },
  {
    name: 'facebook-export',
    signatures: [
      { type: 'folder', pattern: 'messages/inbox', weight: 0.9 },
      { type: 'folder', pattern: 'posts', weight: 0.6 },
      { type: 'file', pattern: /message_\d+\.json$/, weight: 0.7 },
      { type: 'json-key', pattern: 'participants', weight: 0.5 },
      { type: 'json-key', pattern: 'sender_name', weight: 0.6 },
    ],
    parser: 'facebook',
    description: 'Facebook data export',
  },
  {
    name: 'openai-export',
    signatures: [
      { type: 'file', pattern: 'conversations.json', weight: 0.9 },
      { type: 'json-key', pattern: 'mapping', weight: 0.9 },
      { type: 'json-key', pattern: 'current_node', weight: 0.7 },
    ],
    parser: 'openai',
    description: 'ChatGPT data export',
  },
  {
    name: 'gemini-export',
    signatures: [
      { type: 'json-key', pattern: 'source', weight: 0.5 },
      { type: 'json-structure', pattern: 'source:Gemini', weight: 0.95 },
      { type: 'json-structure', pattern: 'content.parts', weight: 0.8 },
      { type: 'json-key', pattern: 'role:model', weight: 0.7 },
    ],
    parser: 'gemini',
    description: 'Google Gemini conversation export',
  },
  {
    name: 'claude-export',
    signatures: [
      { type: 'file', pattern: 'conversations.json', weight: 0.5 },
      { type: 'file', pattern: 'users.json', weight: 0.8 },
      { type: 'json-key', pattern: 'chat_messages', weight: 0.9 },
      { type: 'json-key', pattern: 'uuid', weight: 0.5 },
    ],
    parser: 'claude',
    description: 'Claude data export',
  },
];

// ═══════════════════════════════════════════════════════════════════
// EXPLORER AGENT
// ═══════════════════════════════════════════════════════════════════

export class ExplorerAgent extends AgentBase {
  readonly id = 'explorer';
  readonly name = 'The Explorer';
  readonly house: HouseType = 'explorer';
  readonly capabilities = [
    'explore-structure',
    'detect-format',
    'probe-file',
    'query-user',
    'learn-format',
    'recommend-parser',
  ];

  // Active discovery sessions
  private sessions: Map<string, DiscoverySession> = new Map();

  // Learned formats from user confirmations
  private learnedFormats: LearnedFormat[] = [];

  // ─────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────────

  protected async onInitialize(): Promise<void> {
    this.log('info', 'Explorer awakening - ready to discover new formats');

    // Subscribe to import events
    this.subscribe('import:unknown-format');
    this.subscribe('import:discovery-request');

    // Load learned formats from state store
    await this.loadLearnedFormats();
  }

  protected async onShutdown(): Promise<void> {
    this.log('info', 'Explorer retiring - saving learned patterns');
    await this.saveLearnedFormats();
  }

  // ─────────────────────────────────────────────────────────────────
  // MESSAGE HANDLING
  // ─────────────────────────────────────────────────────────────────

  protected async onMessage(message: AgentMessage): Promise<unknown> {
    switch (message.type) {
      case 'explore-structure':
        return this.exploreStructure(message.payload as ExploreRequest);

      case 'detect-format':
        return this.detectFormat(message.payload as DetectRequest);

      case 'probe-file':
        return this.probeFile(message.payload as ProbeRequest);

      case 'user-response':
        return this.handleUserResponse(message.payload as UserResponsePayload);

      case 'confirm-format':
        return this.confirmFormat(message.payload as ConfirmFormatPayload);

      case 'start-discovery':
        return this.startDiscoverySession(message.payload as StartDiscoveryRequest);

      case 'get-session':
        return this.getSession(message.payload as { sessionId: string });

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // STRUCTURE EXPLORATION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Explore a folder structure recursively
   */
  async exploreStructure(request: ExploreRequest): Promise<StructureInsight> {
    const { path: sourcePath, maxDepth = 3, maxFiles = 100 } = request;

    if (!existsSync(sourcePath)) {
      throw new Error(`Path not found: ${sourcePath}`);
    }

    const stats = await fs.stat(sourcePath);

    if (stats.isFile()) {
      return this.analyzeFile(sourcePath);
    }

    return this.exploreFolder(sourcePath, 0, maxDepth, { count: 0, max: maxFiles });
  }

  private async exploreFolder(
    folderPath: string,
    currentDepth: number,
    maxDepth: number,
    fileCounter: { count: number; max: number }
  ): Promise<StructureInsight> {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const children: StructureInsight[] = [];
    let fileCount = 0;
    let folderCount = 0;

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith('.')) continue;

      const entryPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        folderCount++;
        if (currentDepth < maxDepth) {
          const childInsight = await this.exploreFolder(
            entryPath,
            currentDepth + 1,
            maxDepth,
            fileCounter
          );
          children.push(childInsight);
        } else {
          // Just count without recursing
          children.push({
            path: entryPath,
            type: 'folder',
            name: entry.name,
          });
        }
      } else if (entry.isFile()) {
        fileCount++;
        fileCounter.count++;

        if (fileCounter.count <= fileCounter.max) {
          children.push(await this.analyzeFile(entryPath));
        }
      }
    }

    // Detect patterns in this folder
    const patterns = this.detectPatterns(children);

    return {
      path: folderPath,
      type: 'folder',
      name: path.basename(folderPath),
      children,
      fileCount,
      folderCount,
      patterns,
    };
  }

  private async analyzeFile(filePath: string): Promise<StructureInsight> {
    const ext = path.extname(filePath).toLowerCase();
    const stats = await fs.stat(filePath);

    return {
      path: filePath,
      type: 'file',
      name: path.basename(filePath),
      extension: ext,
      sizeBytes: stats.size,
      mimeType: this.guessMimeType(ext),
    };
  }

  private guessMimeType(ext: string): string {
    const mimeMap: Record<string, string> = {
      '.json': 'application/json',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.html': 'text/html',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.pdf': 'application/pdf',
    };
    return mimeMap[ext] || 'application/octet-stream';
  }

  // ─────────────────────────────────────────────────────────────────
  // PATTERN DETECTION
  // ─────────────────────────────────────────────────────────────────

  private detectPatterns(children: StructureInsight[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Detect naming patterns
    const fileNames = children.filter(c => c.type === 'file').map(c => c.name);
    const folderNames = children.filter(c => c.type === 'folder').map(c => c.name);

    // Check for numbered sequences (message_1.json, message_2.json, etc.)
    const numberedPattern = /^(.+?)_?(\d+)(\.[^.]+)?$/;
    const numberedFiles = fileNames.filter(n => numberedPattern.test(n));
    if (numberedFiles.length > 1) {
      patterns.push({
        type: 'naming',
        pattern: 'numbered-sequence',
        confidence: Math.min(numberedFiles.length / fileNames.length, 1),
        examples: numberedFiles.slice(0, 3),
        description: 'Files with numbered sequences (e.g., message_1.json)',
      });
    }

    // Check for common folder patterns
    const knownFolders = ['inbox', 'messages', 'media', 'posts', 'photos', 'videos'];
    const matchedFolders = folderNames.filter(n =>
      knownFolders.some(kf => n.toLowerCase().includes(kf))
    );
    if (matchedFolders.length > 0) {
      patterns.push({
        type: 'nesting',
        pattern: 'social-media-export',
        confidence: matchedFolders.length / knownFolders.length,
        examples: matchedFolders,
        description: 'Folder structure typical of social media exports',
      });
    }

    return patterns;
  }

  // ─────────────────────────────────────────────────────────────────
  // FORMAT DETECTION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Detect the format of a source path
   */
  async detectFormat(request: DetectRequest): Promise<FormatHypothesis[]> {
    const { path: sourcePath } = request;

    // Explore structure first
    const structure = await this.exploreStructure({ path: sourcePath, maxDepth: 2, maxFiles: 50 });

    const hypotheses: FormatHypothesis[] = [];

    // Check against known formats
    for (const known of KNOWN_FORMATS) {
      const evidence: FormatHypothesis['evidence'] = [];
      let totalWeight = 0;
      let matchedWeight = 0;

      for (const sig of known.signatures) {
        totalWeight += sig.weight;
        const matched = await this.checkSignature(structure, sig, sourcePath);
        if (matched) {
          matchedWeight += sig.weight;
          evidence.push({
            type: sig.type === 'folder' || sig.type === 'file' ? 'folder-structure' : 'content-sample',
            description: `Matched ${sig.type}: ${sig.pattern}`,
            weight: sig.weight,
          });
        }
      }

      const confidence = matchedWeight / totalWeight;
      if (confidence > 0.3) {
        hypotheses.push({
          id: `hyp-${known.name}-${Date.now()}`,
          formatName: known.name,
          confidence,
          source: 'known',
          evidence,
          parserRecommendation: {
            useExisting: known.parser,
          },
        });
      }
    }

    // Check learned formats
    for (const learned of this.learnedFormats) {
      const matched = await this.checkLearnedFormat(structure, learned, sourcePath);
      if (matched > 0.3) {
        hypotheses.push({
          id: `hyp-learned-${learned.id}`,
          formatName: learned.name,
          confidence: matched,
          source: 'inferred',
          evidence: [{
            type: 'content-sample',
            description: `Matched learned format: ${learned.description}`,
            weight: matched,
          }],
          parserRecommendation: {
            useExisting: learned.parserName,
            modifications: learned.parserConfig ? ['Apply custom config'] : undefined,
          },
        });
      }
    }

    // Sort by confidence
    hypotheses.sort((a, b) => b.confidence - a.confidence);

    return hypotheses;
  }

  private async checkSignature(
    structure: StructureInsight,
    signature: { type: string; pattern: string | RegExp; weight: number },
    rootPath: string
  ): Promise<boolean> {
    const patternStr = signature.pattern instanceof RegExp
      ? signature.pattern.source
      : signature.pattern;

    switch (signature.type) {
      case 'folder': {
        return this.findInStructure(structure, 'folder', patternStr);
      }
      case 'file': {
        return this.findInStructure(structure, 'file', patternStr);
      }
      case 'json-key': {
        // Need to probe a JSON file
        const jsonFiles = this.collectFiles(structure, '.json').slice(0, 5);
        for (const file of jsonFiles) {
          const probe = await this.probeFile({ path: file.path, parseJson: true });
          if (probe.success && probe.keys?.includes(patternStr)) {
            return true;
          }
        }
        return false;
      }
      case 'json-structure': {
        // Check for specific structure like "source:Gemini"
        const [key, value] = patternStr.split(':');
        const jsonFiles = this.collectFiles(structure, '.json').slice(0, 5);
        for (const file of jsonFiles) {
          const probe = await this.probeFile({ path: file.path, parseJson: true });
          if (probe.success && probe.sampleValues?.[key] === value) {
            return true;
          }
        }
        return false;
      }
      default:
        return false;
    }
  }

  private findInStructure(
    structure: StructureInsight,
    type: 'folder' | 'file',
    pattern: string
  ): boolean {
    const regex = new RegExp(pattern);

    const search = (node: StructureInsight): boolean => {
      if (node.type === type && regex.test(node.path)) {
        return true;
      }
      if (node.children) {
        return node.children.some(search);
      }
      return false;
    };

    return search(structure);
  }

  private collectFiles(structure: StructureInsight, extension?: string): StructureInsight[] {
    const files: StructureInsight[] = [];

    const collect = (node: StructureInsight) => {
      if (node.type === 'file') {
        if (!extension || node.extension === extension) {
          files.push(node);
        }
      }
      if (node.children) {
        node.children.forEach(collect);
      }
    };

    collect(structure);
    return files;
  }

  private async checkLearnedFormat(
    structure: StructureInsight,
    format: LearnedFormat,
    rootPath: string
  ): Promise<number> {
    let matched = 0;
    let required = 0;

    for (const sig of format.signatures) {
      if (sig.required) required++;

      let found = false;
      switch (sig.type) {
        case 'folder-name':
          found = this.findInStructure(structure, 'folder', sig.pattern);
          break;
        case 'file-pattern':
          found = this.findInStructure(structure, 'file', sig.pattern);
          break;
        case 'json-structure':
        case 'content-marker':
          const jsonFiles = this.collectFiles(structure, '.json').slice(0, 3);
          for (const file of jsonFiles) {
            const probe = await this.probeFile({ path: file.path, parseJson: true });
            if (probe.success && probe.keys?.some(k => k.includes(sig.pattern))) {
              found = true;
              break;
            }
          }
          break;
      }

      if (found) matched++;
    }

    return format.signatures.length > 0 ? matched / format.signatures.length : 0;
  }

  // ─────────────────────────────────────────────────────────────────
  // FILE PROBING
  // ─────────────────────────────────────────────────────────────────

  /**
   * Probe a file to understand its structure
   */
  async probeFile(request: ProbeRequest): Promise<ProbeSample> {
    const { path: filePath, parseJson = true, sampleSize = 5000 } = request;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const sample = content.substring(0, sampleSize);

      if (parseJson && (filePath.endsWith('.json') || sample.trim().startsWith('{'))) {
        try {
          const data = JSON.parse(content);
          return {
            path: filePath,
            success: true,
            content: data,
            keys: this.extractKeys(data),
            arrayLength: Array.isArray(data) ? data.length : undefined,
            sampleValues: this.extractSampleValues(data),
          };
        } catch {
          return {
            path: filePath,
            success: true,
            content: sample,
            error: 'JSON parse failed - treating as text',
          };
        }
      }

      return {
        path: filePath,
        success: true,
        content: sample,
      };
    } catch (err) {
      return {
        path: filePath,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private extractKeys(data: unknown, prefix = '', depth = 0): string[] {
    if (depth > 3) return [];
    const keys: string[] = [];

    if (Array.isArray(data)) {
      if (data.length > 0) {
        keys.push(...this.extractKeys(data[0], prefix + '[]', depth + 1));
      }
    } else if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        keys.push(fullKey);
        keys.push(...this.extractKeys(value, fullKey, depth + 1));
      }
    }

    return keys;
  }

  private extractSampleValues(data: unknown): Record<string, unknown> {
    const samples: Record<string, unknown> = {};

    if (Array.isArray(data) && data.length > 0) {
      return this.extractSampleValues(data[0]);
    }

    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          samples[key] = value;
        } else if (Array.isArray(value)) {
          samples[key] = `[array of ${value.length}]`;
        } else if (value && typeof value === 'object') {
          samples[key] = `{object}`;
        }
        if (Object.keys(samples).length >= 10) break;
      }
    }

    return samples;
  }

  // ─────────────────────────────────────────────────────────────────
  // DISCOVERY SESSION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Start an interactive discovery session
   */
  async startDiscoverySession(request: StartDiscoveryRequest): Promise<DiscoverySession> {
    const sessionId = `discovery-${Date.now()}`;

    const session: DiscoverySession = {
      id: sessionId,
      sourcePath: request.path,
      startedAt: Date.now(),
      samples: [],
      hypotheses: [],
      queries: [],
      status: 'exploring',
    };

    this.sessions.set(sessionId, session);

    // Start exploration
    this.log('info', `Starting discovery session for: ${request.path}`);

    try {
      // Explore structure
      session.structure = await this.exploreStructure({
        path: request.path,
        maxDepth: 3,
        maxFiles: 100,
      });

      // Detect format
      session.hypotheses = await this.detectFormat({ path: request.path });

      // Determine next step
      if (session.hypotheses.length > 0 && session.hypotheses[0].confidence > 0.8) {
        // High confidence - propose confirmation
        session.status = 'awaiting-input';

        const topHypothesis = session.hypotheses[0];
        session.queries.push({
          id: `query-${Date.now()}`,
          question: `This looks like a ${topHypothesis.formatName} export. Is that correct?`,
          options: ['Yes', 'No, it\'s something else', 'I\'m not sure'],
          context: `Confidence: ${(topHypothesis.confidence * 100).toFixed(0)}%`,
        });

        // Publish for UI
        this.publish('explorer:query', {
          sessionId,
          query: session.queries[session.queries.length - 1],
        });

      } else if (session.hypotheses.length > 0) {
        // Medium confidence - ask for clarification
        session.status = 'awaiting-input';

        session.queries.push({
          id: `query-${Date.now()}`,
          question: 'What type of export is this?',
          options: session.hypotheses.map(h => h.formatName).slice(0, 4),
          context: 'I detected multiple possible formats.',
        });

        this.publish('explorer:query', {
          sessionId,
          query: session.queries[session.queries.length - 1],
        });

      } else {
        // Unknown format - ask user
        session.status = 'awaiting-input';

        session.queries.push({
          id: `query-${Date.now()}`,
          question: 'I don\'t recognize this format. What application or service created this export?',
          context: this.describeStructure(session.structure),
        });

        this.publish('explorer:query', {
          sessionId,
          query: session.queries[session.queries.length - 1],
        });
      }

    } catch (err) {
      session.status = 'failed';
      this.log('error', `Discovery failed: ${err}`);
    }

    return session;
  }

  private describeStructure(structure: StructureInsight): string {
    const parts: string[] = [];

    if (structure.folderCount) {
      parts.push(`${structure.folderCount} folders`);
    }
    if (structure.fileCount) {
      parts.push(`${structure.fileCount} files`);
    }
    if (structure.children) {
      const topFolders = structure.children
        .filter(c => c.type === 'folder')
        .slice(0, 5)
        .map(c => c.name);
      if (topFolders.length > 0) {
        parts.push(`Top folders: ${topFolders.join(', ')}`);
      }
    }

    return parts.join(' | ');
  }

  /**
   * Handle user response to a query
   */
  async handleUserResponse(payload: UserResponsePayload): Promise<DiscoverySession> {
    const session = this.sessions.get(payload.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${payload.sessionId}`);
    }

    // Update the query with response
    const query = session.queries.find(q => q.id === payload.queryId);
    if (query) {
      query.response = payload.response;
      query.respondedAt = Date.now();
    }

    // Process response
    if (payload.response === 'Yes' && session.hypotheses.length > 0) {
      // User confirmed top hypothesis
      const confirmed = session.hypotheses[0];
      session.selectedHypothesis = confirmed.id;
      session.status = 'confirmed';
      session.result = {
        formatName: confirmed.formatName,
        parser: confirmed.parserRecommendation?.useExisting || 'unknown',
      };

      // Learn from this confirmation
      await this.learnFromConfirmation(session, confirmed);

    } else if (session.hypotheses.some(h => h.formatName === payload.response)) {
      // User selected a specific format
      const selected = session.hypotheses.find(h => h.formatName === payload.response)!;
      session.selectedHypothesis = selected.id;
      session.status = 'confirmed';
      session.result = {
        formatName: selected.formatName,
        parser: selected.parserRecommendation?.useExisting || 'unknown',
      };

      await this.learnFromConfirmation(session, selected);

    } else {
      // User provided custom response - need to learn new format
      session.queries.push({
        id: `query-${Date.now()}`,
        question: `What would you call this format? (e.g., "twitter-export", "whatsapp-backup")`,
        context: `You said: "${payload.response}"`,
      });

      this.publish('explorer:query', {
        sessionId: session.id,
        query: session.queries[session.queries.length - 1],
      });
    }

    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(payload: { sessionId: string }): DiscoverySession | undefined {
    return this.sessions.get(payload.sessionId);
  }

  /**
   * Confirm format and finalize session
   */
  async confirmFormat(payload: ConfirmFormatPayload): Promise<DiscoverySession> {
    const session = this.sessions.get(payload.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${payload.sessionId}`);
    }

    session.status = 'confirmed';
    session.result = {
      formatName: payload.formatName,
      parser: payload.parser,
      config: payload.config,
    };

    // Publish result
    this.publish('explorer:format-confirmed', {
      sessionId: session.id,
      result: session.result,
    });

    return session;
  }

  // ─────────────────────────────────────────────────────────────────
  // LEARNING
  // ─────────────────────────────────────────────────────────────────

  private async learnFromConfirmation(session: DiscoverySession, hypothesis: FormatHypothesis): Promise<void> {
    // Check if we already know this format
    const existing = this.learnedFormats.find(f => f.name === hypothesis.formatName);
    if (existing) {
      existing.successfulImports++;
      return;
    }

    // Create new learned format
    const learned: LearnedFormat = {
      id: `learned-${Date.now()}`,
      name: hypothesis.formatName,
      description: `Learned from ${session.sourcePath}`,
      signatures: [],
      parserName: hypothesis.parserRecommendation?.useExisting || 'unknown',
      learnedAt: Date.now(),
      confirmedByUser: true,
      successfulImports: 1,
    };

    // Extract signatures from the structure
    if (session.structure) {
      const topFolders = session.structure.children
        ?.filter(c => c.type === 'folder')
        .slice(0, 3) || [];

      for (const folder of topFolders) {
        learned.signatures.push({
          type: 'folder-name',
          pattern: folder.name,
          required: false,
        });
      }

      // Look for distinctive file patterns
      const jsonFiles = this.collectFiles(session.structure, '.json');
      const distinctivePattern = this.findDistinctiveFilePattern(jsonFiles.map(f => f.name));
      if (distinctivePattern) {
        learned.signatures.push({
          type: 'file-pattern',
          pattern: distinctivePattern,
          required: true,
        });
      }
    }

    this.learnedFormats.push(learned);
    this.log('info', `Learned new format: ${learned.name}`);
  }

  private findDistinctiveFilePattern(fileNames: string[]): string | null {
    // Look for common patterns like message_1.json, posts_1.json, etc.
    const patterns = new Map<string, number>();

    for (const name of fileNames) {
      const match = name.match(/^(.+?)_?\d+\.json$/);
      if (match) {
        const pattern = `${match[1]}_\\d+\\.json`;
        patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
      }
    }

    // Return the most common pattern
    let bestPattern: string | null = null;
    let bestCount = 0;

    patterns.forEach((count, pattern) => {
      if (count > bestCount) {
        bestCount = count;
        bestPattern = pattern;
      }
    });

    return bestPattern;
  }

  private async loadLearnedFormats(): Promise<void> {
    // In a full implementation, this would load from SQLite via agent store
    // For now, start with empty learned formats
    this.learnedFormats = [];
  }

  private async saveLearnedFormats(): Promise<void> {
    // In a full implementation, this would save to SQLite via agent store
    this.log('info', `Saved ${this.learnedFormats.length} learned formats`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// REQUEST TYPES
// ═══════════════════════════════════════════════════════════════════

interface ExploreRequest {
  path: string;
  maxDepth?: number;
  maxFiles?: number;
}

interface DetectRequest {
  path: string;
}

interface ProbeRequest {
  path: string;
  parseJson?: boolean;
  sampleSize?: number;
}

interface UserResponsePayload {
  sessionId: string;
  queryId: string;
  response: string;
}

interface ConfirmFormatPayload {
  sessionId: string;
  formatName: string;
  parser: string;
  config?: Record<string, unknown>;
}

interface StartDiscoveryRequest {
  path: string;
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════

let _explorer: ExplorerAgent | null = null;

export function getExplorerAgent(): ExplorerAgent {
  if (!_explorer) {
    _explorer = new ExplorerAgent();
  }
  return _explorer;
}

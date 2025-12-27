/**
 * WorkspacePin System
 *
 * Workspace pins are user-facing content references with rich metadata.
 * Unlike Buffer.pinned (which is about garbage collection), WorkspacePins
 * are for content organization and tool integration.
 *
 * Design Philosophy:
 * - Content lives in ContentGraph (immutable DAG)
 * - Buffers are navigation pointers with history
 * - WorkspacePins are semantic bookmarks with purpose and tool access
 *
 * This addresses:
 * - Item 9: Normalized content location (pins are the user-facing concept)
 * - Item 10: Rich pin metadata (label, purpose, tags, toolAccess)
 * - Item 11: Version/branch references (versionRef points to specific node)
 * - Item 12: Tool integration (resolvedContent for AUI context)
 */

import type { ContentNode, ContentItem } from './types';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface WorkspacePin {
  id: string;

  // Content reference
  nodeId: string;                    // Current node this pin references
  versionRef?: string;               // Specific version (node ID) if pinned at a point

  // User-facing metadata
  label: string;                     // Display name
  purpose?: string;                  // Why this was pinned (for organization)
  tags?: string[];                   // Categorization

  // Tool integration
  toolAccess?: string[];             // Which tools can see this pin (null = all)

  // Association with buffer (optional)
  bufferId?: string;                 // If created from a buffer's content

  // Timestamps
  createdAt: number;
  updatedAt: number;
}

/**
 * Resolved pin content for tool consumption
 */
export interface PinnedContent {
  pin: WorkspacePin;
  node: ContentNode | null;          // Resolved node (null if GC'd)
  text: string;                      // Extracted text for quick access
  wordCount: number;
}

/**
 * Event types for reactive updates
 */
export type PinEvent =
  | { type: 'pin-created'; pinId: string }
  | { type: 'pin-updated'; pinId: string }
  | { type: 'pin-deleted'; pinId: string }
  | { type: 'pins-cleared' };

// ═══════════════════════════════════════════════════════════════════
// ID GENERATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate collision-resistant pin ID
 * Uses crypto.randomUUID() when available, fallback for older environments
 */
function generatePinId(): string {
  // Use Web Crypto API for cryptographically secure random IDs
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `pin-${crypto.randomUUID()}`;
  }

  // Fallback for older environments - combines timestamp with random strings
  const timestamp = Date.now();
  const random1 = Math.random().toString(36).substring(2, 15);
  const random2 = Math.random().toString(36).substring(2, 15);
  return `pin-${timestamp}-${random1}${random2}`;
}

// ═══════════════════════════════════════════════════════════════════
// PIN MANAGER CLASS
// ═══════════════════════════════════════════════════════════════════

export class PinManager {
  private pins: Map<string, WorkspacePin> = new Map();
  private listeners: Set<(event: PinEvent) => void> = new Set();

  // Input validation limits (per Security/Math agent review)
  private static readonly MAX_PINS = 10000;
  private static readonly MAX_LABEL_LENGTH = 200;
  private static readonly MAX_PURPOSE_LENGTH = 500;
  private static readonly MAX_TAGS_PER_PIN = 50;
  private static readonly MAX_TAG_LENGTH = 50;

  // ─────────────────────────────────────────────────────────────────
  // EVENT SYSTEM
  // ─────────────────────────────────────────────────────────────────

  subscribe(listener: (event: PinEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: PinEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // PIN CRUD
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a new workspace pin
   * Validates and sanitizes input to prevent memory exhaustion
   */
  createPin(
    nodeId: string,
    label: string,
    options: {
      purpose?: string;
      tags?: string[];
      toolAccess?: string[];
      bufferId?: string;
      versionRef?: string;
    } = {}
  ): WorkspacePin {
    // Enforce max pins limit
    if (this.pins.size >= PinManager.MAX_PINS) {
      throw new Error(
        `Pin limit reached (${PinManager.MAX_PINS}). Delete unused pins to continue.`
      );
    }

    // Sanitize label (required, truncate if too long)
    const sanitizedLabel = label
      .substring(0, PinManager.MAX_LABEL_LENGTH)
      .trim();

    if (!sanitizedLabel) {
      throw new Error('Pin label cannot be empty');
    }

    // Sanitize optional purpose
    const sanitizedPurpose = options.purpose
      ?.substring(0, PinManager.MAX_PURPOSE_LENGTH)
      .trim() || undefined;

    // Sanitize tags (limit count and length per tag)
    const sanitizedTags = options.tags
      ?.slice(0, PinManager.MAX_TAGS_PER_PIN)
      .map(t => t.substring(0, PinManager.MAX_TAG_LENGTH).trim())
      .filter(t => t.length > 0);

    const id = generatePinId();
    const now = Date.now();

    const pin: WorkspacePin = {
      id,
      nodeId,
      label: sanitizedLabel,
      purpose: sanitizedPurpose,
      tags: sanitizedTags && sanitizedTags.length > 0 ? sanitizedTags : undefined,
      toolAccess: options.toolAccess,
      bufferId: options.bufferId,
      versionRef: options.versionRef,
      createdAt: now,
      updatedAt: now,
    };

    this.pins.set(id, pin);
    this.emit({ type: 'pin-created', pinId: id });

    return pin;
  }

  /**
   * Get a pin by ID
   */
  getPin(pinId: string): WorkspacePin | null {
    return this.pins.get(pinId) ?? null;
  }

  /**
   * Get all pins
   */
  getAllPins(): WorkspacePin[] {
    return Array.from(this.pins.values());
  }

  /**
   * Get pins by tag
   */
  getPinsByTag(tag: string): WorkspacePin[] {
    return this.getAllPins().filter(pin =>
      pin.tags?.includes(tag)
    );
  }

  /**
   * Get pins accessible to a specific tool
   */
  getPinsForTool(toolId: string): WorkspacePin[] {
    return this.getAllPins().filter(pin =>
      !pin.toolAccess || pin.toolAccess.includes(toolId)
    );
  }

  /**
   * Update a pin
   */
  updatePin(
    pinId: string,
    updates: Partial<Omit<WorkspacePin, 'id' | 'createdAt'>>
  ): boolean {
    const pin = this.pins.get(pinId);
    if (!pin) return false;

    this.pins.set(pinId, {
      ...pin,
      ...updates,
      updatedAt: Date.now(),
    });

    this.emit({ type: 'pin-updated', pinId });
    return true;
  }

  /**
   * Update the node reference (e.g., when navigating to a derived node)
   */
  updatePinNode(pinId: string, nodeId: string): boolean {
    return this.updatePin(pinId, { nodeId });
  }

  /**
   * Lock pin to current version (for version/branch support)
   */
  lockPinVersion(pinId: string): boolean {
    const pin = this.pins.get(pinId);
    if (!pin) return false;

    return this.updatePin(pinId, { versionRef: pin.nodeId });
  }

  /**
   * Unlock pin version (allow it to follow buffer navigation)
   */
  unlockPinVersion(pinId: string): boolean {
    return this.updatePin(pinId, { versionRef: undefined });
  }

  /**
   * Add tags to a pin
   */
  addTags(pinId: string, newTags: string[]): boolean {
    const pin = this.pins.get(pinId);
    if (!pin) return false;

    const existingTags = pin.tags ?? [];
    const uniqueTags = [...new Set([...existingTags, ...newTags])];

    return this.updatePin(pinId, { tags: uniqueTags });
  }

  /**
   * Remove tags from a pin
   */
  removeTags(pinId: string, tagsToRemove: string[]): boolean {
    const pin = this.pins.get(pinId);
    if (!pin) return false;

    const tags = (pin.tags ?? []).filter(t => !tagsToRemove.includes(t));
    return this.updatePin(pinId, { tags });
  }

  /**
   * Set tool access for a pin
   */
  setToolAccess(pinId: string, toolIds: string[] | null): boolean {
    return this.updatePin(pinId, {
      toolAccess: toolIds ?? undefined,
    });
  }

  /**
   * Delete a pin
   */
  deletePin(pinId: string): boolean {
    if (!this.pins.has(pinId)) return false;

    this.pins.delete(pinId);
    this.emit({ type: 'pin-deleted', pinId });
    return true;
  }

  /**
   * Clear all pins
   */
  clearAllPins(): void {
    this.pins.clear();
    this.emit({ type: 'pins-cleared' });
  }

  // ─────────────────────────────────────────────────────────────────
  // NODE ID COLLECTION (for garbage collection integration)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get all node IDs referenced by pins (for GC protection)
   */
  getPinnedNodeIds(): Set<string> {
    const nodeIds = new Set<string>();

    for (const pin of this.pins.values()) {
      nodeIds.add(pin.nodeId);
      if (pin.versionRef) {
        nodeIds.add(pin.versionRef);
      }
    }

    return nodeIds;
  }

  // ─────────────────────────────────────────────────────────────────
  // SERIALIZATION
  // ─────────────────────────────────────────────────────────────────

  toJSON(): Record<string, WorkspacePin> {
    const obj: Record<string, WorkspacePin> = {};
    for (const [id, pin] of this.pins) {
      obj[id] = pin;
    }
    return obj;
  }

  /**
   * Validate that data has required WorkspacePin fields
   */
  private static validatePin(data: unknown): data is WorkspacePin {
    if (!data || typeof data !== 'object') return false;
    const pin = data as Record<string, unknown>;

    // Required fields
    if (typeof pin.id !== 'string') return false;
    if (typeof pin.nodeId !== 'string') return false;
    if (typeof pin.label !== 'string') return false;
    if (typeof pin.createdAt !== 'number') return false;
    if (typeof pin.updatedAt !== 'number') return false;

    // Optional fields - validate type if present
    if (pin.tags !== undefined && !Array.isArray(pin.tags)) return false;
    if (pin.toolAccess !== undefined && !Array.isArray(pin.toolAccess)) return false;
    if (pin.purpose !== undefined && typeof pin.purpose !== 'string') return false;
    if (pin.bufferId !== undefined && typeof pin.bufferId !== 'string') return false;
    if (pin.versionRef !== undefined && typeof pin.versionRef !== 'string') return false;

    return true;
  }

  static fromJSON(data: Record<string, unknown>): PinManager {
    const manager = new PinManager();

    for (const [id, pinData] of Object.entries(data)) {
      if (!this.validatePin(pinData)) {
        console.warn(`Skipping invalid pin: ${id}`, pinData);
        continue; // Skip invalid entries instead of corrupting state
      }
      manager.pins.set(id, pinData);
    }

    return manager;
  }

  // ─────────────────────────────────────────────────────────────────
  // ORPHAN CLEANUP
  // ─────────────────────────────────────────────────────────────────

  /**
   * Remove pins that reference deleted nodes
   * Call this after ContentGraph garbage collection
   */
  cleanupOrphanedPins(validNodeIds: Set<string>): number {
    let cleaned = 0;

    for (const [id, pin] of this.pins) {
      // Check if nodeId still exists
      if (!validNodeIds.has(pin.nodeId)) {
        this.deletePin(id);
        cleaned++;
        continue;
      }

      // Check if versionRef still exists (unlock if not)
      if (pin.versionRef && !validNodeIds.has(pin.versionRef)) {
        this.unlockPinVersion(id);
      }
    }

    return cleaned;
  }

  // ─────────────────────────────────────────────────────────────────
  // DEBUG
  // ─────────────────────────────────────────────────────────────────

  getStats(): {
    pinCount: number;
    taggedCount: number;
    lockedVersionCount: number;
    toolRestrictedCount: number;
  } {
    let taggedCount = 0;
    let lockedVersionCount = 0;
    let toolRestrictedCount = 0;

    for (const pin of this.pins.values()) {
      if (pin.tags && pin.tags.length > 0) taggedCount++;
      if (pin.versionRef) lockedVersionCount++;
      if (pin.toolAccess && pin.toolAccess.length > 0) toolRestrictedCount++;
    }

    return {
      pinCount: this.pins.size,
      taggedCount,
      lockedVersionCount,
      toolRestrictedCount,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract text from content items
 */
function extractText(content: ContentItem | ContentItem[]): string {
  if (Array.isArray(content)) {
    return content.map(item => item.text).join('\n\n');
  }
  return content.text;
}

/**
 * Resolve a pin to its content
 */
export function resolvePinContent(
  pin: WorkspacePin,
  getNode: (nodeId: string) => ContentNode | null
): PinnedContent {
  // Use versionRef if locked, otherwise use current nodeId
  const targetNodeId = pin.versionRef ?? pin.nodeId;
  const node = getNode(targetNodeId);

  if (!node) {
    return {
      pin,
      node: null,
      text: '',
      wordCount: 0,
    };
  }

  const text = extractText(node.content);
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  return {
    pin,
    node,
    text,
    wordCount,
  };
}

/**
 * Resolve multiple pins for tool consumption
 */
export function resolveAllPins(
  pins: WorkspacePin[],
  getNode: (nodeId: string) => ContentNode | null
): PinnedContent[] {
  return pins.map(pin => resolvePinContent(pin, getNode));
}

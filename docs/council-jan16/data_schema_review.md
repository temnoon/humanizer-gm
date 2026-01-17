# BOOK STUDIO DATA SCHEMA REVIEW

**Data Agent Audit**  
**Date**: January 16, 2026  
**Scope**: Book Studio API (:3004), Archive Server (:3002), Frontend Types  
**Priority**: REQUIRED - Core system integrity

---

## EXECUTIVE SUMMARY

Book Studio will handle critical user data across multiple persistence layers. Current analysis reveals:

**CRITICAL ISSUES**:
1. Date field inconsistency across Archive/Book Studio/Frontend (Unix vs ISO)
2. Missing temporal metadata preservation (no "original creation date" vs "imported date")
3. Potential zero-date loss during archive/book transitions
4. Type duplication risk between sandbox and core packages
5. Unclear createdAt semantics (original vs import/harvest)

**VERDICT**: CONDITIONAL PASS with mandatory fixes before merge

---

## TEMPORAL INTEGRITY CRISIS

### The Problem: Multiple Date Interpretations

The system currently uses `createdAt` inconsistently:

```
Archive Result:
  createdAt: 1704067200 (Unix timestamp, original message created)
  
HarvestCard (from SearchResult):
  createdAt: 1704067200 (copied from Archive, semantic: "original")
  harvestedAt: 1705449600 (added by Book Studio, semantic: "when we grabbed it")
  
Book (from API design):
  created_at: "2026-01-16T12:34:56Z" (ISO string, semantic: "book created")
  
SearchResult:
  createdAt?: string | number (AMBIGUOUS - which date is this?)
```

**Problem**: No agreed semantics. Does `createdAt` mean:
- Original creation on platform?
- Export time from platform?
- Import into our system?
- Something else?

### The Zero-Date Problem

Export/import processes often lose dates or set them to epoch zero:

```javascript
// BAD - Zero dates hide real information
createdAt: 0 or null
createdAt: '1970-01-01T00:00:00Z'
createdAt: undefined

// We must detect and handle these
```

---

## DATA LAYERS & RESPONSIBILITIES

### Layer 1: Archive Server (:3002) - Authority for Original Dates

**Owns**:
- Conversations, messages, posts (raw archived content)
- Original creation timestamps from platforms
- Metadata about sources

**Contracts** (read-only from Book Studio):
```typescript
// archive-reader/index.ts SearchResult
interface SearchResult {
  id: string
  type: ContentType
  source: string // 'conversation', 'facebook', 'web'
  sourceType: SourceType // 'original' | 'reference'
  content: string
  title?: string
  similarity: number
  
  // CRITICAL: This date semantics MUST be clear
  createdAt?: string | number // Unix timestamp (seconds or ms) or ISO string
  
  authorName?: string
  sourceUrl?: string
  metadata?: Record<string, unknown>
}
```

**Issue**: `createdAt` type and semantics are ambiguous. Could be:
- Seconds since epoch (Unix timestamp)
- Milliseconds since epoch (JS Date)
- ISO string (2026-01-16T12:34:56Z)
- Mixed in same response

### Layer 2: Book Studio API (:3004) - Transform & Enhance

**Owns**:
- Books database (SQLite)
- Harvest cards (staging area)
- Chapters and drafts
- Metadata enrichment

**Receives from Archive**:
- SearchResult with unclear date semantics

**Must provide**:
- Clear date semantics for all fields
- Temporal lineage (original → exported → imported)
- Zero-date detection and handling

### Layer 3: Frontend - Display & Edit

**Owns**:
- UI state (selectedCard, currentBook)
- User annotations
- Local temporary state

**Receives from Book Studio API**:
- HarvestCard with defined dates
- Books with metadata preserved

---

## UNIFIED SCHEMA SPECIFICATION

### DateFormat Standards

```typescript
// UNIVERSAL DATE TYPES

/**
 * Represents a date from an external platform.
 * 
 * Unix timestamps (seconds since 1970-01-01):
 * - Most reliable for historical dates
 * - Unambiguous interpretation
 * - Can represent dates from 1970 onward
 * 
 * If source provides ISO string:
 * - Convert to Unix timestamp for storage
 * - Preserve original in metadata if needed
 * 
 * If source provides milliseconds:
 * - Normalize to seconds for consistency
 */
export type UnixTimestamp = number // Seconds since 1970-01-01

/**
 * ISO 8601 string for API responses.
 * Always use seconds precision (no milliseconds).
 */
export type ISODateString = string // Format: YYYY-MM-DDTHH:MM:SSZ

/**
 * Special case: When date is unknown or lost.
 * DO NOT use 0, null, or undefined without context.
 */
export type DateStatus = 'unknown' | 'approximate'

// HELPER
function unixToISO(timestamp: number): ISODateString {
  return new Date(timestamp * 1000).toISOString()
}

function isoToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000)
}

/**
 * Detect if a date is a zero-date (lost metadata)
 */
function isZeroDate(timestamp: number | string | null | undefined): boolean {
  if (timestamp === null || timestamp === undefined) return true
  if (typeof timestamp === 'number') {
    // Epoch zero or very early dates (before 1975)
    return timestamp === 0 || timestamp < 157680000 // Jan 1, 1975
  }
  if (typeof timestamp === 'string') {
    return timestamp === '' || 
           timestamp.startsWith('1970-') ||
           timestamp === '0000-01-01T00:00:00Z'
  }
  return false
}

/**
 * Safely handle date from external source
 */
function normalizeDateFromSource(date: unknown): {
  timestamp: number | null
  status: DateStatus
  original: unknown
} {
  if (isZeroDate(date)) {
    return {
      timestamp: null,
      status: 'unknown',
      original: date
    }
  }
  
  if (typeof date === 'number') {
    // Assume Unix seconds if reasonable, else milliseconds
    const ts = date > 10000000000 ? Math.floor(date / 1000) : date
    return { timestamp: ts, status: 'precise', original: date }
  }
  
  if (typeof date === 'string') {
    try {
      const ts = Math.floor(new Date(date).getTime() / 1000)
      return { timestamp: ts, status: 'precise', original: date }
    } catch {
      return { timestamp: null, status: 'unknown', original: date }
    }
  }
  
  return { timestamp: null, status: 'unknown', original: date }
}
```

---

## ARCHIVE LAYER (:3002) SCHEMA

### SearchResult (Existing - Minor Clarification)

```typescript
interface SearchResult {
  // ... other fields ...
  
  /**
   * When the content was CREATED on the original platform.
   * 
   * Type: Unix timestamp in SECONDS (not milliseconds)
   * Source: Metadata from platform (ChatGPT, Facebook, etc.)
   * Semantics: "Original creation date"
   * 
   * If missing/zero: Content date unknown, check metadata
   * 
   * CRITICAL: This is NOT when we archived it.
   */
  createdAt?: number
  
  /**
   * When the content was EXPORTED from platform (if known).
   * Example: Facebook data export timestamp
   * 
   * Type: Unix timestamp in SECONDS
   * Semantics: "Export date from platform"
   * 
   * If missing: We don't know when export occurred
   */
  exportedAt?: number
  
  /**
   * Full metadata from source platform.
   * May contain additional date fields:
   * - created_time, created_date, timestamp
   * - updated_time, modified_date
   * - published_date, posted_date
   * 
   * All dates in metadata should be normalized to Unix seconds.
   */
  metadata?: {
    // Original field names preserved for audit trail
    original_created_at?: unknown
    original_exported_at?: unknown
    
    // Normalized timestamps
    created_timestamp?: number
    exported_timestamp?: number
    updated_timestamp?: number
    
    // Metadata status
    date_source?: 'platform' | 'export' | 'archive' | 'unknown'
    date_confidence?: 'precise' | 'approximate' | 'unknown'
    
    [key: string]: unknown
  }
}
```

---

## BOOK STUDIO SCHEMA (:3004 Database)

### HarvestCard (In DB)

```typescript
/**
 * A card harvested from Archive into Book Studio staging area.
 * 
 * Temporal semantics:
 * - sourceCreatedAt: When original content was created (on platform)
 * - sourceExportedAt: When exported from platform (if known)
 * - harvestedAt: When we pulled it into Book Studio (precise)
 * - importedAt: When formally moved from staging to book (if used)
 */
interface HarvestCard {
  id: string
  bookId: string
  
  // ─────────────────────────────────────────────────────────────────
  // SOURCE METADATA (from Archive)
  // ─────────────────────────────────────────────────────────────────
  
  sourceId: string
  sourceType: ContentType // 'message', 'post', 'comment', etc.
  source: string // 'conversation', 'facebook', 'web'
  contentOrigin: SourceType // 'original' | 'reference'
  content: string
  title?: string
  authorName?: string
  
  /** Search similarity score (0-1) if from semantic search */
  similarity?: number
  
  /** 
   * When the source content was CREATED on the original platform.
   * 
   * Type: Unix timestamp (seconds)
   * Source: From Archive SearchResult.createdAt
   * Semantics: "Original creation date"
   * 
   * IF ZERO/NULL: Date is lost. Store status in sourceCreatedAtStatus.
   */
  sourceCreatedAt?: number
  
  /**
   * Status of sourceCreatedAt field.
   * Used when date is missing or uncertain.
   */
  sourceCreatedAtStatus?: 'known' | 'approximate' | 'unknown'
  
  /**
   * When the source was EXPORTED from platform (if known).
   * 
   * Type: Unix timestamp (seconds)
   * Example: Facebook export backup timestamp
   * Semantics: "Export date"
   */
  sourceExportedAt?: number
  
  /** Link back to source (conversation, post URL, etc.) */
  sourceUrl?: string
  conversationId?: string
  conversationTitle?: string
  
  /**
   * FULL original metadata from Archive.
   * Preserved as-is for audit trail and future use.
   * 
   * Should include:
   * - Original date field names (created_time, timestamp, etc.)
   * - Platform-specific metadata
   * - Any transformation notes from Archive import
   */
  sourceMetadata?: Record<string, unknown>
  
  // ─────────────────────────────────────────────────────────────────
  // BOOK STUDIO METADATA
  // ─────────────────────────────────────────────────────────────────
  
  /**
   * When THIS CARD was created in Book Studio.
   * 
   * Type: ISO string (UTC)
   * Semantics: "When we imported this into staging"
   * Precise: Always set by server timestamp
   */
  createdAt: string // ISO 8601
  
  /**
   * When card was harvested from Archive search.
   * 
   * Type: ISO string (UTC)
   * Semantics: "When harvest operation occurred"
   * May differ from createdAt if card is re-harvested.
   */
  harvestedAt: string // ISO 8601
  
  /**
   * When card was moved from staging to book (if applicable).
   * 
   * Type: ISO string (UTC)
   * Semantics: "Commit to book" timestamp
   * Null until moved.
   */
  importedAt?: string // ISO 8601
  
  /**
   * When card was last edited by user.
   */
  lastEditedAt?: string // ISO 8601
  
  // ─────────────────────────────────────────────────────────────────
  // CARD STATE & ANNOTATIONS
  // ─────────────────────────────────────────────────────────────────
  
  status: 'staging' | 'placed' | 'archived'
  
  /** User's notes on this card */
  userNotes: string
  
  /** AI-generated context summary */
  aiSummary?: string
  
  /** Suggested chapter (from analysis) */
  suggestedChapterId?: string
  
  /** Organization tags */
  tags: string[]
  
  /** Canvas position if in visual mode */
  canvasPosition?: { x: number; y: number }
  
  // ─────────────────────────────────────────────────────────────────
  // GRADING (From NPE-Local)
  // ─────────────────────────────────────────────────────────────────
  
  grade?: CardGrade // SIC score, Quantum analysis, etc.
  
  /** Whether card is detected as outline/structure */
  isOutline?: boolean
  outlineStructure?: OutlineStructure
}

/**
 * Card grading (from harvest-review-agent)
 */
interface CardGrade {
  // Scores (1-5)
  authenticity: number // From SIC analysis
  necessity: number // Chekhov analysis
  inflection: number // Quantum inflection points
  voice: number // Style coherence
  overall: number // Composite
  
  // Classification
  stubType: StubClassification
  
  // Analysis details
  sicAnalysis?: SICAnalysis
  chekhovAnalysis?: ChekhovAnalysis
  quantumHighlights?: QuantumHighlights
  
  // Grading metadata
  gradedAt: string // ISO 8601
  gradedBy: 'auto' | 'manual' | 'hybrid'
  confidence: number // 0-1
}
```

### Book (In DB)

```typescript
interface Book {
  id: string
  title: string
  description?: string
  targetWordCount?: number
  status: 'draft' | 'reviewing' | 'published' | 'archived'
  
  /**
   * When the book project was CREATED in Book Studio.
   * 
   * Type: ISO string (UTC)
   * Semantics: "Book project creation timestamp"
   * Set once on creation.
   */
  createdAt: string // ISO 8601
  
  /**
   * When the book was last modified.
   * 
   * Type: ISO string (UTC)
   * Updated: On any content/metadata change
   */
  updatedAt: string // ISO 8601
  
  /**
   * When the book was published (if applicable).
   * 
   * Type: ISO string (UTC)
   * Set when status → 'published'
   */
  publishedAt?: string // ISO 8601
  
  /** Custom author metadata (JSON) */
  metadata?: Record<string, unknown>
  
  /** User who created (for multi-user future) */
  createdBy?: string
  
  /** Last editor (for audit trail) */
  lastEditedBy?: string
}
```

### Chapter (In DB)

```typescript
interface Chapter {
  id: string
  bookId: string
  title: string
  order: number
  status: 'draft' | 'reviewing' | 'complete'
  
  /**
   * Chapter creation timestamp in Book Studio.
   */
  createdAt: string // ISO 8601
  
  /**
   * Last modification timestamp.
   */
  updatedAt: string // ISO 8601
  
  /** Current draft content (markdown) */
  content?: string
  wordCount: number
  
  /** AI generation instructions */
  draftInstructions?: string
  
  /** Associated passage IDs */
  passageIds: string[]
}
```

### OutlineMetadata (For Tracking Lineage)

```typescript
/**
 * When research/outline are generated, track the lineage.
 * This enables reproducibility and migration.
 */
interface OutlineMetadata {
  id: string
  bookId: string
  chapterId: string
  
  /**
   * When research phase ran.
   */
  researchedAt: string // ISO 8601
  
  /**
   * When outline was generated.
   */
  generatedAt: string // ISO 8601
  
  /**
   * Which card versions were used (for reproducibility).
   * Maps cardId → { version, sourceCreatedAt, harvestedAt }
   */
  cardSnapshot?: Record<string, {
    version: number
    sourceCreatedAt?: number
    harvestedAt: string
    similarity: number
  }>
  
  /**
   * Configuration used for generation.
   */
  config: OutlineGenConfig
  
  /**
   * Status of date handling during generation.
   */
  dateHandling?: {
    zeroDateCardIds: string[] // Cards with unknown source dates
    approximateDateCardIds: string[] // Cards with approximate dates
    allDatesKnown: boolean
  }
}
```

---

## MIGRATION GUIDE: Fixing Bad Dates

### Problem Detection

```sql
-- Cards with zero dates (lost metadata)
SELECT COUNT(*) FROM harvest_cards 
WHERE source_created_at = 0 
   OR source_created_at IS NULL 
   OR source_created_at < 157680000; -- Before 1975

-- Cards with date inconsistencies
SELECT COUNT(*) FROM harvest_cards 
WHERE harvested_at < created_at;

-- Books with future dates (data corruption)
SELECT COUNT(*) FROM books 
WHERE created_at > NOW();
```

### Remediation Strategy

```typescript
/**
 * Migration: Normalize and preserve dates
 */
async function migrateBookDates(bookId: string) {
  const book = await db.getBook(bookId)
  const cards = await db.getCards(bookId)
  
  for (const card of cards) {
    // 1. Detect zero-date
    if (isZeroDate(card.sourceCreatedAt)) {
      // Try to recover from metadata
      const recovered = tryRecoverDate(card.sourceMetadata)
      
      card.sourceCreatedAt = recovered?.timestamp ?? null
      card.sourceCreatedAtStatus = recovered ? 'approximate' : 'unknown'
      
      // Log for audit
      console.log(`Card ${card.id}: Recovered date from metadata`, {
        original: card.sourceCreatedAt,
        recovered: recovered?.timestamp,
        source: recovered?.source
      })
    }
    
    // 2. Validate date ordering
    if (card.sourceCreatedAt && card.harvestedAt) {
      const sourceTime = new Date(card.sourceCreatedAt * 1000)
      const harvestTime = new Date(card.harvestedAt)
      
      if (sourceTime > harvestTime) {
        console.warn(`Card ${card.id}: Source date after harvest date`, {
          sourceCreatedAt: sourceTime,
          harvestedAt: harvestTime
        })
        // Keep both - logical issue but preserve data
      }
    }
    
    // 3. Save with updated status
    await db.updateCard(card.id, {
      sourceCreatedAt: card.sourceCreatedAt,
      sourceCreatedAtStatus: card.sourceCreatedAtStatus,
      sourceMetadata: card.sourceMetadata // Preserve original
    })
  }
}

/**
 * Try to recover lost date from metadata
 */
function tryRecoverDate(metadata: Record<string, unknown> | undefined): 
  { timestamp: number; source: string } | null {
  if (!metadata) return null
  
  // Try common date field names
  const candidates = [
    'created_time', 'created_at', 'createdAt',
    'timestamp', 'date', 'posted_date', 'created_date',
    'updated_time', 'updated_at',
    'original_created_at', 'original_timestamp'
  ]
  
  for (const field of candidates) {
    const value = metadata[field]
    if (isZeroDate(value)) continue
    
    const result = normalizeDateFromSource(value)
    if (result.timestamp !== null) {
      return { timestamp: result.timestamp, source: field }
    }
  }
  
  return null
}
```

---

## TYPE SYSTEM ALIGNMENT

### Current State Problems

**humanizer-sandbox** (Frontend) has local types:
```
src/book-studio/types.ts - HarvestCard, Book, Chapter
src/archive-reader/index.ts - SearchResult
```

**humanizer-gm/packages/core** has canonical types:
```
packages/core/src/types/
  - book.ts (BookProject, DraftChapter)
  - harvest.ts (HarvestBucket, NarrativeArc)
  - passage.ts (SourcePassage)
  - entity.ts (EntityURI, SourceReference)
```

**ISSUE**: Two competing type systems!

### Solution: Unified Type System

**All types must flow through @humanizer/core**:

```typescript
// packages/core/src/types/harvest.ts
export interface HarvestCard extends EntityMeta {
  type: 'harvest-card'
  
  bookUri: EntityURI
  sourceRef: SourceReference
  
  // Temporal fields (standardized)
  sourceCreatedAt?: number // Unix seconds, from original platform
  sourceCreatedAtStatus?: 'known' | 'approximate' | 'unknown'
  harvestedAt: number // Book Studio harvest timestamp (ms)
  importedAt?: number // When moved to book (ms)
  
  content: string
  userNotes: string
  grade?: CardGrade
  status: 'staging' | 'placed' | 'archived'
  
  sourceMetadata?: Record<string, unknown> // Preserved for audit
}

// Book Studio can re-export for convenience
// packages/core/src/types/index.ts
export type { HarvestCard, ... } from './harvest.js'
```

---

## BACKWARD COMPATIBILITY GUARANTEES

### Existing Data (humanizer-sandbox)

```typescript
// Old format (keep working)
interface LegacyHarvestCard {
  id: string
  content: string
  createdAt?: string | number
  harvestedAt: string
  metadata?: Record<string, unknown>
}

// Migration layer
function adaptLegacyCard(legacy: LegacyHarvestCard): HarvestCard {
  const sourceCreated = normalizeDateFromSource(legacy.createdAt)
  const harvested = Math.floor(new Date(legacy.harvestedAt).getTime() / 1000)
  
  return {
    ...legacy,
    sourceCreatedAt: sourceCreated.timestamp,
    sourceCreatedAtStatus: sourceCreated.status,
    harvestedAt: harvested,
    sourceMetadata: legacy.metadata
  }
}
```

### API Responses (REST)

```typescript
// API always returns ISO 8601 for dates (JSON serializable)
interface HarvestCardResponse {
  id: string
  content: string
  
  // ISO format in responses
  sourceCreatedAt?: string // ISO 8601 (from Unix timestamp)
  sourceCreatedAtStatus?: string
  harvestedAt: string // ISO 8601
  importedAt?: string // ISO 8601
  
  sourceMetadata?: Record<string, unknown>
}

// Conversion helper
function toResponse(card: HarvestCard): HarvestCardResponse {
  return {
    ...card,
    sourceCreatedAt: card.sourceCreatedAt 
      ? unixToISO(card.sourceCreatedAt)
      : undefined,
    harvestedAt: unixToISO(card.harvestedAt),
    importedAt: card.importedAt 
      ? unixToISO(card.importedAt)
      : undefined
  }
}
```

---

## METADATA FLOW DIAGRAM

```
┌─────────────────┐
│ Archive Server  │ (Source of truth for original dates)
│   :3002         │
├─────────────────┤
│ Conversation    │
│ created: 1704067200 (Unix)
│ exported: undefined
│ metadata: {...}
└────────┬────────┘
         │
         │ SearchResult
         │ { id, content, createdAt: 1704067200, metadata }
         │
         v
┌─────────────────────────────┐
│ Book Studio Harvest         │ (Enrichment point)
│ :3004                       │
├─────────────────────────────┤
│ HarvestCard                 │
│                             │
│ sourceCreatedAt: 1704067200 │ ← From Archive
│ sourceCreatedAtStatus: 'known'
│ sourceMetadata: {...}       │ ← Full preservation
│                             │
│ harvestedAt: 1705449600 (Unix) ← When we grabbed it
│ createdAt: "2026-01-16T12:34:56Z" (ISO) ← Card created in staging
│                             │
│ status: 'staging'           │ ← In staging area
└────────┬────────────────────┘
         │
         │ User approves
         │
         v
┌─────────────────────────────┐
│ Book Project                │
├─────────────────────────────┤
│ SourcePassage (curated)     │
│                             │
│ sourceRef.timestamp: 1704067200 ← Preserved
│ curation.curatedAt: 1705449600 ← When approved
│                             │
│ status: 'approved'          │
└────────┬────────────────────┘
         │
         │ Chapter composition
         │
         v
┌─────────────────────────────┐
│ Chapter Draft               │
├─────────────────────────────┤
│ passageRefs: [...]          │ ← References to sources
│ createdAt: "2026-01-16..." ← Chapter creation
│ lastEditedAt: "2026-01-17..."
│                             │
│ Content preserves lineage   │
│ through passage references  │
└─────────────────────────────┘
```

---

## API CONTRACT SPECIFICATIONS

### POST /api/books/:id/harvest

**Request**:
```json
{
  "searchResult": {
    "id": "msg-123",
    "type": "message",
    "source": "conversation",
    "content": "...",
    "createdAt": 1704067200,
    "metadata": { ... }
  }
}
```

**Response** (201 Created):
```json
{
  "id": "card-456",
  "content": "...",
  "status": "staging",
  
  "sourceCreatedAt": 1704067200,
  "sourceCreatedAtStatus": "known",
  "harvestedAt": "2026-01-16T12:34:56Z",
  
  "grade": { ... },
  "userNotes": "",
  "tags": []
}
```

**Contract guarantees**:
- `sourceCreatedAt` preserves original platform date
- `sourceCreatedAtStatus` indicates reliability
- `harvestedAt` is always set (precise)
- `sourceMetadata` contains full original metadata
- Zero dates are detected and status indicates 'unknown'

### POST /api/books/:id/chapters/:cid/generate-outline

**Response**:
```json
{
  "id": "outline-789",
  "structure": { ... },
  "itemCardAssignments": { ... },
  
  "generatedAt": "2026-01-16T12:34:56Z",
  "cardMetadata": {
    "date_handling": {
      "zeroDateCardIds": [],
      "approximateDateCardIds": ["card-11"],
      "allDatesKnown": false
    }
  }
}
```

**Contract guarantees**:
- Outline includes date quality metadata
- Generated output is reproducible
- Cards with bad dates are identified

---

## REQUIRED MIGRATIONS

### 1. Archive Server: Clarify SearchResult.createdAt

```typescript
// CHANGE: archive-reader/index.ts
interface SearchResult {
  // OLD: createdAt?: string | number (ambiguous)
  // NEW: Be explicit about what we return
  
  createdAt?: number // Unix seconds (ONLY format)
  
  // If platform gave us export time, add:
  exportedAt?: number // Unix seconds
  
  // Full metadata with originals preserved
  metadata?: {
    date_source?: 'platform' | 'export' | 'unknown'
    original_created_at?: unknown // As-received
    [key: string]: unknown
  }
}
```

### 2. Book Studio: Use core types for HarvestCard

```typescript
// Book Studio models: Use types from @humanizer/core
import type { HarvestCard } from '@humanizer/core'

// Database schema (SQLite):
CREATE TABLE harvest_cards (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  source_id TEXT,
  content TEXT NOT NULL,
  
  -- Source metadata (from Archive)
  source_created_at INTEGER, -- Unix seconds
  source_created_at_status TEXT, -- 'known' | 'approximate' | 'unknown'
  source_metadata TEXT, -- JSON
  
  -- Book Studio timeline
  created_at TEXT NOT NULL, -- ISO 8601
  harvested_at TEXT NOT NULL, -- ISO 8601
  imported_at TEXT, -- ISO 8601 (nullable)
  
  status TEXT DEFAULT 'staging',
  grade JSONB,
  user_notes TEXT,
  tags TEXT[], -- JSON array
  
  FOREIGN KEY (book_id) REFERENCES books(id)
);
```

### 3. Frontend: Import from core, remove duplicates

```typescript
// REMOVE: src/book-studio/types.ts HarvestCard
// IMPORT instead:
import type { HarvestCard, Book, DraftChapter } from '@humanizer/core'

// Keep only UI state types locally:
export interface BookStudioState {
  currentBook: Book | null
  currentChapterId: string | null
  selectedCardIds: string[]
  // ... etc
}
```

---

## VALIDATION RULES

### On Harvest

```typescript
async function validateHarvestedCard(result: SearchResult): Promise<ValidationResult> {
  const errors: string[] = []
  
  // Check date field
  if (result.createdAt !== undefined) {
    const norm = normalizeDateFromSource(result.createdAt)
    if (norm.status === 'unknown') {
      errors.push(`Invalid createdAt: ${result.createdAt}`)
    }
  }
  
  // Check required fields
  if (!result.content) errors.push('Missing content')
  if (!result.id) errors.push('Missing source ID')
  
  // Check similarity if present
  if (result.similarity !== undefined && (result.similarity < 0 || result.similarity > 1)) {
    errors.push('Invalid similarity score')
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}
```

### On Save to Book

```typescript
async function validateCardForBook(card: HarvestCard): Promise<ValidationResult> {
  const errors: string[] = []
  
  // Must have been harvested
  if (!card.harvestedAt) errors.push('Missing harvestedAt')
  
  // Source date must be present or status must explain why
  if (!card.sourceCreatedAt && card.sourceCreatedAtStatus !== 'unknown') {
    errors.push('sourceCreatedAt missing but status not set')
  }
  
  // Content must not be empty
  if (!card.content || card.content.trim().length === 0) {
    errors.push('Empty content')
  }
  
  // Metadata must be preserved from source
  if (!card.sourceMetadata && card.source === 'archive') {
    errors.push('Source metadata missing')
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}
```

---

## TESTING CHECKLIST

- [ ] Zero-date detection identifies all edge cases
- [ ] Date recovery from metadata works (multiple formats)
- [ ] ISO ↔ Unix conversion is lossless
- [ ] Archive dates survive full pipeline (archive → harvest → book → export)
- [ ] Metadata preserved (sourceMetadata never discarded)
- [ ] API responses use consistent ISO format
- [ ] Card ordering by date is logical (never violated)
- [ ] Migration handles existing bad data gracefully
- [ ] Types from @humanizer/core are canonical
- [ ] No type duplication between packages

---

## SIGNOFF REQUIREMENTS

**Before merge to main**:

1. **Archive Server**:
   - [ ] SearchResult.createdAt type clarified (Unix seconds only)
   - [ ] metadata includes date_source field
   - [ ] Export dates tracked when available

2. **Book Studio API**:
   - [ ] HarvestCard uses @humanizer/core types
   - [ ] SQLite schema includes sourceCreatedAt, sourceCreatedAtStatus
   - [ ] Dates normalized on import from Archive
   - [ ] Zero-date detection active
   - [ ] Full sourceMetadata preserved always
   - [ ] API responses use ISO 8601 consistently

3. **Frontend**:
   - [ ] Imports types from @humanizer/core (not local)
   - [ ] No duplicate type definitions
   - [ ] Date displays include quality indicator (known/approximate/unknown)

4. **Documentation**:
   - [ ] Date field semantics documented in code comments
   - [ ] Migration guide provided for existing data
   - [ ] Backward compatibility layer tested

---

## CRITICAL COMMANDMENTS

1. **NEVER discard metadata** - Always preserve original sourceMetadata
2. **ALWAYS clarify date semantics** - Every date field must have clear meaning
3. **DETECT zero-dates** - Never let unknown dates pass silently
4. **IMPORT from core** - @humanizer/core is single source of truth for types
5. **PRESERVE lineage** - User can always trace passage back to source
6. **ISO in APIs** - REST responses use ISO 8601 (JSON serializable)
7. **Unix in storage** - Database and calculations use Unix seconds
8. **BACKWARD compatible** - Old data must migrate cleanly

---

**House of Data approves architecture with mandatory fixes above**

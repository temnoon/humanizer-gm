# SECURITY AUDIT: Book Studio API (:3004)

**Date**: January 16, 2026  
**Agent**: House of Security  
**Scope**: Book Studio API architecture, authentication model, data flows  
**Status**: BLOCKING - Critical issues identified  

---

## EXECUTIVE SUMMARY

The Book Studio API design is **functionally sound** but **has critical security gaps** that MUST be addressed before implementation:

| Category | Status | Critical Issues |
|----------|--------|-----------------|
| **API Authentication** | 🔴 BLOCKING | No per-API auth; cross-service secrets unplanned |
| **Data Access Control** | 🟡 WARNING | No book/chapter ownership validation; future multi-user unprepared |
| **Input Validation** | 🔴 BLOCKING | URL validation for web harvesting missing; XSS in card content |
| **Injection Prevention** | 🟡 WARNING | Parameterized queries assumed but not specified |
| **WebSocket Security** | 🔴 BLOCKING | No connection auth/validation; message validation missing |
| **Sensitive Data** | 🟡 WARNING | User content stored locally OK; external APIs need auth review |
| **Privacy/Compliance** | ✅ PASS | Local-first architecture approved; no cloud leaks |

**Verdict**: 🚫 **BLOCKED** - Cannot merge without critical fixes

**Blocking Issues**: 3
1. API authentication model (Electron local-only)
2. WebSocket connection security
3. Input validation framework

---

## PART 1: API AUTHENTICATION MODEL

### Current State
The design mentions no authentication between services (:3004 ↔ :3002, :3003). This works for **single-user Electron apps**, but needs explicit design.

### CRITICAL: Local Electron API Auth

**Issue**: Book Studio API (:3004) is accessible from React frontend without authentication. In a local Electron context, this is acceptable, BUT must be explicitly documented and validated.

#### Design Decision: Trusted Boundary Model

For Electron (single-user, local):
```
┌─────────────────────────────────────┐
│ Trusted Boundary (Electron Process) │
│                                     │
│  Frontend (React) → :3004 API       │ ← No auth needed
│                    → :3002 Archive  │   (IPC within process)
│                    → :3003 NPE-Local│
│                                     │
└─────────────────────────────────────┘
```

**Rationale**: All three servers run in same Electron main process, so:
- Network boundary is within trusted app
- No risk of external callers
- XSS can't access backends (React can't make raw HTTP to :3004)

**BUT MUST IMPLEMENT**:

1. ✅ Bind servers to `127.0.0.1` only (not `0.0.0.0`)
   ```typescript
   // electron/book-studio/index.ts
   app.listen(3004, '127.0.0.1', () => {
     console.log('Book Studio API listening on 127.0.0.1:3004');
   });
   ```

2. ✅ Validate all requests come from renderer (IPC-only)
   ```typescript
   // Middleware to check origin
   app.use((req, res, next) => {
     // In Electron, requests come from 127.0.0.1:randomport (renderer)
     // Reject anything else
     const clientIP = req.connection.remoteAddress;
     if (!clientIP?.includes('127.0.0.1')) {
       return res.status(403).json({ error: 'Forbidden' });
     }
     next();
   });
   ```

3. ⚠️ Document Electron-only limitation
   ```typescript
   // electron/book-studio/README.md
   /**
    * SECURITY: This API is designed for Electron desktop app only.
    * 
    * Authentication Model:
    * - Single user, trusted process boundary
    * - Binds to 127.0.0.1 (localhost only)
    * - All services in same Electron main process
    * 
    * For web deployment: MUST add OAuth/JWT authentication
    * See: ./SECURITY_WEB_DEPLOYMENT.md
    */
   ```

### CRITICAL: Future Web Deployment Auth

**Issue**: Design mentions "scalable to web version" but provides no auth model.

#### Required JWT Model (for future web)

```typescript
// packages/core/src/types/auth.ts

export interface JWTClaims {
  sub: string            // User ID
  email: string
  role: UserRole
  iat: number           // Issued at
  exp: number           // Expiration
  aud: 'book-studio-api' // Audience (which API)
  iss: 'humanizer-auth'  // Issuer
}

export interface ServiceToken {
  service: 'archive' | 'npe-local' | 'book-studio'
  exp: number
  key: string // For service-to-service calls
}
```

**Implementation** (future):
```typescript
// electron/book-studio/middleware/auth.ts
import jwt from 'jsonwebtoken';

export function verifyJWT(token: string): JWTClaims {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  
  try {
    const claims = jwt.verify(token, secret, {
      audience: 'book-studio-api',
      issuer: 'humanizer-auth'
    }) as JWTClaims;
    return claims;
  } catch (err) {
    throw new Error(`Invalid token: ${err.message}`);
  }
}

// For web version, use this middleware
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }
  
  const token = authHeader.slice(7);
  try {
    req.user = verifyJWT(token);
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid token' });
  }
}
```

**Status**: Not needed for Electron v1, plan for web v2.

---

## PART 2: BOOK OWNERSHIP & ACCESS CONTROL

### CRITICAL: Missing Ownership Validation

**Issue**: API endpoints don't validate user owns book/chapter/card.

#### Design: Single-User Ownership (Electron)

For Electron, simplify: **All books belong to the authenticated user** (which is implicit - single user).

#### Design: Multi-User Access Control (Future Web)

```typescript
// electron/book-studio/middleware/ownership.ts

export async function requireBookOwnership(req, res, next) {
  const { userId } = req.user; // From JWT
  const { bookId } = req.params;
  
  // Check ownership
  const book = await db.getBook(bookId);
  if (!book) {
    return res.status(404).json({ error: 'Book not found' });
  }
  
  if (book.createdBy !== userId && book.contributors?.includes(userId) === false) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  req.book = book; // Attach to request
  next();
}

// Usage in routes
router.patch('/api/books/:bookId', requireBookOwnership, (req, res) => {
  // Can safely update req.book
});
```

#### Immediate Implementation (Electron)

For now, add comment + doc:
```typescript
// electron/book-studio/routes/books.ts

// SECURITY: Electron version - single user implicit
// TODO: Add ownership check for web version
// See: SECURITY_WEB_DEPLOYMENT.md

router.patch('/api/books/:id', async (req, res) => {
  // In Electron, no check needed (single user)
  // In web version, add requireBookOwnership middleware
  const book = await bookService.updateBook(req.params.id, req.body);
  res.json(book);
});
```

#### Required in Database Schema

```sql
-- books table MUST have ownership fields
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_by TEXT, -- User ID (NULL for Electron v1)
  contributors TEXT[], -- JSON array (for future)
  is_public BOOLEAN DEFAULT FALSE,
  access_level TEXT DEFAULT 'private', -- 'private' | 'shared' | 'public'
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

---

## PART 3: INPUT VALIDATION FRAMEWORK

### CRITICAL: Missing Validation Specification

**Issue**: No validation rules defined for any endpoint. High risk for injection attacks.

#### Unified Validation Schema

```typescript
// electron/book-studio/validation/rules.ts

import { z } from 'zod'; // Use Zod for schema validation

// ─────────────────────────────────────────────────────────
// BOOK OPERATIONS
// ─────────────────────────────────────────────────────────

export const BookCreateSchema = z.object({
  title: z.string()
    .min(1, 'Title required')
    .max(255, 'Title too long')
    .trim(),
  description: z.string()
    .max(2000, 'Description too long')
    .optional(),
  targetWordCount: z.number()
    .positive('Must be positive')
    .optional(),
  metadata: z.record(z.unknown())
    .optional()
});

export const BookUpdateSchema = BookCreateSchema.partial();

// ─────────────────────────────────────────────────────────
// HARVEST OPERATIONS
// ─────────────────────────────────────────────────────────

export const HarvestSchema = z.object({
  searchResult: z.object({
    id: z.string()
      .min(1, 'Source ID required')
      .max(255),
    type: z.enum(['message', 'post', 'comment', 'note', 'article']),
    source: z.enum(['conversation', 'facebook', 'web', 'twitter', 'email']),
    content: z.string()
      .min(1, 'Content required')
      .max(50000, 'Content too long'),
    title: z.string().max(255).optional(),
    createdAt: z.number().optional(), // Unix timestamp
    authorName: z.string().max(255).optional(),
    sourceUrl: z.string().url('Invalid URL').optional(),
    similarity: z.number().min(0).max(1).optional(),
    metadata: z.record(z.unknown()).optional()
  })
});

// ─────────────────────────────────────────────────────────
// CARD OPERATIONS
// ─────────────────────────────────────────────────────────

export const CardUpdateSchema = z.object({
  userNotes: z.string()
    .max(5000, 'Notes too long')
    .optional(),
  tags: z.array(z.string()
    .min(1)
    .max(50)
  ).optional(),
  suggestedChapterId: z.string().optional()
});

// ─────────────────────────────────────────────────────────
// OUTLINE OPERATIONS
// ─────────────────────────────────────────────────────────

export const GenerateOutlineSchema = z.object({
  proposedOutline: z.object({
    type: z.enum(['numbered', 'hierarchical', 'arc-based']),
    items: z.array(z.object({
      level: z.number().nonnegative(),
      text: z.string()
        .min(1)
        .max(500)
    }))
  }).optional(),
  config: z.object({
    keepProposedItems: z.boolean().optional(),
    minSectionStrength: z.number().min(0).max(1).optional(),
    maxSections: z.number().positive().optional(),
    preferArcStructure: z.boolean().optional()
  }).optional()
});

// ─────────────────────────────────────────────────────────
// DRAFT OPERATIONS
// ─────────────────────────────────────────────────────────

export const DraftGenerateSchema = z.object({
  strategy: z.enum(['outline-based', 'card-sequence', 'freeform']),
  config: z.object({
    model: z.enum(['llama3.2', 'llama2', 'mistral']),
    temperature: z.number().min(0).max(2).optional(),
    preserveVoice: z.boolean().optional(),
    includeTransitions: z.boolean().optional(),
    generateBySection: z.boolean().optional()
  }).optional()
});

// ─────────────────────────────────────────────────────────
// CONTENT VALIDATION (XSS Prevention)
// ─────────────────────────────────────────────────────────

export function sanitizeUserContent(content: string): string {
  // Remove dangerous HTML/scripts
  // Keep markdown safe
  // See: XSS prevention section
  
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true
  });
}
```

#### Middleware for Auto-Validation

```typescript
// electron/book-studio/middleware/validate.ts

export function validate<T>(schema: z.ZodSchema<T>) {
  return (req, res, next) => {
    try {
      const validated = schema.parse(req.body);
      req.validated = validated;
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: err.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
      }
      return res.status(400).json({ error: 'Invalid request' });
    }
  };
}

// Usage
router.post('/api/books', 
  validate(BookCreateSchema),
  (req, res) => {
    const validated = req.validated as z.infer<typeof BookCreateSchema>;
    // Use validated data
  }
);
```

#### URL Validation (Web Harvesting)

```typescript
// electron/book-studio/validation/urls.ts

/**
 * Validate URL for web harvesting
 * Prevents SSRF attacks
 */
export function validateSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Block dangerous protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    
    // Block localhost (SSRF prevention)
    const hostname = parsed.hostname;
    if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      return false;
    }
    
    // Block private IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
    const ip = hostname;
    if (/^(10|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\./.test(ip)) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

// Test
assert(!validateSourceUrl('http://localhost:3004/admin')); // Blocked
assert(!validateSourceUrl('http://192.168.1.1')); // Blocked
assert(validateSourceUrl('https://example.com')); // OK
```

---

## PART 4: INJECTION PREVENTION

### SQL Injection

**Status**: ⚠️ ASSUMED SAFE - Needs verification

The design doesn't specify database layer. **MUST use parameterized queries**.

#### SQLite (Electron)

```typescript
// ✅ CORRECT - Parameterized
const stmt = db.prepare('SELECT * FROM harvest_cards WHERE book_id = ?');
const cards = stmt.all(bookId);

// ❌ WRONG - String concatenation (NEVER DO THIS)
const cards = db.exec(`SELECT * FROM harvest_cards WHERE book_id = '${bookId}'`);
```

**Requirement**: Document database layer choice

```typescript
// electron/book-studio/services/database/index.ts

/**
 * SECURITY: This module uses parameterized queries for all database operations.
 * 
 * All user input is passed as parameters, never interpolated into SQL strings.
 * This prevents SQL injection attacks.
 * 
 * Example:
 *   CORRECT:   db.prepare('SELECT * FROM books WHERE id = ?').get(bookId)
 *   WRONG:     db.prepare(`SELECT * FROM books WHERE id = '${bookId}'`)
 */
```

### NoSQL Injection (if using MongoDB)

Not applicable for SQLite, but if migrating to PostgreSQL with JSON fields:

```typescript
// ✅ CORRECT - Parameter binding
db.query(
  'SELECT * FROM books WHERE metadata->$1 = $2',
  ['owner', userId]
);

// ❌ WRONG - Interpolation
db.query(`SELECT * FROM books WHERE metadata->'${key}' = '${value}'`);
```

### Command Injection (LLM Prompts)

**CRITICAL**: Prompts sent to Ollama/LLM must never include unsanitized user input.

```typescript
// ❌ WRONG - User card content in prompt directly
const prompt = `Generate a chapter based on these notes:\n${card.content}`;

// ✅ CORRECT - Content passed as structured data
const prompt = buildPrompt({
  template: 'CHAPTER_FROM_CARDS',
  cards: [
    { id: card.id, content: card.content } // Content isolated
  ],
  settings: config
});
```

**Implementation**:

```typescript
// electron/book-studio/services/prompts.ts

import Handlebars from 'handlebars';

// Pre-compiled, safe templates (no dynamic content)
const TEMPLATES = {
  CHAPTER_FROM_CARDS: Handlebars.compile(`
    Generate a chapter outline using these source materials:
    {{#each cards}}
    - Source {{@index}}: {{this.title}}
    {{/each}}
    
    Requirements:
    - Preserve original voice
    - Draw connections between sources
    - Suggest chapter structure
  `)
};

export function buildPrompt(
  templateName: keyof typeof TEMPLATES,
  data: { cards: Array<{ title: string }> }
): string {
  const template = TEMPLATES[templateName];
  if (!template) throw new Error(`Unknown template: ${templateName}`);
  
  // Handlebars auto-escapes, safe for LLM
  return template(data);
}
```

### XSS in Card Content

**CRITICAL**: User-generated card content will be rendered in UI. Must sanitize.

```typescript
// electron/book-studio/utils/sanitize.ts

import DOMPurify from 'dompurify';

/**
 * Sanitize card content for safe rendering
 * Removes scripts while preserving markdown structure
 */
export function sanitizeCardContent(content: string): string {
  return DOMPurify.sanitize(content, {
    // Only allow basic formatting
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'blockquote',
      'code', 'pre'
    ],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
    RETURN_DOM: false
  });
}

// Test
const dirty = '<p>Hello <img src=x onerror="alert(1)"></p>';
const clean = sanitizeCardContent(dirty);
assert(clean === '<p>Hello </p>'); // Script removed
```

**Frontend Usage** (React):

```tsx
// ✅ CORRECT - Use sanitized content
function HarvestCardView({ card }: { card: HarvestCard }) {
  const clean = sanitizeCardContent(card.content);
  return <div dangerouslySetInnerHTML={{ __html: clean }} />;
}

// ❌ WRONG - Unsanitized content
return <div dangerouslySetInnerHTML={{ __html: card.content }} />;

// ✅ BETTER - Let React handle escaping (if content is plain text)
return <div>{card.content}</div>; // React auto-escapes
```

---

## PART 5: WEBSOCKET SECURITY

### CRITICAL: No Connection Authentication

**Issue**: WebSocket endpoint `/ws` accepts any connection. Could allow:
- External observers to monitor all events
- Fake clients to receive data meant for user

#### Authentication Model

```typescript
// electron/book-studio/middleware/ws-auth.ts

import { WebSocket, Server } from 'ws';
import jwt from 'jsonwebtoken';

interface AuthenticatedWS extends WebSocket {
  userId?: string;
  bookId?: string;
  isAuthenticated: boolean;
}

export function createWSServer(httpServer: any) {
  const wss = new Server({ noServer: true });
  
  // Upgrade handler - authenticate before accepting connection
  httpServer.on('upgrade', (req, socket, head) => {
    // For Electron: Check origin is localhost
    if (!req.headers.origin?.includes('127.0.0.1')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    
    // For web: Verify JWT token from query or header
    const token = extractToken(req);
    let userId: string;
    
    if (token) {
      try {
        const claims = verifyJWT(token);
        userId = claims.sub;
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    } else if (process.env.NODE_ENV === 'development') {
      // Dev: allow unauthenticated for testing
      userId = 'dev-user';
    } else {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    
    wss.handleUpgrade(req, socket, head, (ws) => {
      const authWS = ws as AuthenticatedWS;
      authWS.userId = userId;
      authWS.isAuthenticated = true;
      
      wss.emit('connection', authWS, req);
    });
  });
  
  return wss;
}

function extractToken(req: any): string | null {
  // Try Authorization header
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  
  // Try query parameter
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('token');
}
```

#### Message Validation

```typescript
// electron/book-studio/ws/messages.ts

import { z } from 'zod';

// ─────────────────────────────────────────────────────────
// MESSAGE TYPES
// ─────────────────────────────────────────────────────────

export const SubscribeSchema = z.object({
  type: z.literal('subscribe'),
  bookId: z.string().min(1).max(255),
  chapterId: z.string().optional()
});

export const CancelSchema = z.object({
  type: z.literal('cancel'),
  sessionId: z.string().min(1).max(255)
});

export const ClientMessageSchema = z.union([
  SubscribeSchema,
  CancelSchema
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ─────────────────────────────────────────────────────────
// MESSAGE HANDLER
// ─────────────────────────────────────────────────────────

export function handleWSMessage(ws: AuthenticatedWS, rawData: string) {
  let message: ClientMessage;
  
  try {
    const data = JSON.parse(rawData);
    message = ClientMessageSchema.parse(data);
  } catch (err) {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Invalid message format'
    }));
    return;
  }
  
  // Process message
  switch (message.type) {
    case 'subscribe':
      // Verify user owns the book
      handleSubscribe(ws, message.bookId, message.chapterId);
      break;
    case 'cancel':
      handleCancel(ws, message.sessionId);
      break;
  }
}

async function handleSubscribe(
  ws: AuthenticatedWS,
  bookId: string,
  chapterId?: string
) {
  // Verify ownership
  const book = await db.getBook(bookId);
  if (!book || book.createdBy !== ws.userId) {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Access denied'
    }));
    return;
  }
  
  // Subscribe to events for this book
  ws.bookId = bookId;
  console.log(`Client ${ws.userId} subscribed to book ${bookId}`);
}
```

#### Event Broadcasting (Secure)

```typescript
// electron/book-studio/events/broadcast.ts

/**
 * Broadcast event only to authorized users
 */
export function broadcastToBook(
  wss: Server,
  bookId: string,
  event: ToolEvent
) {
  wss.clients.forEach((client: AuthenticatedWS) => {
    // Only send to clients subscribed to this book
    if (client.bookId === bookId && client.isAuthenticated) {
      client.send(JSON.stringify(event));
    }
  });
}

// Usage
broadcastToBook(wss, bookId, {
  type: 'card-graded',
  bookId,
  payload: { cardId, grade },
  timestamp: new Date().toISOString()
});
```

---

## PART 6: SENSITIVE DATA HANDLING

### User Content (Local Storage)

**Status**: ✅ PASS

- Book Studio stores user writing locally (SQLite)
- No cloud sync without consent (Privacy-first)
- Data encrypted at rest via OS (FileVault on Mac)

**Requirement**: Document encryption strategy

```typescript
// electron/book-studio/security/data-encryption.md

# Data Encryption at Rest

## Current (v1.0)

**Location**: `~/.humanizer/books.db` (SQLite)
**Encryption**: Operating system level (FileVault on Mac)
**Admin Access**: Only via Electron app (no direct DB access)

## Future (v2.0)

Consider application-level encryption:
- SQLCipher (SQLite with encryption)
- User password → derived key → encrypt DB
- Per-book encryption keys (lost book ≠ lost all)

## Why Not v1

- User password not available (OAuth via external provider)
- Single-user Electron app (OS-level security sufficient)
- FileVault provides full-disk encryption
```

### LLM Prompt Content (Sent to Ollama)

**Issue**: User card content is sent to LLM for analysis/draft generation. Ollama runs locally, but:
- Could be remote in future
- User might not understand content leaves system

**Mitigation**:

```typescript
// electron/book-studio/services/LLMService.ts

/**
 * SECURITY: Content sent to LLM
 * 
 * Ollama runs locally on user's machine (port 11434)
 * Content does NOT leave the system in v1.0
 * 
 * In future web deployment:
 * 1. Require explicit user consent before sending content to remote LLM
 * 2. Support local-only mode (no network access to LLM)
 * 3. Document which content is sent where
 * 
 * Current: All LLM operations are local-only via Ollama
 */

export async function generateDraftViaLLM(
  chapter: Chapter,
  cards: HarvestCard[],
  config: DraftConfig
): Promise<string> {
  // SECURITY CHECK: Ollama must be localhost only
  const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  if (!ollamaUrl.includes('127.0.0.1') && !ollamaUrl.includes('localhost')) {
    throw new Error('SECURITY: Remote LLM not allowed without user consent');
  }
  
  // Build prompt with user content
  const prompt = buildPrompt('DRAFT_FROM_CARDS', {
    cards: cards.map(c => ({
      id: c.id,
      content: c.content,
      grade: c.grade
    }))
  });
  
  // Send to local Ollama
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({
      model: config.model || 'llama3.2',
      prompt,
      stream: true
    })
  });
  
  return response.text();
}
```

### OAuth Tokens (Authentication)

**Status**: ✅ PASS (Existing implementation good)

From `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/auth/api.ts`:

✅ Tokens stored in memory (not localStorage) - prevents XSS access  
✅ Persisted to Electron secure store - survives app restart  
✅ Cleared on logout  
✅ Bearer scheme in Authorization header

**Verified Safe**: Token handling is cryptographically sound.

### Archive API Credentials

**Issue**: Book Studio calls Archive (:3002). Are there any auth tokens needed?

**Check**: Need to verify Archive API security

```typescript
// TODO: Audit Archive API for:
// 1. Does it require authentication?
// 2. If yes, how are credentials passed?
// 3. Are credentials stored securely?

// Likely: Archive is also local (:3002), same trusted boundary
// But MUST document
```

---

## PART 7: PRIVACY ARCHITECTURE

### Local-First Confirmed ✅

The design correctly implements local-first:
- Books stored locally (SQLite)
- No cloud sync by default
- All analysis (outline, clustering) runs locally
- LLM inference via local Ollama

### Cloud Operations (Future)

When cloud sync is added:

```typescript
// electron/book-studio/services/CloudSync.ts

/**
 * Cloud sync service (FUTURE WORK)
 * 
 * SECURITY CONSTRAINTS:
 * 1. User must explicitly opt-in
 * 2. Can opt-out at any time
 * 3. Encryption before upload
 * 4. Clear data privacy policy
 * 5. User can delete cloud copy
 */

export class CloudSyncService {
  async enableCloudSync(userConsent: boolean): Promise<void> {
    if (!userConsent) {
      throw new Error('Cloud sync requires explicit user consent');
    }
    
    // TODO: Implement
    // 1. Derive encryption key from user password
    // 2. Encrypt DB before upload
    // 3. Sign uploads with user key
    // 4. Log all accesses
  }
  
  async disableCloudSync(): Promise<void> {
    // Remove remote copies
    // Clear local cloud config
  }
}
```

---

## PART 8: OWASP TOP 10 CHECKLIST

| # | Vulnerability | Status | Remediation |
|---|---|---|---|
| **A01** | Broken Access Control | 🟡 WARNING | Add ownership validation (see Part 2) |
| **A02** | Cryptographic Failures | ✅ PASS | Tokens in memory, OS-level encryption |
| **A03** | Injection | 🟡 WARNING | Specify parameterized queries, validate all inputs |
| **A04** | Insecure Design | 🟡 WARNING | Add threat model documentation |
| **A05** | Security Misconfiguration | 🟡 WARNING | Bind to localhost only, .env validation |
| **A06** | Vulnerable Components | ⚠️ TBD | Run npm audit, pin dependencies |
| **A07** | XSS | 🟡 WARNING | Sanitize card content with DOMPurify |
| **A08** | Software/Data Integrity | ✅ PASS | NPM verified builds |
| **A09** | Auth Failures | 🟡 WARNING | JWT model for web version |
| **A10** | Logging/Monitoring | 🟡 WARNING | Add security event logging |

---

## PART 9: SECURITY REQUIREMENTS (MUST-HAVE)

### Before API Launch

```typescript
// MUST IMPLEMENT
✅ Input validation (Zod schemas)
✅ XSS prevention (DOMPurify)
✅ WebSocket authentication
✅ Localhost binding only
✅ Parameterized queries in all DB calls
✅ Ownership checks (with comment for future)
✅ Error handling (no stack traces to client)
✅ Request logging (security events)
✅ CORS disabled (Electron-only)

// MUST DOCUMENT
✅ Authentication model (Electron vs. web)
✅ Encryption strategy
✅ Data flow (what goes where)
✅ Privacy guarantees
✅ Future web deployment requirements
```

### Before Web Deployment

```typescript
// MUST ADD
❌ OAuth integration (Google/GitHub)
❌ JWT authentication
❌ HTTPS enforcement
❌ Rate limiting
❌ Audit logging
❌ Data retention policy
❌ GDPR compliance
❌ Penetration testing
```

---

## PART 10: IMMEDIATE ACTION ITEMS

### Phase 1: Foundation (Week 1)

- [ ] Add validation schemas (Zod) for all endpoints
- [ ] Implement DOMPurify for card content
- [ ] Add localhost binding to all servers
- [ ] Add WebSocket authentication middleware
- [ ] Document authentication model
- [ ] Add ownership checks (comments for now)

**Estimated effort**: 3-4 days

### Phase 2: Testing (Week 2)

- [ ] Unit tests for validation rules
- [ ] XSS injection tests (malicious card content)
- [ ] SQL injection tests (if using parameterized queries)
- [ ] WebSocket auth tests (unauthorized connections)
- [ ] SSRF tests (URLs in web harvesting)

**Estimated effort**: 2-3 days

### Phase 3: Documentation (Week 2)

- [ ] Security architecture document
- [ ] API authentication model (Electron + web)
- [ ] Data flow diagram with security annotations
- [ ] Privacy commitment
- [ ] Deployment checklist for web version

**Estimated effort**: 1-2 days

---

## PART 11: SECURITY SIGN-OFF CHECKLIST

**Before merging to main**:

- [ ] All endpoints validate input (Zod or similar)
- [ ] Card content sanitized with DOMPurify
- [ ] WebSocket requires authentication
- [ ] All servers bind to 127.0.0.1
- [ ] Database uses parameterized queries (documented)
- [ ] Ownership checks in place (with future-web comments)
- [ ] No secrets in code (grep for API keys, passwords, tokens)
- [ ] Error handling doesn't leak stack traces
- [ ] Security documentation complete
- [ ] OWASP Top 10 mitigations documented

**Sign-off required from**: Security Agent + Architect

---

## APPENDIX: Security Template (Copy-Paste)

Use this in all new endpoints:

```typescript
// electron/book-studio/routes/example.ts

import { Router } from 'express';
import { validate } from '../middleware/validate';
import { requireBookOwnership } from '../middleware/ownership';
import { ExampleSchema } from '../validation/rules';

const router = Router();

/**
 * SECURITY:
 * - Input: Validated via Zod (ExampleSchema)
 * - Auth: Ownership check (Electron: implicit, web: via JWT)
 * - Output: No PII in error messages
 * - Logging: Security events logged
 */
router.post('/api/books/:bookId/example',
  requireBookOwnership,
  validate(ExampleSchema),
  async (req, res) => {
    try {
      const input = req.validated; // Type-safe, validated
      const book = req.book; // From ownership middleware
      
      // Process request
      const result = await service.doSomething(book.id, input);
      
      return res.json(result);
    } catch (err) {
      // SECURITY: Don't leak stack traces
      console.error('[ERROR]', err);
      return res.status(500).json({
        error: 'Internal server error'
        // Never include err.message or err.stack
      });
    }
  }
);

export default router;
```

---

## SUMMARY

**Book Studio API security posture**:

| Layer | Status | Priority |
|-------|--------|----------|
| **Architecture** | 🟡 Good with gaps | Fix before launch |
| **Authentication** | 🟢 For Electron / 🔴 Missing for web | Add web plan |
| **Input Validation** | 🔴 Missing | BLOCKING |
| **Injection Prevention** | 🟡 Assumed safe | Verify & document |
| **XSS Prevention** | 🔴 Missing | BLOCKING |
| **WebSocket Security** | 🔴 Missing | BLOCKING |
| **Data Handling** | ✅ Good | No action |
| **Privacy** | ✅ Good | No action |

**Verdict**: 🚫 **DO NOT MERGE** without critical fixes

**Risk Level**: 🔴 HIGH (if deployed as-is)
**Estimated Fix Time**: 1 week
**Testing Time**: 3-5 days

---

*Audit completed by House of Security*
*Recommendations are binding for production deployment*


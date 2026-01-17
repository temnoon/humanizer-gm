# BOOK STUDIO API - SECURITY IMPLEMENTATION GUIDE

**Purpose**: Quick reference for developers implementing security fixes

---

## QUICK START (Copy-Paste Code)

### 1. Input Validation Setup (Day 1)

Install dependency:
```bash
npm install zod
```

Create validation schema:
```typescript
// electron/book-studio/validation/schemas.ts
import { z } from 'zod';

export const HarvestRequestSchema = z.object({
  searchResult: z.object({
    id: z.string().min(1).max(255),
    type: z.enum(['message', 'post', 'comment']),
    source: z.enum(['conversation', 'facebook', 'web']),
    content: z.string().min(1).max(50000),
    authorName: z.string().max(255).optional(),
    createdAt: z.number().optional(),
    similarity: z.number().min(0).max(1).optional()
  })
});

export const BookCreateSchema = z.object({
  title: z.string().min(1).max(255).trim(),
  description: z.string().max(2000).optional(),
  targetWordCount: z.number().positive().optional()
});

export const DraftGenerateSchema = z.object({
  strategy: z.enum(['outline-based', 'card-sequence']),
  config: z.object({
    model: z.enum(['llama3.2', 'mistral']),
    temperature: z.number().min(0).max(2).optional()
  }).optional()
});
```

Create validation middleware:
```typescript
// electron/book-studio/middleware/validate.ts
import { z } from 'zod';

export function validate(schema: z.ZodSchema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: err.errors
        });
      }
      res.status(400).json({ error: 'Invalid request' });
    }
  };
}
```

Use in routes:
```typescript
// electron/book-studio/routes/harvest.ts
router.post('/api/books/:id/harvest',
  validate(HarvestRequestSchema),
  async (req, res) => {
    // req.body is now validated
    const card = await harvestService.harvest(req.params.id, req.body);
    res.status(201).json(card);
  }
);
```

### 2. XSS Prevention Setup (Day 1)

Install:
```bash
npm install dompurify
```

Create sanitizer:
```typescript
// electron/book-studio/utils/sanitize.ts
import DOMPurify from 'dompurify';

export function sanitizeCardContent(content: string): string {
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true
  });
}
```

Use when rendering:
```typescript
// In React component
import { sanitizeCardContent } from '@lib/utils/sanitize';

function CardDisplay({ card }) {
  const clean = sanitizeCardContent(card.content);
  return <div dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

### 3. WebSocket Security (Day 2)

Add authentication:
```typescript
// electron/book-studio/ws/auth.ts
export function createWSServer(httpServer) {
  const wss = new ws.Server({ noServer: true });
  
  httpServer.on('upgrade', (req, socket, head) => {
    // Check localhost only (Electron)
    if (!req.headers.origin?.includes('127.0.0.1')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAuthenticated = true;
      wss.emit('connection', ws);
    });
  });
  
  return wss;
}
```

Validate messages:
```typescript
// electron/book-studio/ws/messages.ts
import { z } from 'zod';

const WSMessageSchema = z.object({
  type: z.enum(['subscribe', 'cancel']),
  bookId: z.string().optional(),
  sessionId: z.string().optional()
});

function handleMessage(ws, data) {
  try {
    const msg = WSMessageSchema.parse(JSON.parse(data));
    // Process validated message
  } catch {
    ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
  }
}
```

### 4. Server Binding (Day 1)

Bind all servers to localhost:
```typescript
// electron/book-studio/index.ts
import express from 'express';

const app = express();
const PORT = 3004;

// SECURITY: Bind to localhost only
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Book Studio API running on http://127.0.0.1:${PORT}`);
});

// SECURITY: Verify origin on all requests
app.use((req, res, next) => {
  if (!req.headers.origin?.includes('127.0.0.1')) {
    console.warn(`Rejected request from ${req.headers.origin}`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});
```

### 5. Database Queries (Day 2)

Use parameterized queries:
```typescript
// CORRECT ✅
const db = require('better-sqlite3')('books.db');
const stmt = db.prepare('SELECT * FROM books WHERE id = ?');
const book = stmt.get(bookId);

const stmt2 = db.prepare('SELECT * FROM harvest_cards WHERE book_id = ? AND status = ?');
const cards = stmt2.all(bookId, 'staging');

// WRONG ❌ - NEVER DO THIS
const book = db.exec(`SELECT * FROM books WHERE id = '${bookId}'`);
```

---

## TESTING CHECKLIST

Run these tests before submitting PR:

```bash
# XSS Test - Card content with script
curl -X POST http://localhost:3004/api/books/book-1/harvest \
  -H "Content-Type: application/json" \
  -d '{
    "searchResult": {
      "id": "1",
      "type": "message",
      "source": "test",
      "content": "<img src=x onerror=\"alert(1)\">"
    }
  }'
# Expected: Script removed from content

# Validation Test - Invalid input
curl -X POST http://localhost:3004/api/books \
  -H "Content-Type: application/json" \
  -d '{"title": 123}'
# Expected: 400 Bad Request

# WebSocket Test - Unauthorized connection
wscat -c ws://external-ip:3004/ws
# Expected: Connection rejected
```

---

## SECURITY AUDIT CHECKLIST

Before launch:

- [ ] All POST/PUT endpoints validate input
- [ ] Card content sanitized with DOMPurify
- [ ] All servers bind to 127.0.0.1 only
- [ ] Database uses parameterized queries
- [ ] WebSocket requires origin check
- [ ] No hardcoded secrets (grep -r "password\|api_key\|secret")
- [ ] Error messages don't leak implementation details
- [ ] Logging captures security events

---

## COMMON MISTAKES TO AVOID

```typescript
// ❌ WRONG: String concatenation in SQL
db.run(`INSERT INTO books VALUES ('${id}', '${title}')`)

// ✅ CORRECT: Parameterized
db.run('INSERT INTO books VALUES (?, ?)', [id, title])

// ❌ WRONG: Unsanitized HTML
<div dangerouslySetInnerHTML={{ __html: card.content }} />

// ✅ CORRECT: Sanitized
<div dangerouslySetInnerHTML={{ __html: sanitizeCardContent(card.content) }} />

// ❌ WRONG: No input validation
app.post('/api/books', (req, res) => {
  const book = await db.create(req.body); // req.body could be anything
})

// ✅ CORRECT: Validated
app.post('/api/books', validate(BookSchema), (req, res) => {
  const book = await db.create(req.body); // req.body is now validated
})

// ❌ WRONG: No auth on WebSocket
const wss = new ws.Server({ port: 3004 });

// ✅ CORRECT: With auth
httpServer.on('upgrade', (req, socket, head) => {
  if (!isLocalhost(req)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, cb);
});
```

---

## PERFORMANCE NOTES

- Zod validation: ~1ms per request
- DOMPurify sanitization: ~10ms per card (minimal)
- WebSocket auth check: ~0.1ms per connection
- Overall overhead: Negligible for user experience

---

**Total implementation time: 3-4 days**


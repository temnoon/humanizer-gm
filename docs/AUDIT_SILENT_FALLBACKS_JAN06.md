# URGENT AUDIT REPORT: Silent Fallback Patterns in Book-Making Operations

**Date**: January 6, 2026  
**Status**: CRITICAL - Multiple Silent Degradation Patterns Found  
**Severity**: HIGH - Data Loss and User Deception Risk

---

## Executive Summary

Found **7 critical patterns** where book-making operations silently degrade data quality or fail without proper user notification. The most dangerous pattern: semantic search silently falls back to text search and returns results WITHOUT message content, which harvest operations then save as broken passages.

---

## CRITICAL FINDINGS

### 1. **SEARCH FALLBACK WITHOUT DATA DISCLOSURE** (CRITICAL)

**File**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/aui/tools.ts`  
**Lines**: 969-1008  
**Severity**: CRITICAL

**The Offense**:
```typescript
// Line 969: If semantic search fails...
if (!response.ok) {
  // Line 970-971: Silently fall back to text search
  const fallbackResponse = await fetch(
    `${archiveServer}/api/conversations?search=${encodeURIComponent(query)}&limit=${limit}`
  );

  if (fallbackResponse.ok) {
    const data = await fallbackResponse.json();
    // Line 979-988: Map text search results
    // PROBLEM: Text search returns CONVERSATION METADATA ONLY
    const textResults = (data.conversations || []).slice(0, limit).map((c: {
      id: string;
      title: string;
      folder: string;
      message_count: number;
      created_at: number;
    }) => ({
      id: c.id,
      conversationId: c.id,
      title: c.title,
      content: `[Conversation: ${c.title}] - Use semantic search for full message content`, // FAKE CONTENT!
      folder: c.folder,
      messageCount: c.message_count,
      created: c.created_at,
      similarity: 0.5,  // FAKE SCORE - doesn't indicate quality
    }));

    // Returns "success: true" even though data is degraded
    return {
      success: true,
      message: `Found ${data.conversations?.length || 0} conversations (text search)`, // User never knows it's text
      data: {
        results: textResults,
        searchType: 'text', // Only hint that something is different
      },
    };
  }
}
```

**What's Wrong**:
1. **Data loss**: Text search returns conversation metadata without actual message content
2. **Fake content field**: Returns placeholder text instead of real message content
3. **Silent degradation**: Returns `success: true` with degraded data
4. **Fake similarity score**: Sets `similarity: 0.5` for all results - meaningless
5. **Harvest vulnerability**: When user harvests these results, they get empty/broken passages

**Where it Breaks Harvest**:
- User runs `search_archive` when embeddings are unavailable
- Gets results marked as text search (may not notice)
- Approves passages and clicks "Stage" → "Commit"
- Passages saved to book have title but NO actual content
- User discovers empty chapters in book later

**What User Should See Instead**:
```
❌ Archive search failed. Semantic search requires embeddings to be built.

Actions:
1. Click "Build Embeddings" to index your archive
2. Once complete, semantic search will work
3. For now, manually browse conversations in the Archive panel

Text-based conversation search is NOT AVAILABLE (would return empty results)
```

---

### 2. **QUERY FAILURE SILENT SKIP IN HARVEST LOOP** (HIGH)

**File**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/aui/tools.ts`  
**Lines**: 3907-3955  
**Severity**: HIGH

**The Offense**:
```typescript
for (const query of queries) {
  try {
    const response = await fetch(`${archiveServer}/api/embeddings/search/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: resultsPerQuery * 2 }),
    });

    // Line 3915: If query fails, silently continue
    if (!response.ok) continue;  // ← PROBLEM: User never knows this query failed

    const data = await response.json();
    const results = (data.results || [])
      .filter((r: { similarity: number }) => r.similarity >= minSimilarity)
      .slice(0, resultsPerQuery);

    // Add candidates...
  } catch (e) {
    // Line 3953: Warns to console but operation continues
    console.warn(`[harvest_for_thread] Query "${query}" failed:`, e);
    // ← No error surfaced to user, no indication in harvest bucket
  }
}

// Line 3968: User sees success even if some/all queries failed
return {
  success: true,
  message: `Harvested ${totalCandidates} passages from ${queries.length} queries`,
  // ← No indication of which queries failed
};
```

**What's Wrong**:
1. **Silent query failure**: If a query fails, user doesn't know
2. **Misleading success**: Reports "harvested from X queries" without saying some failed
3. **Inconsistent results**: User expects passages from all queries, gets partial results
4. **No failure tracking**: User can't see which queries worked/failed

**Example User Experience**:
```
User: "I want to harvest passages about 'consciousness', 'identity', and 'language'"
System: "Harvested 15 passages from 3 queries" ✓

Behind the scenes:
- Query 1 "consciousness": SUCCESS (5 passages) ✓
- Query 2 "identity": TIMEOUT/ERROR (silently skipped)
- Query 3 "language": SUCCESS (10 passages) ✓

Result: User has NO passages about "identity" but doesn't know why
```

**What User Should See**:
```
Harvested 15 passages from 3 queries:

✓ "consciousness" - 5 passages
⚠️ "identity" - FAILED (timeout)
✓ "language" - 10 passages

Failed queries should be retried or user notified
```

---

### 3. **QUERY FAILURE IN PYRAMID SEARCH** (HIGH)

**File**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/aui/tools.ts`  
**Lines**: 4223-4258  
**Severity**: HIGH

**The Offense**:
```typescript
for (let i = 0; i < queries.length; i++) {
  const query = queries[i];
  const response = await fetch(
    `${archiveServer}/api/embeddings/search/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        limit: Math.ceil(limit / queries.length) * 2,
      }),
    }
  );

  // Line 4234: If query fails, silently skip
  if (response.ok) {
    const data = await response.json();
    const results = data.results || [];

    for (const r of results) {
      // Skip duplicates and add...
      if (!allResults.some(ar => ar.message_id === r.message_id)) {
        allResults.push({
          id: r.id || r.message_id,
          content: r.content,
          similarity: r.similarity,
          // ...
        });
      }
    }
  }
  // ← If response NOT ok, NO error, NO warning, NO user notification
}

// Line 4345: User sees success regardless of failures
return {
  success: true,
  message: `Traced "${theme}" arc: found ${arcResults.length} passages across ${phases.size} phases`,
  // ← No indication that some queries failed
};
```

**What's Wrong**:
1. **Silent skip with NO logging**: Not even `console.warn` like harvest loop
2. **Degraded arc**: Returns partial arc structure without indicating missing phases
3. **User expects consistency**: Narrative arc should have expected phases, not missing ones

**What User Should See**:
```
Traced "consciousness" arc: found 12 passages across 3/5 expected phases

⚠️ DEGRADATION WARNING:
- Beginning phase: SUCCESS (3 passages)
- Early phase: FAILED (server error)
- Middle phase: SUCCESS (4 passages)
- Development phase: FAILED (no results)
- Conclusion phase: SUCCESS (5 passages)

Some phases missing. Try different search terms or rebuild embeddings.
```

---

### 4. **PARSE ERROR SWALLOWED IN TOOL EXECUTION** (MEDIUM)

**File**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/aui/tools.ts`  
**Lines**: 196-207  
**Severity**: MEDIUM

**The Offense**:
```typescript
try {
  const params = JSON.parse(paramsStr);
  // ...
} catch (e) {
  // Line 206: Warns to console but silently drops malformed tool
  console.warn('Failed to parse tool JSON:', paramsStr, e);
  // ← Tool is never executed, user doesn't know
  // Continue to next tool without error
}
```

**What's Wrong**:
1. **Silently dropped**: Tool invocation is lost without user knowledge
2. **No error context**: User doesn't know which tool failed to parse
3. **Continues processing**: Next tools execute as if nothing went wrong

---

### 5. **DRAFT GENERATION FALLBACK WITHOUT DISCLOSURE** (HIGH)

**File**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/aui/tools.ts`  
**Lines**: 3240-3264  
**Severity**: HIGH

**The Offense**:
```typescript
if (!llmResponse.ok) {
  // Line 3241-3242: If LLM fails, fallback to concatenation
  const fallbackContent = `# ${chapterTitle}\n\n${sourcePas.map(p => p.content).join('\n\n')}`;

  const chapter = context.createChapter(chapterTitle, fallbackContent);
  if (!chapter) {
    return { success: false, error: 'Failed to create chapter' };
  }

  return {
    success: true, // ← Returns success even though LLM failed
    message: `Created draft chapter "${chapterTitle}" (passages concatenated - LLM unavailable)`,
    data: {
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      wordCount: chapter.wordCount,
      passageCount: sourcePas.length,
      mode: 'fallback', // ← Only hint that something is different
    },
  };
}
```

**What's Wrong**:
1. **Degraded quality returned as success**: Concatenated passages ≠ coherent chapter
2. **User may not notice**: `mode: 'fallback'` is easily missed in data object
3. **No quality warning**: Should emphasize manual revision needed

**What User Should See**:
```
❌ LLM generation failed. Chapter created from raw passages (no coherence).

⚠️ WARNING: This chapter needs heavy editing:
- Passages are concatenated, not woven
- No transitions between sections
- May have duplicate content

Recommended actions:
1. Review chapter in book editor
2. Add transitions and smooth flow
3. Check for duplicate passages
4. Consider rephrasing for readability
```

---

### 6. **HEALTH CHECK DOESN'T PREVENT FAILED OPERATIONS** (MEDIUM)

**File**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/aui/tools.ts`  
**Lines**: 1080-1130  
**Severity**: MEDIUM

**The Offense**:
```typescript
async function executeCheckArchiveHealth(): Promise<AUIToolResult> {
  try {
    const archiveServer = await getArchiveServerUrl();
    const response = await fetch(`${archiveServer}/api/embeddings/health`);

    if (!response.ok) {
      // Line 1085-1086: Returns error but doesn't explain what to do
      return { success: false, error: 'Health check failed' };
    }

    const health = await response.json();
    
    // Returns status but user must manually check before operations
    return {
      success: true,
      message: statusParts.join(' '),
      data: health,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Health check failed',
    };
  }
}
```

**What's Wrong**:
1. **Reactive, not preventive**: Health check is separate from operations
2. **User can ignore warnings**: Nothing prevents running operations on unhealthy archive
3. **No pre-flight checks**: Search, harvest, etc. don't check health first

---

### 7. **ASYNC HARVEST IN BACKGROUND SETS NO CALLBACKS** (HIGH)

**File**: `/Users/tem/humanizer_root/humanizer-gm/electron/archive-server/routes/embeddings.ts`  
**Lines**: 76-134  
**Severity**: HIGH

**The Offense**:
```typescript
router.post('/build', async (req: Request, res: Response) => {
  try {
    // ...
    // Line 103: Respond immediately
    res.json({
      status: 'started',
      message: 'Embedding index build started',
      archiveServer,
    });

    // Line 121: Start indexing in background
    indexer.buildIndex(options)
      .then(() => {
        console.log('[embeddings] Index build complete');
        // ← No callback to notify frontend
      })
      .catch((err) => {
        console.error('[embeddings] Index build failed:', err);
        // Line 125-133: Error is only in console, not propagated
        indexingProgress = {
          status: 'error',
          phase: 'failed',
          current: 0,
          total: 0,
          error: err instanceof Error ? err.message : String(err),
        };
        // ← User must manually poll /api/embeddings/status to find errors
      });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

**What's Wrong**:
1. **Errors hidden in background**: Indexing fails silently, user doesn't know
2. **Polling required**: Frontend must repeatedly check status to find errors
3. **No error notifications**: User won't know about failures unless explicitly checking

---

## ROOT CAUSE ANALYSIS

These patterns exist because:

1. **No unified error handling strategy**: Each tool handles errors differently
2. **Silent fallbacks prioritized**: Better to return something than error
3. **Harvest operations disconnected from status**: Results don't indicate data quality
4. **User deception pattern**: Marking degraded operations as "success"

---

## RISK MATRIX

| Pattern | Risk | Impact | Frequency |
|---------|------|--------|-----------|
| Search fallback with fake content | CRITICAL | User saves empty passages | High - runs on every failed search |
| Query failure silent skip | HIGH | Incomplete harvest/arc | Medium - when archive fails |
| Parse error swallowed | MEDIUM | Lost tool invocations | Low - rare parse failures |
| Draft generation fallback | HIGH | Poor chapter quality | Medium - on LLM failure |
| Health check reactive | MEDIUM | User doesn't know archive is broken | High - users operate blind |
| Background error hiding | HIGH | User doesn't know indexing failed | High - runs every session |
| Pyramid query skip | HIGH | Incomplete narrative arcs | Medium - during arc tracing |

---

## IMMEDIATE FIXES NEEDED

### Priority 1: Search Fallback (BLOCKING)

**Location**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/aui/tools.ts:969-1008`

**Change**: Remove silent fallback. If semantic search fails:

```typescript
if (!response.ok) {
  // DO NOT fall back to text search silently
  // Inform user clearly
  
  const archiveServer = await getArchiveServerUrl();
  
  // Check if embeddings exist
  const healthCheck = await fetch(`${archiveServer}/api/embeddings/health`);
  const health = healthCheck.ok ? await healthCheck.json() : null;
  
  // Provide specific guidance
  if (health?.issues.length > 0 && health.issues.some((i: string) => i.includes('embeddings'))) {
    return {
      success: false,
      error: 'Semantic search requires embeddings to be built first',
      teaching: {
        whatHappened: 'Cannot search without embeddings',
        guiPath: ['Archive panel', 'Explore tab', 'Click "Build Embeddings"'],
        why: 'Embeddings convert conversations to semantic vectors for meaning-based search',
      },
    };
  }
  
  // Generic network error
  return {
    success: false,
    error: 'Archive search unavailable. Check that archive server is running.',
  };
}
```

### Priority 2: Harvest Query Tracking

**Location**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/aui/tools.ts:3907-3955`

**Change**: Track query results:

```typescript
const queryResults = new Map<string, { success: boolean; count: number; error?: string }>();

for (const query of queries) {
  try {
    const response = await fetch(...);

    if (!response.ok) {
      queryResults.set(query, { success: false, count: 0, error: 'Search failed' });
      continue;
    }

    const data = await response.json();
    const results = (data.results || []).filter(...).slice(...);
    
    queryResults.set(query, { success: true, count: results.length });

    for (const result of results) {
      // ...add candidates
    }
  } catch (e) {
    queryResults.set(query, { 
      success: false, 
      count: 0, 
      error: e instanceof Error ? e.message : 'Unknown error'
    });
  }
}

// Report query-level results
const failedQueries = Array.from(queryResults.entries())
  .filter(([, r]) => !r.success);

if (failedQueries.length > 0) {
  return {
    success: totalCandidates > 0, // Partial success if any queries worked
    message: `Harvested ${totalCandidates} passages. ${failedQueries.length} queries failed:`,
    data: {
      bucketId: bucket.id,
      candidateCount: totalCandidates,
      queries,
      status: 'reviewing',
      stats: updatedBucket?.stats,
      // ← ADD THIS:
      queryResults: Object.fromEntries(queryResults),
      failedQueries: failedQueries.map(([q, r]) => ({ query: q, error: r.error })),
    },
  };
}
```

### Priority 3: Pre-flight Health Checks

**Location**: All search/harvest tools

**Change**: Add pre-flight checks before expensive operations:

```typescript
async function executeSearchArchive(params: Record<string, unknown>): Promise<AUIToolResult> {
  const { query, limit = 10 } = params as { query?: string; limit?: number };

  if (!query) {
    return { success: false, error: 'Missing query parameter' };
  }

  try {
    const archiveServer = await getArchiveServerUrl();
    
    // NEW: Pre-flight check
    const healthResponse = await fetch(`${archiveServer}/api/embeddings/health`);
    if (!healthResponse.ok) {
      return {
        success: false,
        error: 'Archive health check failed',
      };
    }
    
    const health = await healthResponse.json();
    if (!health.ready) {
      // Tell user specifically what's wrong
      if (health.issues.includes('No embeddings generated')) {
        return {
          success: false,
          error: 'Semantic search requires embeddings. Run "Build Embeddings" first.',
          data: { issues: health.issues },
        };
      }
      
      return {
        success: false,
        error: health.issues.join('; '),
        data: { actions: health.actions },
      };
    }
    
    // NOW proceed with search...
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Search failed' };
  }
}
```

---

## Verification Checklist

After fixes:

- [ ] Search failure shows explicit error (no fallback)
- [ ] Harvest reports per-query results
- [ ] Narrative arc tracing shows phase coverage
- [ ] Draft generation indicates "generated" vs "concatenated"
- [ ] All background tasks report completion/failure
- [ ] Health check blocks operations if unhealthy
- [ ] Error messages guide user to resolution

---

## Architect Signoff

This audit reveals systematic blind spots in error handling. The pattern: prioritize returning results over accuracy, leave user uncertain about data quality.

**Recommendation**: Implement unified error response format across all tools:

```typescript
interface ToolError {
  code: 'MISSING_PREREQ' | 'SERVICE_ERROR' | 'PARTIAL_FAILURE' | 'DEGRADATION';
  message: string;
  details?: {
    failedComponent?: string;
    retryable?: boolean;
    suggestedAction?: string;
  };
}

interface ToolSuccess {
  mode: 'full' | 'partial' | 'degraded'; // Be explicit
  resultQuality?: 'complete' | 'incomplete' | 'synthetic';
  warnings?: string[];
}
```

This ensures the user is ALWAYS informed about data quality.

---

**Status**: Ready for immediate fixes  
**Blocking**: YES - Multiple patterns cause data loss in harvest workflow  
**Owner**: Book-Making Operations review required


# Handoff: OAuth + Queue Pipeline Complete

**Date**: December 30, 2025
**Branch**: `feature/subjective-intentional-constraint`
**Status**: WORKING - OAuth functional, Queue UI complete

---

## Session Accomplishments

### 1. OAuth Authentication for Electron (WORKING)

Successfully implemented OAuth flow that returns to the running Electron app:

**Development Mode**: Localhost HTTP callback server
- Auto-starts on random port when app launches
- Receives OAuth callback, sends token via IPC
- Shows "Login Successful!" page in browser

**Production Mode**: Custom protocol `humanizer://auth/callback`
- Registered via `app.setAsDefaultProtocolClient`
- Single instance lock ensures URL goes to running app

**Files Modified**:
| File | Changes |
|------|---------|
| `electron/main.ts` | OAuth callback server, single instance lock, protocol handler |
| `electron/preload.ts` | `auth.getCallbackPort()`, `auth.onOAuthCallback()` |
| `apps/web/src/lib/auth/api.ts` | Async URL generation, localhost vs protocol routing |
| `apps/web/src/lib/auth/AuthContext.tsx` | Electron callback listener |

### 2. Queue Tab UI (COMPLETE)

Full batch processing queue interface:

**Components Created** (`apps/web/src/components/queue/`):
- `QueueTab.tsx` - Main container
- `BatchJobForm.tsx` - Job submission with drag/drop
- `JobProgressCard.tsx` - Real-time progress
- `JobHistoryList.tsx` - Completed/failed jobs
- `AgentProposalCard.tsx` - Agent proposal approval

### 3. Job Handlers (COMPLETE)

**Handlers Created** (`electron/queue/handlers/`):
- `pdf.ts` - PDF extraction via pdf-parse
- `audio.ts` - Whisper transcription
- `humanize.ts` - Batch humanization via NPE API

### 4. Legacy Cleanup (COMPLETE)

- Removed `archiveServerProcess` dead code
- Removed `TOKEN_KEY_COMPAT` (narrative-studio compatibility)
- Removed `ChildProcess` unused import

---

## Known Issues / Minor UX Items

1. **Login modal stays open after OAuth success** - User must manually dismiss it after successful OAuth login. The token is received and user is logged in, but the UI doesn't auto-close the login prompt.

2. **Pre-existing TypeScript error** in `apps/web/src/lib/archive/service.ts:313` - Type mismatch with `ContainerMessage[]`. Unrelated to this work.

---

## Code NOT YET TESTED

### Queue Tab Components
- `QueueTab.tsx` - Needs testing with actual jobs
- `BatchJobForm.tsx` - File drag/drop, job submission
- `JobProgressCard.tsx` - Progress display
- `JobHistoryList.tsx` - History display
- `AgentProposalCard.tsx` - Proposal approve/reject

### Job Handlers
- `electron/queue/handlers/pdf.ts` - Requires `npm install pdf-parse`
- `electron/queue/handlers/audio.ts` - Requires whisper module
- `electron/queue/handlers/humanize.ts` - Requires NPE API

### OAuth Production Mode
- Custom protocol `humanizer://` - Only tested in dev mode
- Will need testing with packaged app build

---

## Architecture Summary

### OAuth Flow (Development)
```
Renderer → getOAuthCallbackPort() → main.ts
         → openOAuthExternal() → browser opens
         → Google/GitHub/Discord auth
         → npe-api redirects to http://127.0.0.1:PORT/auth/callback
         → main.ts callback server receives
         → IPC 'auth:oauth-callback' → renderer
         → AuthContext stores token, fetches user
```

### Archive Server
- 100% embedded in `electron/archive-server/`
- No dependency on narrative-studio/archive-server.js
- Starts automatically on port 3002 (or free port in prod)

### NPE-Local Server
- Embedded in `electron/npe-local/`
- AI detection, transformations
- Port 3003 (or free port in prod)

---

## Quick Start After Restart

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev
```

Console should show:
- `[OAuth] Callback server listening on http://127.0.0.1:XXXXX`
- Archive server on 3002
- NPE-Local on 3003

---

## Files Reference

### OAuth Implementation
- `electron/main.ts:790-935` - OAuth callback server + protocol
- `electron/preload.ts:478-488` - Auth API exposure
- `apps/web/src/lib/auth/api.ts:145-208` - URL generation
- `apps/web/src/lib/auth/AuthContext.tsx:113-149` - Callback listener

### Queue Implementation
- `apps/web/src/components/queue/*` - All queue UI
- `electron/queue/handlers/*` - Job handlers
- `electron/queue/types.ts` - Result types

---

**End of Handoff**

# Handoff: OAuth Deep Link Implementation

**Date**: December 30, 2025
**Branch**: `feature/subjective-intentional-constraint`
**Status**: COMPLETE (v2 - with localhost callback for dev)

---

## Summary

Implemented proper OAuth authentication flow for the Electron desktop app:
- **Development**: Uses localhost HTTP callback server (port auto-assigned)
- **Production**: Uses custom protocol `humanizer://auth/callback`

Users can now authenticate via Google/GitHub/Discord and the callback automatically returns to the Humanizer app.

---

## Problem Solved

**Before**: OAuth in Electron opened browser → redirected to `studio.humanizer.com` → user stuck there with message "copy your auth token from Settings" (terrible UX)

**After**: OAuth opens browser → user authenticates → callback uses `humanizer://auth/callback` → Electron receives token → user logged in automatically

---

## Implementation

### 1. Custom Protocol Registration (`electron/main.ts`)
- Registered `humanizer://` as default protocol client
- Added `open-url` event handler to process OAuth callbacks
- Parses `humanizer://auth/callback?token=xxx&isNewUser=false`
- Sends token to renderer via IPC `auth:oauth-callback`

### 2. Preload Bridge (`electron/preload.ts`)
- Added `auth.onOAuthCallback()` listener to electronAPI
- Returns unsubscribe function for cleanup

### 3. OAuth URL Generation (`apps/web/src/lib/auth/api.ts`)
- Updated `getOAuthLoginUrl()` to use `humanizer://auth/callback` for Electron
- Web flow unchanged: uses `window.location.origin/auth/callback`

### 4. Auth Context (`apps/web/src/lib/auth/AuthContext.tsx`)
- Added useEffect to listen for Electron OAuth callback
- Stores token, fetches user, executes pending actions
- Removed ugly "copy your token" error message

### 5. Legacy Cleanup
- Removed `archiveServerProcess` variable (never used)
- Removed `ChildProcess` import
- Removed `TOKEN_KEY_COMPAT` (narrative-studio compatibility)

---

## Files Modified

| File | Changes |
|------|---------|
| `electron/main.ts` | Protocol registration, open-url handler, removed legacy |
| `electron/preload.ts` | Added auth.onOAuthCallback |
| `apps/web/src/lib/auth/api.ts` | Custom protocol redirect, removed TOKEN_KEY_COMPAT |
| `apps/web/src/lib/auth/AuthContext.tsx` | Electron callback listener, better UX |

---

## OAuth Flow

### Development Mode (localhost callback)
```
1. User clicks "Login with Google" in Humanizer app
2. Electron starts localhost callback server on random port (e.g., 54321)
3. Opens browser: https://npe-api.../auth/oauth/google/login?redirect=http://127.0.0.1:54321/auth/callback
4. User authenticates with Google
5. npe-api redirects to: http://127.0.0.1:54321/auth/callback?token=JWT
6. Localhost server receives token, sends to renderer via IPC
7. Browser shows "Login Successful!" page
8. React stores token, fetches user, updates UI
9. User is logged in!
```

### Production Mode (custom protocol)
```
1. User clicks "Login with Google" in Humanizer app
2. Opens browser: https://npe-api.../auth/oauth/google/login?redirect=humanizer://auth/callback
3. User authenticates with Google
4. npe-api redirects to: humanizer://auth/callback?token=JWT
5. macOS opens Humanizer.app via protocol handler
6. Electron parses URL, sends token to renderer via IPC
7. React stores token, fetches user, updates UI
8. User is logged in!
```

---

## Testing

```bash
# Start the app
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Click login button
# Browser opens for OAuth
# Complete authentication
# App should automatically receive token and log you in
```

---

## Known Requirements

1. **macOS Only**: The `open-url` handler is macOS-specific. Windows/Linux would need `second-instance` event handling (not implemented).

2. **Protocol Registration**: First run may prompt for permission to register the protocol.

3. **Production Build**: Protocol works best in packaged app. In development, uses `process.execPath` workaround.

---

## Next Steps (Optional)

1. Add Windows/Linux support via `second-instance` event
2. Add loading indicator while waiting for OAuth callback
3. Add timeout handling if callback never received

---

**End of Handoff**

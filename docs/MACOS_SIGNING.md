# macOS Code Signing & Notarization Guide

## Quick Start

### 1. Install the notarization package
```bash
cd ~/humanizer_root/humanizer-gm
npm install --save-dev @electron/notarize
```

### 2. Set up your Developer ID certificate

If you don't have one already:

```bash
# Check existing certificates
security find-identity -v -p codesigning
```

If no "Developer ID Application" certificate appears:
1. Open **Xcode → Settings → Accounts**
2. Select your Apple ID
3. Click **Manage Certificates**
4. Click **+** and create **Developer ID Application**

### 3. Get your Team ID

1. Go to [developer.apple.com/account](https://developer.apple.com/account)
2. Find **Team ID** in your membership details (10 characters like `ABC1234567`)

### 4. Create an app-specific password

⚠️ **Important**: You cannot use your Apple ID password for notarization!

1. Go to [appleid.apple.com/account/manage](https://appleid.apple.com/account/manage)
2. Sign in
3. Under **Sign-In and Security**, click **App-Specific Passwords**
4. Click **Generate** 
5. Name it "Humanizer Notarization"
6. Copy the generated password (format: `xxxx-xxxx-xxxx-xxxx`)

### 5. Store your credentials

Create a credentials file (keep this private!):

```bash
cat > ~/.humanizer-credentials << 'EOF'
export APPLE_ID="your.email@example.com"
export APPLE_TEAM_ID="ABC1234567"
export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"
EOF

chmod 600 ~/.humanizer-credentials
```

### 6. Build!

```bash
# Make the script executable
chmod +x scripts/build-mac.sh

# Build for local testing (no notarization)
./scripts/build-mac.sh

# Build for distribution (with notarization)
./scripts/build-mac.sh --notarize
```

## What Happens During Build

1. **Web app builds** → `apps/web/dist/`
2. **Electron compiles** → `dist-electron/`
3. **electron-builder packages** → Creates `.app` bundle
4. **Code signing** → Signs with your Developer ID certificate
5. **Notarization** (if enabled):
   - Uploads to Apple servers
   - Apple scans for malware (5-15 minutes)
   - Staples notarization ticket to app
6. **DMG creation** → Final distributable

## Troubleshooting

### "The app is damaged and can't be opened"
Your app isn't signed or notarized. Run with `--notarize`.

### "Developer cannot be verified"
Same issue - needs notarization.

### Notarization fails with "credentials" error
- Double-check APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD
- Make sure you're using an **app-specific password**, not your Apple ID password
- Verify your Team ID at developer.apple.com

### Notarization fails with "not signed" error
```bash
# Check if app is signed
codesign --verify --deep --strict --verbose=2 release/mac-arm64/Humanizer.app

# List your signing identities
security find-identity -v -p codesigning
```

### "No identity found" during build
You need to create a Developer ID Application certificate (Step 2 above).

### Native modules (better-sqlite3) fail to sign
The `signIgnore` option in electron-builder.json handles this. If you still have issues:
```bash
# Rebuild native modules for electron
npm rebuild better-sqlite3 --runtime=electron --target=33.0.0 --arch=arm64
```

## Manual Verification

After building, verify everything is correct:

```bash
# Check code signature
codesign -dv --verbose=4 release/mac-arm64/Humanizer.app

# Check notarization
spctl --assess --type open --context context:primary-signature release/mac-arm64/Humanizer.app

# Check DMG
spctl --assess --type open release/Humanizer-1.0.0-arm64.dmg
```

Expected output for notarized app: `accepted`

## CI/CD Setup (GitHub Actions)

```yaml
# .github/workflows/build-mac.yml
name: Build macOS

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Import certificate
        env:
          CERTIFICATE_BASE64: ${{ secrets.APPLE_CERTIFICATE_BASE64 }}
          CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
        run: |
          echo $CERTIFICATE_BASE64 | base64 --decode > certificate.p12
          security create-keychain -p "" build.keychain
          security default-keychain -s build.keychain
          security unlock-keychain -p "" build.keychain
          security import certificate.p12 -k build.keychain -P "$CERTIFICATE_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "" build.keychain
          
      - name: Build and notarize
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          APPLE_APP_PASSWORD: ${{ secrets.APPLE_APP_PASSWORD }}
        run: npm run electron:build
        
      - name: Upload DMG
        uses: actions/upload-artifact@v4
        with:
          name: Humanizer-macOS
          path: release/*.dmg
```

## Files Modified

- `electron-builder.json` - Added `afterSign` hook
- `scripts/notarize.js` - Notarization logic (NEW)
- `scripts/build-mac.sh` - Convenience build script (NEW)

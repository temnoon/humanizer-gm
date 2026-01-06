/**
 * Notarization script for macOS
 * 
 * This script runs after code signing (afterSign hook) and submits
 * the app to Apple for notarization.
 * 
 * Required environment variables:
 *   APPLE_ID          - Your Apple ID email
 *   APPLE_TEAM_ID     - Your 10-character Team ID (from developer.apple.com)
 *   APPLE_APP_PASSWORD - App-specific password (NOT your Apple ID password)
 * 
 * To create an app-specific password:
 *   1. Go to https://appleid.apple.com/account/manage
 *   2. Sign in and go to "App-Specific Passwords"
 *   3. Generate a new password for "Humanizer Notarization"
 *   4. Save it securely
 */

const { notarize } = require('@electron/notarize');
const path = require('path');

async function notarizeApp(context) {
  // Skip notarization for non-macOS builds
  if (context.electronPlatformName !== 'darwin') {
    console.log('Skipping notarization - not macOS');
    return;
  }

  // Skip if explicitly disabled or environment variables not set
  if (process.env.SKIP_NOTARIZE === 'true') {
    console.log('⚠️  Skipping notarization - SKIP_NOTARIZE is set');
    return;
  }

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.log('⚠️  Skipping notarization - credentials not configured');
    console.log('   Set APPLE_ID, APPLE_TEAM_ID, and APPLE_APP_PASSWORD to enable');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(
    context.appOutDir,
    `${appName}.app`
  );

  console.log(`\n🍎 Notarizing ${appName}...`);
  console.log(`   App path: ${appPath}`);
  console.log(`   Apple ID: ${process.env.APPLE_ID}`);
  console.log(`   Team ID: ${process.env.APPLE_TEAM_ID}`);

  const startTime = Date.now();

  try {
    await notarize({
      tool: 'notarytool',
      appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    });

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`✅ Notarization complete! (took ${duration} minutes)`);
  } catch (error) {
    console.error('❌ Notarization failed:', error.message);
    
    // Provide helpful error messages
    if (error.message.includes('credentials')) {
      console.error('\n   Check your APPLE_ID, APPLE_APP_PASSWORD, and APPLE_TEAM_ID');
      console.error('   Make sure you\'re using an app-specific password, not your Apple ID password');
    }
    if (error.message.includes('not signed')) {
      console.error('\n   The app must be signed with a Developer ID certificate');
      console.error('   Run: security find-identity -v -p codesigning');
    }
    
    throw error;
  }
}

module.exports = notarizeApp;

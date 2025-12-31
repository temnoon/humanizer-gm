/**
 * Device Profile Detection
 *
 * Auto-detects device capabilities to select appropriate memory tier.
 * Uses system RAM as primary indicator:
 *   - <8GB:  tiny tier (very constrained, llama3.2:1b)
 *   - 8-16GB: standard tier (balanced, llama3.2:3b)
 *   - >16GB: full tier (no constraints)
 */

import * as os from 'os';
import type { DeviceProfile, MemoryTier } from './types';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** RAM threshold for tiny tier (anything below this) */
const TINY_THRESHOLD_GB = 8;

/** RAM threshold for standard tier (between tiny and this) */
const STANDARD_THRESHOLD_GB = 16;

/** Cache duration for device profile (1 hour) */
const CACHE_DURATION_MS = 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

let cachedProfile: DeviceProfile | null = null;
let userOverrideProfile: Partial<DeviceProfile> | null = null;

// ═══════════════════════════════════════════════════════════════════
// DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Detect memory tier based on system RAM
 */
function detectTier(ramGB: number): MemoryTier {
  if (ramGB < TINY_THRESHOLD_GB) {
    return 'tiny';
  } else if (ramGB < STANDARD_THRESHOLD_GB) {
    return 'standard';
  } else {
    return 'full';
  }
}

/**
 * Get system RAM in GB
 */
function getSystemRAM(): number {
  const totalBytes = os.totalmem();
  const totalGB = totalBytes / (1024 * 1024 * 1024);
  // Round to 1 decimal place
  return Math.round(totalGB * 10) / 10;
}

/**
 * Detect device profile from system information
 */
export async function detectDeviceProfile(): Promise<DeviceProfile> {
  const ramGB = getSystemRAM();
  const tier = detectTier(ramGB);

  const profile: DeviceProfile = {
    tier,
    ramGB,
    preferLocal: true, // Default to local for privacy
    detectedAt: Date.now(),
    userOverride: false,
  };

  // Cache the detected profile
  cachedProfile = profile;

  console.log(
    `[DeviceProfile] Detected: ${ramGB}GB RAM → tier: ${tier}`
  );

  return profile;
}

/**
 * Get current device profile (cached or detect)
 */
export function getDeviceProfile(): DeviceProfile {
  // Check if user has an override
  if (userOverrideProfile?.tier) {
    const ramGB = cachedProfile?.ramGB ?? getSystemRAM();
    return {
      tier: userOverrideProfile.tier,
      ramGB,
      preferLocal: userOverrideProfile.preferLocal ?? true,
      detectedAt: Date.now(),
      userOverride: true,
    };
  }

  // Check cache validity
  if (cachedProfile) {
    const age = Date.now() - cachedProfile.detectedAt;
    if (age < CACHE_DURATION_MS) {
      return cachedProfile;
    }
  }

  // Synchronous fallback using cached or fresh detection
  const ramGB = getSystemRAM();
  const tier = detectTier(ramGB);

  cachedProfile = {
    tier,
    ramGB,
    preferLocal: true,
    detectedAt: Date.now(),
    userOverride: false,
  };

  return cachedProfile;
}

/**
 * Set user override for device profile
 */
export function setDeviceProfile(override: Partial<DeviceProfile>): void {
  userOverrideProfile = override;

  if (override.tier) {
    console.log(
      `[DeviceProfile] User override: tier=${override.tier}, preferLocal=${override.preferLocal ?? 'unchanged'}`
    );
  }
}

/**
 * Clear user override and use auto-detected profile
 */
export function clearDeviceOverride(): void {
  userOverrideProfile = null;
  console.log('[DeviceProfile] Cleared user override, using auto-detection');
}

/**
 * Force re-detection of device profile
 */
export async function redetectDevice(): Promise<DeviceProfile> {
  cachedProfile = null;
  return detectDeviceProfile();
}

/**
 * Get tier description for teaching output
 */
export function getTierDescription(tier: MemoryTier): string {
  switch (tier) {
    case 'tiny':
      return 'Minimal prompts for constrained devices (<8GB RAM)';
    case 'standard':
      return 'Balanced prompts for typical devices (8-16GB RAM)';
    case 'full':
      return 'Full prompts with complete context (>16GB RAM)';
  }
}

/**
 * Get recommended models for a tier
 */
export function getRecommendedModels(tier: MemoryTier): string[] {
  switch (tier) {
    case 'tiny':
      return ['llama3.2:1b', 'gemma2:2b', 'qwen2.5:1.5b'];
    case 'standard':
      return ['llama3.2:3b', 'qwen2.5:7b', 'gemma2:9b'];
    case 'full':
      return ['llama3.2:3b', 'qwen2.5:14b', 'claude-3.5-sonnet', 'gpt-4o'];
  }
}

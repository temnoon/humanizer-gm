/**
 * User AI Profile Management
 *
 * Manages user-specific AI preferences that are injected into all model calls.
 * Profiles are stored locally and synced to the user's account.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  UserAIProfile,
  ClassOverride,
  WritingStyle,
  Verbosity,
  Formality,
  AIProviderType,
} from './types';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const PROFILES_DIR = path.join(os.homedir(), '.humanizer', 'ai-profiles');
const PROFILE_VERSION = 1;

// ═══════════════════════════════════════════════════════════════════
// DEFAULT PROFILE
// ═══════════════════════════════════════════════════════════════════

/**
 * Default profile for new users
 */
export const DEFAULT_USER_PROFILE: UserAIProfile = {
  userId: '',
  displayName: undefined,

  // Privacy-first defaults
  preferLocalModels: true,
  preferFastModels: false,
  preferCheapModels: false,

  // No budget limits by default (admin can set)
  dailyBudget: undefined,
  monthlyBudget: undefined,
  currentDailySpend: 0,
  currentMonthlySpend: 0,

  // Language defaults
  preferredLanguage: 'en',
  secondaryLanguages: [],

  // Writing style defaults
  writingStyle: 'casual',
  verbosity: 'balanced',
  formality: 'neutral',

  // No overrides by default
  classOverrides: {},

  // No global prompts by default
  globalSystemPrefix: undefined,
  globalSystemSuffix: undefined,
  globalUserPrefix: undefined,
  globalUserSuffix: undefined,

  // No disabled classes
  disabledClasses: [],

  // Metadata
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  version: PROFILE_VERSION,
};

// ═══════════════════════════════════════════════════════════════════
// PROFILE MANAGER
// ═══════════════════════════════════════════════════════════════════

/**
 * User profile manager - handles storage and retrieval
 */
export class UserProfileManager {
  private profiles: Map<string, UserAIProfile> = new Map();
  private initialized = false;

  constructor() {
    this.ensureProfilesDir();
  }

  /**
   * Ensure profiles directory exists
   */
  private ensureProfilesDir(): void {
    if (!fs.existsSync(PROFILES_DIR)) {
      fs.mkdirSync(PROFILES_DIR, { recursive: true });
    }
  }

  /**
   * Get profile file path for a user
   */
  private getProfilePath(userId: string): string {
    // Sanitize userId for filesystem
    const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(PROFILES_DIR, `${safeId}.json`);
  }

  /**
   * Load all profiles from disk
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.ensureProfilesDir();

    const files = fs.readdirSync(PROFILES_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const content = fs.readFileSync(path.join(PROFILES_DIR, file), 'utf-8');
        const profile = JSON.parse(content) as UserAIProfile;
        this.profiles.set(profile.userId, profile);
      } catch (error) {
        console.error(`Failed to load profile ${file}:`, error);
      }
    }

    this.initialized = true;
  }

  /**
   * Get user profile, creating default if not exists
   */
  async getProfile(userId: string): Promise<UserAIProfile> {
    await this.initialize();

    // Check memory cache
    if (this.profiles.has(userId)) {
      return this.profiles.get(userId)!;
    }

    // Check disk
    const profilePath = this.getProfilePath(userId);
    if (fs.existsSync(profilePath)) {
      try {
        const content = fs.readFileSync(profilePath, 'utf-8');
        const profile = JSON.parse(content) as UserAIProfile;
        profile.userId = userId; // Ensure userId matches
        this.profiles.set(userId, profile);
        return profile;
      } catch (error) {
        console.error(`Failed to load profile for ${userId}:`, error);
      }
    }

    // Create default profile
    const profile = this.createDefaultProfile(userId);
    await this.saveProfile(profile);
    return profile;
  }

  /**
   * Create a default profile for a user
   */
  createDefaultProfile(userId: string, displayName?: string): UserAIProfile {
    const profile: UserAIProfile = {
      ...DEFAULT_USER_PROFILE,
      userId,
      displayName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.profiles.set(userId, profile);
    return profile;
  }

  /**
   * Save a profile to disk
   */
  async saveProfile(profile: UserAIProfile): Promise<void> {
    this.ensureProfilesDir();

    profile.updatedAt = new Date().toISOString();
    profile.version = PROFILE_VERSION;

    const profilePath = this.getProfilePath(profile.userId);
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
    this.profiles.set(profile.userId, profile);
  }

  /**
   * Update user profile with partial updates
   */
  async updateProfile(
    userId: string,
    updates: Partial<UserAIProfile>
  ): Promise<UserAIProfile> {
    const profile = await this.getProfile(userId);
    const updated = { ...profile, ...updates, userId }; // userId cannot be changed
    await this.saveProfile(updated);
    return updated;
  }

  /**
   * Set a class override for a user
   */
  async setClassOverride(
    userId: string,
    classId: string,
    override: ClassOverride
  ): Promise<void> {
    const profile = await this.getProfile(userId);
    profile.classOverrides[classId] = override;
    await this.saveProfile(profile);
  }

  /**
   * Remove a class override
   */
  async removeClassOverride(userId: string, classId: string): Promise<void> {
    const profile = await this.getProfile(userId);
    delete profile.classOverrides[classId];
    await this.saveProfile(profile);
  }

  /**
   * Disable a capability class for a user
   */
  async disableClass(userId: string, classId: string): Promise<void> {
    const profile = await this.getProfile(userId);
    if (!profile.disabledClasses) profile.disabledClasses = [];
    if (!profile.disabledClasses.includes(classId)) {
      profile.disabledClasses.push(classId);
      await this.saveProfile(profile);
    }
  }

  /**
   * Enable a previously disabled class
   */
  async enableClass(userId: string, classId: string): Promise<void> {
    const profile = await this.getProfile(userId);
    if (profile.disabledClasses) {
      profile.disabledClasses = profile.disabledClasses.filter(c => c !== classId);
      await this.saveProfile(profile);
    }
  }

  /**
   * Check if a class is disabled for a user
   */
  async isClassDisabled(userId: string, classId: string): Promise<boolean> {
    const profile = await this.getProfile(userId);
    return profile.disabledClasses?.includes(classId) ?? false;
  }

  /**
   * Update budget tracking
   */
  async trackSpend(userId: string, amount: number): Promise<void> {
    const profile = await this.getProfile(userId);
    profile.currentDailySpend = (profile.currentDailySpend || 0) + amount;
    profile.currentMonthlySpend = (profile.currentMonthlySpend || 0) + amount;
    await this.saveProfile(profile);
  }

  /**
   * Reset daily spend (call at start of new day)
   */
  async resetDailySpend(userId: string): Promise<void> {
    const profile = await this.getProfile(userId);
    profile.currentDailySpend = 0;
    await this.saveProfile(profile);
  }

  /**
   * Reset monthly spend (call at start of new month)
   */
  async resetMonthlySpend(userId: string): Promise<void> {
    const profile = await this.getProfile(userId);
    profile.currentMonthlySpend = 0;
    await this.saveProfile(profile);
  }

  /**
   * Check if user is over budget
   */
  async isOverBudget(userId: string): Promise<{
    overDaily: boolean;
    overMonthly: boolean;
    dailyRemaining?: number;
    monthlyRemaining?: number;
  }> {
    const profile = await this.getProfile(userId);

    const overDaily = profile.dailyBudget !== undefined &&
      (profile.currentDailySpend || 0) >= profile.dailyBudget;

    const overMonthly = profile.monthlyBudget !== undefined &&
      (profile.currentMonthlySpend || 0) >= profile.monthlyBudget;

    return {
      overDaily,
      overMonthly,
      dailyRemaining: profile.dailyBudget !== undefined
        ? Math.max(0, profile.dailyBudget - (profile.currentDailySpend || 0))
        : undefined,
      monthlyRemaining: profile.monthlyBudget !== undefined
        ? Math.max(0, profile.monthlyBudget - (profile.currentMonthlySpend || 0))
        : undefined,
    };
  }

  /**
   * Delete a user profile
   */
  async deleteProfile(userId: string): Promise<void> {
    const profilePath = this.getProfilePath(userId);
    if (fs.existsSync(profilePath)) {
      fs.unlinkSync(profilePath);
    }
    this.profiles.delete(userId);
  }

  /**
   * List all user IDs with profiles
   */
  async listUsers(): Promise<string[]> {
    await this.initialize();
    return Array.from(this.profiles.keys());
  }

  /**
   * Export profile as JSON
   */
  async exportProfile(userId: string): Promise<string> {
    const profile = await this.getProfile(userId);
    return JSON.stringify(profile, null, 2);
  }

  /**
   * Import profile from JSON
   */
  async importProfile(userId: string, json: string): Promise<UserAIProfile> {
    const imported = JSON.parse(json) as UserAIProfile;
    imported.userId = userId; // Ensure userId matches
    imported.updatedAt = new Date().toISOString();
    await this.saveProfile(imported);
    return imported;
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT INJECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Inject user profile preferences into prompts
 */
export function injectProfileIntoPrompt(
  profile: UserAIProfile,
  systemPrompt: string,
  userPrompt: string
): { systemPrompt: string; userPrompt: string } {
  let finalSystem = systemPrompt;
  let finalUser = userPrompt;

  // Add global system prefix
  if (profile.globalSystemPrefix) {
    finalSystem = `${profile.globalSystemPrefix}\n\n${finalSystem}`;
  }

  // Add global system suffix
  if (profile.globalSystemSuffix) {
    finalSystem = `${finalSystem}\n\n${profile.globalSystemSuffix}`;
  }

  // Inject writing style preferences
  const styleDirective = buildStyleDirective(profile);
  if (styleDirective) {
    finalSystem = `${finalSystem}\n\n${styleDirective}`;
  }

  // Add language preference if not English
  if (profile.preferredLanguage && profile.preferredLanguage !== 'en') {
    finalSystem = `${finalSystem}\n\nPreferred response language: ${profile.preferredLanguage}`;
  }

  // Add global user prefix
  if (profile.globalUserPrefix) {
    finalUser = `${profile.globalUserPrefix}\n\n${finalUser}`;
  }

  // Add global user suffix
  if (profile.globalUserSuffix) {
    finalUser = `${finalUser}\n\n${profile.globalUserSuffix}`;
  }

  return { systemPrompt: finalSystem, userPrompt: finalUser };
}

/**
 * Build style directive from profile preferences
 */
function buildStyleDirective(profile: UserAIProfile): string | undefined {
  const parts: string[] = [];

  if (profile.writingStyle) {
    const styleMap: Record<WritingStyle, string> = {
      formal: 'Use formal, professional language',
      casual: 'Use casual, conversational language',
      academic: 'Use academic, scholarly language',
      creative: 'Use creative, expressive language',
      technical: 'Use precise, technical language',
      journalistic: 'Use clear, journalistic language',
    };
    parts.push(styleMap[profile.writingStyle]);
  }

  if (profile.verbosity) {
    const verbosityMap: Record<Verbosity, string> = {
      concise: 'Be concise and brief',
      balanced: 'Be moderately detailed',
      detailed: 'Be thorough and detailed',
      verbose: 'Be comprehensive and verbose',
    };
    parts.push(verbosityMap[profile.verbosity]);
  }

  if (profile.formality) {
    const formalityMap: Record<Formality, string> = {
      'very-formal': 'Maintain very formal tone',
      formal: 'Maintain formal tone',
      neutral: 'Maintain neutral tone',
      informal: 'Maintain informal tone',
      casual: 'Maintain casual, friendly tone',
    };
    parts.push(formalityMap[profile.formality]);
  }

  if (parts.length === 0) return undefined;

  return `Style preferences: ${parts.join('. ')}.`;
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════

let _profileManager: UserProfileManager | null = null;

/**
 * Get the singleton profile manager
 */
export function getProfileManager(): UserProfileManager {
  if (!_profileManager) {
    _profileManager = new UserProfileManager();
  }
  return _profileManager;
}

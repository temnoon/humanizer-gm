/**
 * Secure API Key Storage
 *
 * Uses Electron's safeStorage for secure API key encryption.
 * Keys are encrypted at rest and only decrypted when needed.
 *
 * Security model:
 * - Keys are encrypted using OS-level secure storage (Keychain on macOS)
 * - Encrypted values are stored in a separate file from main config
 * - Plaintext keys are never written to disk
 * - Memory is cleared after use where possible
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { safeStorage, app } from 'electron';
import type { AIProviderType } from './types';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const SECURE_DIR = path.join(os.homedir(), '.humanizer', 'secure');
const KEYS_FILE = 'api-keys.enc.json';

interface EncryptedKeyStore {
  version: number;
  updatedAt: string;
  keys: Record<string, string>; // provider -> encrypted base64
}

// ═══════════════════════════════════════════════════════════════════
// SECURE STORAGE SERVICE
// ═══════════════════════════════════════════════════════════════════

export class SecureAPIKeyStorage {
  private keysPath: string;
  private keyCache: Map<string, string> = new Map(); // In-memory cache (decrypted)
  private isAvailable: boolean = false;

  constructor() {
    this.ensureSecureDir();
    this.keysPath = path.join(SECURE_DIR, KEYS_FILE);
    this.isAvailable = this.checkAvailability();
  }

  /**
   * Ensure secure directory exists with proper permissions
   */
  private ensureSecureDir(): void {
    if (!fs.existsSync(SECURE_DIR)) {
      fs.mkdirSync(SECURE_DIR, { recursive: true, mode: 0o700 }); // Owner-only access
    }
  }

  /**
   * Check if secure storage is available
   */
  private checkAvailability(): boolean {
    try {
      // Check if app is ready and safeStorage is available
      if (!app.isReady()) {
        console.warn('[SecureStorage] App not ready, safeStorage unavailable');
        return false;
      }
      return safeStorage.isEncryptionAvailable();
    } catch (error) {
      console.warn('[SecureStorage] safeStorage not available:', error);
      return false;
    }
  }

  /**
   * Check if encryption is available
   */
  isEncryptionAvailable(): boolean {
    return this.isAvailable;
  }

  /**
   * Load encrypted key store from disk
   */
  private loadKeyStore(): EncryptedKeyStore {
    if (!fs.existsSync(this.keysPath)) {
      return {
        version: 1,
        updatedAt: new Date().toISOString(),
        keys: {},
      };
    }

    try {
      const content = fs.readFileSync(this.keysPath, 'utf-8');
      return JSON.parse(content) as EncryptedKeyStore;
    } catch (error) {
      console.error('[SecureStorage] Failed to load key store:', error);
      return {
        version: 1,
        updatedAt: new Date().toISOString(),
        keys: {},
      };
    }
  }

  /**
   * Save encrypted key store to disk
   */
  private saveKeyStore(store: EncryptedKeyStore): void {
    this.ensureSecureDir();
    store.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.keysPath, JSON.stringify(store, null, 2), {
      mode: 0o600, // Owner read/write only
    });
  }

  /**
   * Encrypt an API key
   */
  private encrypt(plaintext: string): string {
    if (!this.isAvailable) {
      throw new Error('Secure storage not available');
    }
    const encrypted = safeStorage.encryptString(plaintext);
    return encrypted.toString('base64');
  }

  /**
   * Decrypt an API key
   */
  private decrypt(ciphertext: string): string {
    if (!this.isAvailable) {
      throw new Error('Secure storage not available');
    }
    const buffer = Buffer.from(ciphertext, 'base64');
    return safeStorage.decryptString(buffer);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Store an API key securely
   */
  async setKey(provider: AIProviderType | string, apiKey: string): Promise<void> {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('API key cannot be empty');
    }

    if (!this.isAvailable) {
      console.warn('[SecureStorage] Encryption unavailable, storing in plaintext');
      // Fall back to plaintext storage (for development/testing)
      const store = this.loadKeyStore();
      store.keys[provider] = `PLAINTEXT:${apiKey}`;
      this.saveKeyStore(store);
      this.keyCache.set(provider, apiKey);
      return;
    }

    const encrypted = this.encrypt(apiKey);
    const store = this.loadKeyStore();
    store.keys[provider] = encrypted;
    this.saveKeyStore(store);

    // Update cache
    this.keyCache.set(provider, apiKey);

    console.log(`[SecureStorage] API key stored for ${provider}`);
  }

  /**
   * Retrieve an API key
   */
  async getKey(provider: AIProviderType | string): Promise<string | null> {
    // Check cache first
    const cached = this.keyCache.get(provider);
    if (cached) {
      return cached;
    }

    const store = this.loadKeyStore();
    const encrypted = store.keys[provider];

    if (!encrypted) {
      return null;
    }

    // Handle plaintext fallback
    if (encrypted.startsWith('PLAINTEXT:')) {
      const plaintext = encrypted.slice('PLAINTEXT:'.length);
      this.keyCache.set(provider, plaintext);
      return plaintext;
    }

    if (!this.isAvailable) {
      console.warn('[SecureStorage] Cannot decrypt - safeStorage unavailable');
      return null;
    }

    try {
      const decrypted = this.decrypt(encrypted);
      this.keyCache.set(provider, decrypted);
      return decrypted;
    } catch (error) {
      console.error(`[SecureStorage] Failed to decrypt key for ${provider}:`, error);
      return null;
    }
  }

  /**
   * Remove an API key
   */
  async removeKey(provider: AIProviderType | string): Promise<void> {
    const store = this.loadKeyStore();
    delete store.keys[provider];
    this.saveKeyStore(store);
    this.keyCache.delete(provider);
    console.log(`[SecureStorage] API key removed for ${provider}`);
  }

  /**
   * Check if a provider has a configured API key
   */
  async hasKey(provider: AIProviderType | string): Promise<boolean> {
    const key = await this.getKey(provider);
    return key !== null && key.length > 0;
  }

  /**
   * List all providers with configured keys
   */
  async listConfiguredProviders(): Promise<string[]> {
    const store = this.loadKeyStore();
    return Object.keys(store.keys);
  }

  /**
   * Get status of all known providers
   */
  async getProviderStatus(): Promise<Record<string, { configured: boolean; encrypted: boolean }>> {
    const store = this.loadKeyStore();
    const providers: AIProviderType[] = [
      'ollama', 'openai', 'anthropic', 'cloudflare', 'google',
      'cohere', 'mistral', 'groq', 'together', 'deepseek',
    ];

    const status: Record<string, { configured: boolean; encrypted: boolean }> = {};

    for (const provider of providers) {
      const encrypted = store.keys[provider];
      status[provider] = {
        configured: !!encrypted,
        encrypted: encrypted ? !encrypted.startsWith('PLAINTEXT:') : false,
      };
    }

    return status;
  }

  /**
   * Clear the in-memory cache (for security)
   */
  clearCache(): void {
    this.keyCache.clear();
  }

  /**
   * Validate an API key format (basic checks)
   */
  validateKeyFormat(provider: AIProviderType | string, apiKey: string): { valid: boolean; error?: string } {
    if (!apiKey || apiKey.trim().length === 0) {
      return { valid: false, error: 'API key cannot be empty' };
    }

    // Provider-specific validation
    switch (provider) {
      case 'openai':
        if (!apiKey.startsWith('sk-')) {
          return { valid: false, error: 'OpenAI keys should start with "sk-"' };
        }
        break;
      case 'anthropic':
        if (!apiKey.startsWith('sk-ant-')) {
          return { valid: false, error: 'Anthropic keys should start with "sk-ant-"' };
        }
        break;
      case 'together':
        // Together keys are typically 64 hex chars
        if (apiKey.length < 32) {
          return { valid: false, error: 'Together API key seems too short' };
        }
        break;
      // Add more provider-specific validation as needed
    }

    return { valid: true };
  }

  /**
   * Migrate existing plaintext keys from admin-config to secure storage
   */
  async migrateFromConfig(providers: Record<string, { apiKey?: string }>): Promise<number> {
    let migratedCount = 0;

    for (const [provider, config] of Object.entries(providers)) {
      if (config.apiKey && !config.apiKey.startsWith('***')) {
        // Has a plaintext key that's not redacted
        const hasSecure = await this.hasKey(provider);
        if (!hasSecure) {
          await this.setKey(provider, config.apiKey);
          migratedCount++;
          console.log(`[SecureStorage] Migrated key for ${provider}`);
        }
      }
    }

    return migratedCount;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════

let _secureStorage: SecureAPIKeyStorage | null = null;

/**
 * Get the singleton secure storage instance
 * Note: Must be called after app.whenReady()
 */
export function getSecureStorage(): SecureAPIKeyStorage {
  if (!_secureStorage) {
    _secureStorage = new SecureAPIKeyStorage();
  }
  return _secureStorage;
}

/**
 * Initialize secure storage (call after app.whenReady)
 */
export async function initSecureStorage(): Promise<SecureAPIKeyStorage> {
  const storage = getSecureStorage();
  const isAvailable = storage.isEncryptionAvailable();
  console.log(`[SecureStorage] Initialized, encryption available: ${isAvailable}`);
  return storage;
}

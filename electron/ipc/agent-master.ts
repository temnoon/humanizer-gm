/**
 * AgentMaster IPC Handlers
 *
 * Handles device profile management, tier configuration, and capability listing
 * for the unified LLM abstraction layer.
 */

import { ipcMain } from 'electron';
import {
  getAgentMasterService,
  setDeviceProfile,
  clearDeviceOverride,
  getDeviceProfile,
  getTierDescription,
  getRecommendedModels,
  type MemoryTier,
} from '../agent-master';

/**
 * Register all AgentMaster IPC handlers
 */
export function registerAgentMasterHandlers() {
  // Get current device profile
  ipcMain.handle('agent-master:get-profile', () => {
    return getDeviceProfile();
  });

  // Set tier override (for testing different device tiers)
  ipcMain.handle('agent-master:set-tier', (_e, tier: MemoryTier) => {
    setDeviceProfile({ tier });
    const profile = getDeviceProfile();
    console.log(`[AgentMaster] Tier override set to: ${tier}`);
    return {
      tier,
      description: getTierDescription(tier),
      recommendedModels: getRecommendedModels(tier),
      profile,
    };
  });

  // Clear tier override (use auto-detection)
  ipcMain.handle('agent-master:clear-override', () => {
    clearDeviceOverride();
    const profile = getDeviceProfile();
    console.log('[AgentMaster] Tier override cleared, using auto-detection');
    return {
      tier: profile.tier,
      description: getTierDescription(profile.tier),
      recommendedModels: getRecommendedModels(profile.tier),
      profile,
    };
  });

  // Get tier info
  ipcMain.handle('agent-master:tier-info', (_e, tier: MemoryTier) => {
    return {
      tier,
      description: getTierDescription(tier),
      recommendedModels: getRecommendedModels(tier),
    };
  });

  // List available capabilities
  ipcMain.handle('agent-master:capabilities', () => {
    const agentMaster = getAgentMasterService();
    return agentMaster.listCapabilities();
  });

  console.log('AgentMaster IPC handlers registered');
}

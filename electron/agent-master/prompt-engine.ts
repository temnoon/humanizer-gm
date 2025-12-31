/**
 * Prompt Engine
 *
 * Selects and interpolates prompts based on device tier.
 * Manages the registry of tiered prompt definitions.
 */

import type {
  MemoryTier,
  PromptVariant,
  TieredPromptDefinition,
  PromptEngineConfig,
  PromptSelection,
} from './types';
import { getDeviceProfile, getTierDescription } from './device-profile';

// ═══════════════════════════════════════════════════════════════════
// PROMPT REGISTRY
// ═══════════════════════════════════════════════════════════════════

const promptRegistry = new Map<string, TieredPromptDefinition>();

/**
 * Register a tiered prompt definition
 */
export function registerPrompt(definition: TieredPromptDefinition): void {
  promptRegistry.set(definition.capability, definition);
  console.log(`[PromptEngine] Registered prompt for capability: ${definition.capability}`);
}

/**
 * Get a prompt definition by capability
 */
export function getPromptDefinition(capability: string): TieredPromptDefinition | undefined {
  return promptRegistry.get(capability);
}

/**
 * List all registered capabilities
 */
export function listPromptCapabilities(): string[] {
  return Array.from(promptRegistry.keys());
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT SELECTION
// ═══════════════════════════════════════════════════════════════════

/** Default configuration */
const defaultConfig: PromptEngineConfig = {
  fallbackTier: 'standard',
  allowTierOverride: true,
  tinyMaxPromptTokens: 500,
  standardMaxPromptTokens: 2000,
};

let config: PromptEngineConfig = { ...defaultConfig };

/**
 * Configure the prompt engine
 */
export function configurePromptEngine(newConfig: Partial<PromptEngineConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Select the appropriate prompt for a capability
 */
export function selectPrompt(
  capability: string,
  options?: {
    forceTier?: MemoryTier;
    variables?: Record<string, string>;
  }
): PromptSelection | undefined {
  const definition = promptRegistry.get(capability);
  if (!definition) {
    console.warn(`[PromptEngine] No prompt registered for capability: ${capability}`);
    return undefined;
  }

  // Determine tier
  let tier: MemoryTier;
  let reason: PromptSelection['reason'];

  if (options?.forceTier && config.allowTierOverride) {
    tier = options.forceTier;
    reason = 'force-param';
  } else {
    const deviceProfile = getDeviceProfile();
    if (deviceProfile.userOverride) {
      tier = deviceProfile.tier;
      reason = 'user-override';
    } else {
      tier = deviceProfile.tier;
      reason = 'auto-detected';
    }
  }

  // Get the variant for this tier
  const variant = definition.variants[tier];
  if (!variant) {
    console.warn(`[PromptEngine] No variant for tier ${tier}, using fallback`);
    const fallbackVariant = definition.variants[config.fallbackTier];
    if (!fallbackVariant) {
      return undefined;
    }
    tier = config.fallbackTier;
    reason = 'fallback';
  }

  // Interpolate variables into system prompt
  let systemPrompt = definition.variants[tier].systemPrompt;
  if (options?.variables) {
    systemPrompt = interpolateVariables(systemPrompt, options.variables);
  }

  // Interpolate user prompt template if present
  let userPrompt: string | undefined;
  if (definition.userPromptTemplate && options?.variables) {
    userPrompt = interpolateVariables(definition.userPromptTemplate, options.variables);
  }

  return {
    prompt: definition.variants[tier],
    tier,
    reason,
    systemPrompt,
    userPrompt,
  };
}

/**
 * Get a prompt variant directly
 */
export function getPromptVariant(
  capability: string,
  tier?: MemoryTier
): PromptVariant | undefined {
  const definition = promptRegistry.get(capability);
  if (!definition) {
    return undefined;
  }

  const effectiveTier = tier ?? getDeviceProfile().tier;
  return definition.variants[effectiveTier];
}

// ═══════════════════════════════════════════════════════════════════
// VARIABLE INTERPOLATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Interpolate variables into a prompt template
 * Variables are in the format {{variableName}}
 */
function interpolateVariables(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(pattern, value);
  }

  return result;
}

/**
 * Extract variable names from a template
 */
export function extractVariables(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g);
  if (!matches) {
    return [];
  }

  return matches.map((match) => match.replace(/[{}]/g, ''));
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT VALIDATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a tiered prompt definition
 */
export function validatePromptDefinition(
  definition: TieredPromptDefinition
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!definition.capability) {
    errors.push('Missing capability ID');
  }

  if (!definition.name) {
    errors.push('Missing name');
  }

  // Check all tiers have variants
  for (const tier of ['tiny', 'standard', 'full'] as MemoryTier[]) {
    const variant = definition.variants[tier];
    if (!variant) {
      errors.push(`Missing variant for tier: ${tier}`);
      continue;
    }

    if (!variant.systemPrompt) {
      errors.push(`Missing systemPrompt for tier: ${tier}`);
    }

    if (typeof variant.maxTokens !== 'number' || variant.maxTokens <= 0) {
      errors.push(`Invalid maxTokens for tier: ${tier}`);
    }

    // Check token estimates are appropriate for tier
    if (tier === 'tiny' && variant.tokenEstimate > config.tinyMaxPromptTokens) {
      errors.push(
        `Tiny tier tokenEstimate (${variant.tokenEstimate}) exceeds max (${config.tinyMaxPromptTokens})`
      );
    }

    if (tier === 'standard' && variant.tokenEstimate > config.standardMaxPromptTokens) {
      errors.push(
        `Standard tier tokenEstimate (${variant.tokenEstimate}) exceeds max (${config.standardMaxPromptTokens})`
      );
    }
  }

  // Check variables are consistent across tiers
  if (definition.variables && definition.variables.length > 0) {
    for (const tier of ['tiny', 'standard', 'full'] as MemoryTier[]) {
      const variant = definition.variants[tier];
      if (variant) {
        const templateVars = extractVariables(variant.systemPrompt);
        for (const v of definition.variables) {
          if (!templateVars.includes(v)) {
            // Variable declared but not used - just a warning
            console.warn(
              `[PromptEngine] Variable '${v}' declared but not used in ${tier} tier`
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ═══════════════════════════════════════════════════════════════════
// TEACHING OUTPUT
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate teaching output explaining prompt selection
 */
export function getPromptTeaching(
  selection: PromptSelection,
  capability: string
): string {
  const tierDesc = getTierDescription(selection.tier);
  const definition = promptRegistry.get(capability);
  const capabilityName = definition?.name ?? capability;

  let teaching = `Selected ${selection.tier} tier prompt for "${capabilityName}". `;
  teaching += `${tierDesc}. `;

  switch (selection.reason) {
    case 'auto-detected':
      teaching += 'Tier was auto-detected based on your device RAM.';
      break;
    case 'user-override':
      teaching += 'Using your manually configured tier preference.';
      break;
    case 'force-param':
      teaching += 'Tier was explicitly specified in the request.';
      break;
    case 'fallback':
      teaching += 'Using fallback tier due to missing variant.';
      break;
  }

  return teaching;
}

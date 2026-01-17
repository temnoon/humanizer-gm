/**
 * Cost Tracker
 *
 * Tracks LLM usage and estimated costs per provider and model.
 * Provides daily/monthly summaries for billing.
 */

import type { ProviderType } from './types';

// Pricing per 1M tokens (input/output) as of Jan 2026
// These should be updated periodically
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },

  // Anthropic
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
  'claude-3-sonnet-20240229': { input: 3.00, output: 15.00 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },

  // Together.ai
  'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo': { input: 3.50, output: 3.50 },
  'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo': { input: 0.88, output: 0.88 },
  'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo': { input: 0.18, output: 0.18 },
  'meta-llama/Llama-3.2-3B-Instruct-Turbo': { input: 0.06, output: 0.06 },

  // OpenRouter (varies, using typical prices)
  'anthropic/claude-3.5-sonnet': { input: 3.00, output: 15.00 },
  'meta-llama/llama-3.1-8b-instruct': { input: 0.10, output: 0.10 },
  'mistralai/mistral-nemo': { input: 0.15, output: 0.15 },

  // Cloudflare Workers AI (free tier then $0.011/1K neurons)
  '@cf/meta/llama-3.1-8b-instruct': { input: 0.00, output: 0.00 }, // Free tier
  '@cf/meta/llama-3.1-70b-instruct': { input: 0.00, output: 0.00 }, // Free tier

  // Ollama (local, no cost)
  'llama3.2:3b': { input: 0.00, output: 0.00 },
  'qwen3:14b': { input: 0.00, output: 0.00 },
};

export interface UsageRecord {
  timestamp: number;
  provider: ProviderType;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  success: boolean;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  byProvider: Record<string, { tokens: number; cost: number }>;
  byModel: Record<string, { tokens: number; cost: number }>;
  requestCount: number;
  successRate: number;
}

// In-memory storage (will be persisted via electron-store in Phase 3)
let usageRecords: UsageRecord[] = [];

/**
 * Get pricing for a model (falls back to default if unknown)
 */
function getModelPricing(model: string): { input: number; output: number } {
  // Try exact match first
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  // Try to find a partial match
  const normalizedModel = model.toLowerCase();
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (normalizedModel.includes(key.toLowerCase()) || key.toLowerCase().includes(normalizedModel)) {
      return pricing;
    }
  }

  // Default pricing for unknown models
  return { input: 0.50, output: 1.00 };
}

/**
 * Calculate cost for a given usage
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getModelPricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Record LLM usage
 */
export function recordUsage(
  provider: ProviderType,
  model: string,
  inputTokens: number,
  outputTokens: number,
  success: boolean = true
): UsageRecord {
  const record: UsageRecord = {
    timestamp: Date.now(),
    provider,
    model,
    inputTokens,
    outputTokens,
    estimatedCost: calculateCost(model, inputTokens, outputTokens),
    success,
  };

  usageRecords.push(record);

  // Keep only last 30 days of records in memory
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  usageRecords = usageRecords.filter(r => r.timestamp > thirtyDaysAgo);

  return record;
}

/**
 * Get usage summary for a time period
 */
export function getUsageSummary(since?: number): UsageSummary {
  const relevantRecords = since
    ? usageRecords.filter(r => r.timestamp >= since)
    : usageRecords;

  const summary: UsageSummary = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    byProvider: {},
    byModel: {},
    requestCount: relevantRecords.length,
    successRate: 0,
  };

  let successCount = 0;

  for (const record of relevantRecords) {
    summary.totalInputTokens += record.inputTokens;
    summary.totalOutputTokens += record.outputTokens;
    summary.totalCost += record.estimatedCost;

    if (record.success) {
      successCount++;
    }

    // By provider
    if (!summary.byProvider[record.provider]) {
      summary.byProvider[record.provider] = { tokens: 0, cost: 0 };
    }
    summary.byProvider[record.provider].tokens += record.inputTokens + record.outputTokens;
    summary.byProvider[record.provider].cost += record.estimatedCost;

    // By model
    if (!summary.byModel[record.model]) {
      summary.byModel[record.model] = { tokens: 0, cost: 0 };
    }
    summary.byModel[record.model].tokens += record.inputTokens + record.outputTokens;
    summary.byModel[record.model].cost += record.estimatedCost;
  }

  summary.successRate = relevantRecords.length > 0
    ? (successCount / relevantRecords.length) * 100
    : 100;

  return summary;
}

/**
 * Get daily usage summary
 */
export function getDailyUsage(): UsageSummary {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return getUsageSummary(startOfDay.getTime());
}

/**
 * Get monthly usage summary
 */
export function getMonthlyUsage(): UsageSummary {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  return getUsageSummary(startOfMonth.getTime());
}

/**
 * Get all usage records (for persistence)
 */
export function getAllRecords(): UsageRecord[] {
  return [...usageRecords];
}

/**
 * Load usage records (from persistence)
 */
export function loadRecords(records: UsageRecord[]): void {
  usageRecords = records;
}

/**
 * Clear all usage records
 */
export function clearRecords(): void {
  usageRecords = [];
}

/**
 * Get estimated monthly cost based on current usage rate
 */
export function getProjectedMonthlyCost(): number {
  const daily = getDailyUsage();
  // Extrapolate to 30 days
  return daily.totalCost * 30;
}

/**
 * Format cost as currency string
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${(cost * 100).toFixed(2)}¢`;
  }
  return `$${cost.toFixed(4)}`;
}

/**
 * Format tokens as human-readable string
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

/**
 * Token counter module using gpt-tokenizer.
 * Estimates token counts for text using the o200k_base encoding (GPT-4o/4.1/5.x).
 */

import { countTokens as gptCountTokens } from 'gpt-tokenizer/model/gpt-4o';

/** Pricing per 1M tokens in USD */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** Available cost models and their pricing */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'gpt-4.1': { inputPerMillion: 2.00, outputPerMillion: 8.00 },
  'gpt-4': { inputPerMillion: 30.00, outputPerMillion: 60.00 },
  'claude-opus-4.6': { inputPerMillion: 15.00, outputPerMillion: 75.00 },
  'claude-sonnet-4': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'claude-sonnet-3.5': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
};

/**
 * Resolve a model name from logs to a pricing key.
 * Log model names can vary (e.g., "claude-opus-4.6", "claude-opus-4-6", "gpt-4o-mini-2024-07-18").
 */
export function resolveModelPricing(modelName: string): string {
  const lower = modelName.toLowerCase();

  // Direct match
  if (MODEL_PRICING[modelName]) { return modelName; }

  // Fuzzy matching
  if (lower.includes('claude') && lower.includes('opus')) { return 'claude-opus-4.6'; }
  if (lower.includes('claude') && lower.includes('sonnet') && lower.includes('4')) { return 'claude-sonnet-4'; }
  if (lower.includes('claude') && lower.includes('sonnet')) { return 'claude-sonnet-3.5'; }
  if (lower.includes('gpt-4o-mini')) { return 'gpt-4o-mini'; }
  if (lower.includes('gpt-4o')) { return 'gpt-4o'; }
  if (lower.includes('gpt-4.1')) { return 'gpt-4.1'; }
  if (lower.includes('gpt-4')) { return 'gpt-4'; }

  // Default
  return 'gpt-4o';
}

/**
 * Count tokens in a text string using the o200k_base encoding.
 * This is the encoding used by GPT-4o, GPT-4.1, and GPT-5.x models.
 */
export function countTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }
  try {
    return gptCountTokens(text);
  } catch {
    // Fallback: ~4 chars per token heuristic
    return Math.ceil(text.length / 4);
  }
}

/**
 * Estimate the cost of tokens at API rates.
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: string = 'gpt-4o'
): { inputCost: number; outputCost: number; totalCost: number } {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gpt-4o'];
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

/**
 * Format a token count for display (e.g., 1234 -> "1.2K", 1234567 -> "1.2M")
 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return tokens.toString();
  }
  if (tokens < 1_000_000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

/**
 * Format a cost for display (e.g., 0.0023 -> "$0.002", 1.50 -> "$1.50")
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(2)}`;
}

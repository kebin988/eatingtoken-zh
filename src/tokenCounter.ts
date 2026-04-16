/**
 * Token counter module using gpt-tokenizer.
 * Estimates token counts for text using the o200k_base encoding (GPT-4o/4.1/5.x).
 */

import { countTokens as gptCountTokens } from 'gpt-tokenizer/model/gpt-4o';

/** 每百万 Token 定价（人民币/元，按 1 USD = 7.25 CNY 换算） */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** 汇率常量：USD → CNY */
const USD_TO_CNY = 7.25;

/** 可用费用模型及其定价（人民币） */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { inputPerMillion: 2.50 * USD_TO_CNY, outputPerMillion: 10.00 * USD_TO_CNY },
  'gpt-4o-mini': { inputPerMillion: 0.15 * USD_TO_CNY, outputPerMillion: 0.60 * USD_TO_CNY },
  'gpt-4.1': { inputPerMillion: 2.00 * USD_TO_CNY, outputPerMillion: 8.00 * USD_TO_CNY },
  'gpt-4': { inputPerMillion: 30.00 * USD_TO_CNY, outputPerMillion: 60.00 * USD_TO_CNY },
  'claude-opus-4.6': { inputPerMillion: 15.00 * USD_TO_CNY, outputPerMillion: 75.00 * USD_TO_CNY },
  'claude-sonnet-4': { inputPerMillion: 3.00 * USD_TO_CNY, outputPerMillion: 15.00 * USD_TO_CNY },
  'claude-sonnet-3.5': { inputPerMillion: 3.00 * USD_TO_CNY, outputPerMillion: 15.00 * USD_TO_CNY },
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
 * 计算文本的 Token 数量。
 * 短文本使用 o200k_base 编码精确计算，超过 10000 字符时用近似公式避免超时。
 */
export function countTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }
  // 超过 10000 字符时直接用近似公式，避免 tokenizer 超时
  if (text.length > 10_000) {
    return Math.ceil(text.length / 4);
  }
  try {
    return gptCountTokens(text);
  } catch {
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
 * 格式化费用显示（人民币）
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `¥${cost.toFixed(4)}`;
  }
  if (cost < 1) {
    return `¥${cost.toFixed(3)}`;
  }
  return `¥${cost.toFixed(2)}`;
}

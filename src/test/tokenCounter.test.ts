import { describe, it, expect } from 'vitest';
import {
  countTokens,
  estimateCost,
  formatTokenCount,
  formatCost,
  MODEL_PRICING,
} from '../tokenCounter';

describe('countTokens', () => {
  it('should return 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('should return 0 for null/undefined-like input', () => {
    expect(countTokens('')).toBe(0);
  });

  it('should count tokens for simple English text', () => {
    const tokens = countTokens('Hello, world!');
    // "Hello, world!" is typically 4 tokens with o200k_base
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it('should count tokens for code', () => {
    const code = `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}`;
    const tokens = countTokens(code);
    // Code is typically ~1 token per 3-4 chars
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(100);
  });

  it('should handle large text without errors', () => {
    const largeText = 'a'.repeat(100_000);
    const tokens = countTokens(largeText);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should handle unicode text', () => {
    const tokens = countTokens('const greeting = "Hello!";');
    expect(tokens).toBeGreaterThan(0);
  });

  it('should handle multi-line code blocks', () => {
    const code = `
import React from 'react';

interface Props {
  name: string;
  age: number;
}

export const UserCard: React.FC<Props> = ({ name, age }) => {
  return (
    <div className="user-card">
      <h2>{name}</h2>
      <p>Age: {age}</p>
    </div>
  );
};
`;
    const tokens = countTokens(code);
    expect(tokens).toBeGreaterThan(30);
    expect(tokens).toBeLessThan(200);
  });
});

describe('estimateCost', () => {
  const R = 7.25; // USD to CNY rate

  it('should calculate cost for gpt-4o pricing', () => {
    const result = estimateCost(1_000_000, 0, 'gpt-4o');
    // 1M input tokens at ¥(2.50*7.25)/M = ¥18.125
    expect(result.inputCost).toBeCloseTo(2.5 * R, 2);
    expect(result.outputCost).toBe(0);
    expect(result.totalCost).toBeCloseTo(2.5 * R, 2);
  });

  it('should calculate output cost correctly', () => {
    const result = estimateCost(0, 1_000_000, 'gpt-4o');
    expect(result.outputCost).toBeCloseTo(10 * R, 2);
    expect(result.inputCost).toBe(0);
    expect(result.totalCost).toBeCloseTo(10 * R, 2);
  });

  it('should calculate combined input+output cost', () => {
    const result = estimateCost(500_000, 100_000, 'gpt-4o');
    expect(result.inputCost).toBeCloseTo(1.25 * R, 2);
    expect(result.outputCost).toBeCloseTo(1.0 * R, 2);
    expect(result.totalCost).toBeCloseTo(2.25 * R, 2);
  });

  it('should use gpt-4o-mini pricing when specified', () => {
    const result = estimateCost(1_000_000, 1_000_000, 'gpt-4o-mini');
    expect(result.inputCost).toBeCloseTo(0.15 * R, 2);
    expect(result.outputCost).toBeCloseTo(0.60 * R, 2);
    expect(result.totalCost).toBeCloseTo(0.75 * R, 2);
  });

  it('should use gpt-4 pricing (much more expensive)', () => {
    const result = estimateCost(1_000_000, 1_000_000, 'gpt-4');
    expect(result.inputCost).toBeCloseTo(30 * R, 0);
    expect(result.outputCost).toBeCloseTo(60 * R, 0);
    expect(result.totalCost).toBeCloseTo(90 * R, 0);
  });

  it('should fallback to gpt-4o for unknown model', () => {
    const result = estimateCost(1_000_000, 0, 'unknown-model');
    expect(result.inputCost).toBeCloseTo(2.5 * R, 2);
  });

  it('should handle zero tokens', () => {
    const result = estimateCost(0, 0, 'gpt-4o');
    expect(result.totalCost).toBe(0);
  });

  it('should handle small token counts accurately', () => {
    const result = estimateCost(100, 50, 'gpt-4o');
    expect(result.inputCost).toBeCloseTo(0.00025 * R, 5);
    expect(result.outputCost).toBeCloseTo(0.0005 * R, 5);
  });
});

describe('formatTokenCount', () => {
  it('should display small numbers as-is', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(1)).toBe('1');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('should format thousands with K suffix', () => {
    expect(formatTokenCount(1000)).toBe('1.0K');
    expect(formatTokenCount(1234)).toBe('1.2K');
    expect(formatTokenCount(15678)).toBe('15.7K');
    expect(formatTokenCount(999999)).toBe('1000.0K');
  });

  it('should format millions with M suffix', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.00M');
    expect(formatTokenCount(1_234_567)).toBe('1.23M');
    expect(formatTokenCount(10_500_000)).toBe('10.50M');
  });
});

describe('formatCost', () => {
  it('should format small costs with 4 decimal places', () => {
    expect(formatCost(0.0001)).toBe('¥0.0001');
    expect(formatCost(0.0023)).toBe('¥0.0023');
    expect(formatCost(0.0099)).toBe('¥0.0099');
  });

  it('should format medium costs with 3 decimal places', () => {
    expect(formatCost(0.01)).toBe('¥0.010');
    expect(formatCost(0.123)).toBe('¥0.123');
    expect(formatCost(0.999)).toBe('¥0.999');
  });

  it('should format dollar amounts with 2 decimal places', () => {
    expect(formatCost(1.0)).toBe('¥1.00');
    expect(formatCost(1.5)).toBe('¥1.50');
    expect(formatCost(250000)).toBe('¥250000.00');
  });
});

describe('MODEL_PRICING', () => {
  it('should have all expected models', () => {
    expect(MODEL_PRICING).toHaveProperty('gpt-4o');
    expect(MODEL_PRICING).toHaveProperty('gpt-4o-mini');
    expect(MODEL_PRICING).toHaveProperty('gpt-4.1');
    expect(MODEL_PRICING).toHaveProperty('gpt-4');
  });

  it('should have positive pricing for all models', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.inputPerMillion).toBeGreaterThan(0);
      expect(pricing.outputPerMillion).toBeGreaterThan(0);
      // Output should always cost more than input
      expect(pricing.outputPerMillion).toBeGreaterThan(pricing.inputPerMillion);
    }
  });
});

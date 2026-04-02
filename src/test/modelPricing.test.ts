import { describe, it, expect } from 'vitest';
import { resolveModelPricing, MODEL_PRICING } from '../tokenCounter';

describe('resolveModelPricing', () => {
  it('should resolve exact model names', () => {
    expect(resolveModelPricing('gpt-4o')).toBe('gpt-4o');
    expect(resolveModelPricing('gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(resolveModelPricing('claude-opus-4.6')).toBe('claude-opus-4.6');
  });

  it('should resolve Claude opus variants', () => {
    expect(resolveModelPricing('claude-opus-4-6')).toBe('claude-opus-4.6');
    expect(resolveModelPricing('claude-opus-4.6-20260415')).toBe('claude-opus-4.6');
    expect(resolveModelPricing('Claude-Opus-4.6')).toBe('claude-opus-4.6');
  });

  it('should resolve Claude sonnet variants', () => {
    expect(resolveModelPricing('claude-sonnet-4-20260414')).toBe('claude-sonnet-4');
    expect(resolveModelPricing('claude-sonnet-3.5')).toBe('claude-sonnet-3.5');
    expect(resolveModelPricing('claude-3-5-sonnet')).toBe('claude-sonnet-3.5');
  });

  it('should resolve GPT model variants with version suffixes', () => {
    expect(resolveModelPricing('gpt-4o-mini-2024-07-18')).toBe('gpt-4o-mini');
    expect(resolveModelPricing('gpt-4o-2024-11-20')).toBe('gpt-4o');
  });

  it('should default to gpt-4o for unknown models', () => {
    expect(resolveModelPricing('totally-unknown-model')).toBe('gpt-4o');
    expect(resolveModelPricing('')).toBe('gpt-4o');
  });
});

describe('MODEL_PRICING (extended)', () => {
  it('should have Claude models', () => {
    expect(MODEL_PRICING).toHaveProperty('claude-opus-4.6');
    expect(MODEL_PRICING).toHaveProperty('claude-sonnet-4');
    expect(MODEL_PRICING).toHaveProperty('claude-sonnet-3.5');
  });

  it('should have positive pricing for Claude models', () => {
    const opus = MODEL_PRICING['claude-opus-4.6'];
    expect(opus.inputPerMillion).toBeGreaterThan(0);
    expect(opus.outputPerMillion).toBeGreaterThan(opus.inputPerMillion);

    const sonnet = MODEL_PRICING['claude-sonnet-4'];
    expect(sonnet.inputPerMillion).toBeGreaterThan(0);
    expect(sonnet.outputPerMillion).toBeGreaterThan(sonnet.inputPerMillion);
  });

  it('should have Claude opus priced higher than sonnet', () => {
    const opus = MODEL_PRICING['claude-opus-4.6'];
    const sonnet = MODEL_PRICING['claude-sonnet-4'];
    expect(opus.inputPerMillion).toBeGreaterThan(sonnet.inputPerMillion);
    expect(opus.outputPerMillion).toBeGreaterThan(sonnet.outputPerMillion);
  });
});

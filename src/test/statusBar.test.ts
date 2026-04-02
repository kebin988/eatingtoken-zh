import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StatusBarManager } from '../statusBar';

describe('StatusBarManager', () => {
  let statusBar: StatusBarManager;

  beforeEach(() => {
    statusBar = new StatusBarManager();
  });

  afterEach(() => {
    statusBar.dispose();
  });

  describe('initialization', () => {
    it('should create without errors', () => {
      expect(statusBar).toBeDefined();
    });

    it('should return zero session stats initially', () => {
      const stats = statusBar.getSessionStats();
      expect(stats.inputTokens).toBe(0);
      expect(stats.outputTokens).toBe(0);
      expect(stats.cost).toBe(0);
    });
  });

  describe('addInputTokens', () => {
    it('should accumulate input tokens', () => {
      statusBar.addInputTokens(1000, 0.0025);
      statusBar.addInputTokens(2000, 0.005);

      const stats = statusBar.getSessionStats();
      expect(stats.inputTokens).toBe(3000);
      expect(stats.cost).toBeCloseTo(0.0075, 4);
    });
  });

  describe('addOutputTokens', () => {
    it('should accumulate output tokens', () => {
      statusBar.addOutputTokens(50, 0.0005);
      statusBar.addOutputTokens(100, 0.001);

      const stats = statusBar.getSessionStats();
      expect(stats.outputTokens).toBe(150);
      expect(stats.cost).toBeCloseTo(0.0015, 4);
    });
  });

  describe('combined tracking', () => {
    it('should track input and output separately but sum cost', () => {
      statusBar.addInputTokens(1000, 0.0025);
      statusBar.addOutputTokens(50, 0.0005);

      const stats = statusBar.getSessionStats();
      expect(stats.inputTokens).toBe(1000);
      expect(stats.outputTokens).toBe(50);
      expect(stats.cost).toBeCloseTo(0.003, 4);
    });
  });

  describe('resetSession', () => {
    it('should reset all counters to zero', () => {
      statusBar.addInputTokens(1000, 0.0025);
      statusBar.addOutputTokens(50, 0.0005);

      statusBar.resetSession();

      const stats = statusBar.getSessionStats();
      expect(stats.inputTokens).toBe(0);
      expect(stats.outputTokens).toBe(0);
      expect(stats.cost).toBe(0);
    });
  });

  describe('setFormat', () => {
    it('should accept different format values without errors', () => {
      expect(() => statusBar.setFormat('tokens-only')).not.toThrow();
      expect(() => statusBar.setFormat('cost-only')).not.toThrow();
      expect(() => statusBar.setFormat('tokens-and-cost')).not.toThrow();
    });
  });

  describe('setVisible', () => {
    it('should toggle visibility without errors', () => {
      expect(() => statusBar.setVisible(true)).not.toThrow();
      expect(() => statusBar.setVisible(false)).not.toThrow();
    });
  });
});

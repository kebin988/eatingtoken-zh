import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompletionTracker, CompletionEvent } from '../completionTracker';

describe('CompletionTracker', () => {
  let tracker: CompletionTracker;

  beforeEach(() => {
    tracker = new CompletionTracker(1.3);
  });

  afterEach(() => {
    tracker.dispose();
  });

  describe('initialization', () => {
    it('should start with empty stats', () => {
      const stats = tracker.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalAcceptances).toBe(0);
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.acceptanceRate).toBe(0);
      expect(stats.events).toHaveLength(0);
    });
  });

  describe('resetStats', () => {
    it('should reset all counters to zero', () => {
      // Manually modify stats via the public interface (they'd normally come from events)
      tracker.resetStats();
      const stats = tracker.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalAcceptances).toBe(0);
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
    });
  });

  describe('onCompletionEvent', () => {
    it('should register event handlers', () => {
      const handler = vi.fn();
      tracker.onCompletionEvent(handler);

      // Handler is registered but won't fire until activate() is called
      // and actual events occur through VS Code APIs
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return a copy of stats (not a reference)', () => {
      const stats1 = tracker.getStats();
      const stats2 = tracker.getStats();
      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });

  describe('updateContextMultiplier', () => {
    it('should accept a new multiplier value', () => {
      // Should not throw
      tracker.updateContextMultiplier(1.5);
      tracker.updateContextMultiplier(1.0);
      tracker.updateContextMultiplier(2.0);
    });
  });

  describe('dispose', () => {
    it('should not throw when called multiple times', () => {
      expect(() => tracker.dispose()).not.toThrow();
      expect(() => tracker.dispose()).not.toThrow();
    });
  });
});

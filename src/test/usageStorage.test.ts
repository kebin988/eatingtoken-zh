import { describe, it, expect, beforeEach } from 'vitest';
import { UsageStorage, DailyUsage } from '../usageStorage';

/**
 * In-memory mock of vscode.Memento for testing.
 */
class MockMemento {
  private store: Record<string, any> = {};

  get<T>(key: string, defaultValue: T): T {
    return this.store[key] !== undefined ? this.store[key] : defaultValue;
  }

  async update(key: string, value: any): Promise<void> {
    this.store[key] = value;
  }

  keys(): readonly string[] {
    return Object.keys(this.store);
  }

  setKeysForSync(_keys: readonly string[]): void {}
}

describe('UsageStorage', () => {
  let memento: MockMemento;
  let storage: UsageStorage;

  beforeEach(() => {
    memento = new MockMemento();
    storage = new UsageStorage(memento as any);
  });

  describe('recordRequest', () => {
    it('should record a request for today', async () => {
      await storage.recordRequest('typescript', 1000, 0.0025);

      const today = storage.getToday();
      expect(today.totalRequests).toBe(1);
      expect(today.totalInputTokens).toBe(1000);
      expect(today.estimatedCostUsd).toBeCloseTo(0.0025, 4);
    });

    it('should accumulate multiple requests', async () => {
      await storage.recordRequest('typescript', 1000, 0.0025);
      await storage.recordRequest('typescript', 2000, 0.005);
      await storage.recordRequest('python', 500, 0.00125);

      const today = storage.getToday();
      expect(today.totalRequests).toBe(3);
      expect(today.totalInputTokens).toBe(3500);
      expect(today.estimatedCostUsd).toBeCloseTo(0.00875, 5);
    });

    it('should track by language', async () => {
      await storage.recordRequest('typescript', 1000, 0.0025);
      await storage.recordRequest('python', 500, 0.00125);

      const today = storage.getToday();
      expect(today.byLanguage['typescript'].requests).toBe(1);
      expect(today.byLanguage['typescript'].inputTokens).toBe(1000);
      expect(today.byLanguage['python'].requests).toBe(1);
      expect(today.byLanguage['python'].inputTokens).toBe(500);
    });
  });

  describe('recordAcceptance', () => {
    it('should record an acceptance for today', async () => {
      await storage.recordAcceptance('typescript', 50, 0.0005);

      const today = storage.getToday();
      expect(today.totalAcceptances).toBe(1);
      expect(today.totalOutputTokens).toBe(50);
    });

    it('should track language for acceptances', async () => {
      await storage.recordAcceptance('javascript', 100, 0.001);

      const today = storage.getToday();
      expect(today.byLanguage['javascript'].acceptances).toBe(1);
      expect(today.byLanguage['javascript'].outputTokens).toBe(100);
    });
  });

  describe('getLastNDays', () => {
    it('should return N entries even if no data exists', () => {
      const days = storage.getLastNDays(7);
      expect(days).toHaveLength(7);
      days.forEach((day) => {
        expect(day.totalRequests).toBe(0);
        expect(day.totalInputTokens).toBe(0);
      });
    });

    it('should include today in the results', async () => {
      await storage.recordRequest('typescript', 1000, 0.0025);
      const days = storage.getLastNDays(7);

      // First entry (index 0) is today
      expect(days[0].totalRequests).toBe(1);
      expect(days[0].totalInputTokens).toBe(1000);
    });
  });

  describe('getSummary', () => {
    it('should return a valid summary with no data', () => {
      const summary = storage.getSummary();
      expect(summary.today.totalRequests).toBe(0);
      expect(summary.thisWeek).toHaveLength(7);
      expect(summary.thisMonth).toHaveLength(30);
      expect(summary.allTime.totalRequests).toBe(0);
      expect(summary.allTime.totalCostUsd).toBe(0);
    });

    it('should aggregate all-time stats correctly', async () => {
      await storage.recordRequest('typescript', 1000, 0.0025);
      await storage.recordRequest('python', 2000, 0.005);
      await storage.recordAcceptance('typescript', 100, 0.001);

      const summary = storage.getSummary();
      expect(summary.allTime.totalRequests).toBe(2);
      expect(summary.allTime.totalAcceptances).toBe(1);
      expect(summary.allTime.totalInputTokens).toBe(3000);
      expect(summary.allTime.totalOutputTokens).toBe(100);
      expect(summary.allTime.totalCostUsd).toBeCloseTo(0.0085, 4);
    });
  });

  describe('exportAsJson', () => {
    it('should export valid JSON', async () => {
      await storage.recordRequest('typescript', 1000, 0.0025);

      const json = storage.exportAsJson();
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('exportDate');
      expect(parsed).toHaveProperty('dailyUsage');
      expect(parsed).toHaveProperty('summary');
      expect(Array.isArray(parsed.dailyUsage)).toBe(true);
      expect(parsed.dailyUsage.length).toBeGreaterThan(0);
    });

    it('should export empty data correctly', () => {
      const json = storage.exportAsJson();
      const parsed = JSON.parse(json);

      expect(parsed.dailyUsage).toHaveLength(0);
    });
  });

  describe('resetAll', () => {
    it('should clear all stored data', async () => {
      await storage.recordRequest('typescript', 1000, 0.0025);
      await storage.recordAcceptance('typescript', 50, 0.0005);

      await storage.resetAll();

      const today = storage.getToday();
      expect(today.totalRequests).toBe(0);
      expect(today.totalInputTokens).toBe(0);

      const summary = storage.getSummary();
      expect(summary.allTime.totalRequests).toBe(0);
    });
  });

  describe('persistence', () => {
    it('should persist data across storage instances', async () => {
      await storage.recordRequest('typescript', 1000, 0.0025);

      // Create a new storage instance with the same memento
      const storage2 = new UsageStorage(memento as any);
      const today = storage2.getToday();

      expect(today.totalRequests).toBe(1);
      expect(today.totalInputTokens).toBe(1000);
    });
  });

  describe('date-aware recording', () => {
    it('should record a request under a historical date when timestamp is provided', async () => {
      // March 15, 2026 at noon UTC
      const historicalTimestamp = new Date('2026-03-15T12:00:00.000Z').getTime();
      await storage.recordRequest('copilot-agent', 50000, 0.125, historicalTimestamp);

      // Today should be empty
      const today = storage.getToday();
      expect(today.totalRequests).toBe(0);
      expect(today.totalInputTokens).toBe(0);

      // The historical date should have the data
      const summary = storage.getSummary();
      expect(summary.allTime.totalRequests).toBe(1);
      expect(summary.allTime.totalInputTokens).toBe(50000);
    });

    it('should record an acceptance under a historical date when timestamp is provided', async () => {
      const historicalTimestamp = new Date('2026-03-10T08:30:00.000Z').getTime();
      await storage.recordAcceptance('copilot-agent', 2000, 0.15, historicalTimestamp);

      const today = storage.getToday();
      expect(today.totalAcceptances).toBe(0);
      expect(today.totalOutputTokens).toBe(0);

      const summary = storage.getSummary();
      expect(summary.allTime.totalAcceptances).toBe(1);
      expect(summary.allTime.totalOutputTokens).toBe(2000);
    });

    it('should record under today when no timestamp is provided', async () => {
      await storage.recordRequest('typescript', 1000, 0.0025);
      await storage.recordAcceptance('typescript', 50, 0.0005);

      const today = storage.getToday();
      expect(today.totalRequests).toBe(1);
      expect(today.totalInputTokens).toBe(1000);
      expect(today.totalAcceptances).toBe(1);
      expect(today.totalOutputTokens).toBe(50);
    });

    it('should distribute events across multiple historical dates', async () => {
      const march10 = new Date('2026-03-10T10:00:00.000Z').getTime();
      const march11 = new Date('2026-03-11T14:00:00.000Z').getTime();
      const march12 = new Date('2026-03-12T09:00:00.000Z').getTime();

      await storage.recordRequest('copilot-agent', 100000, 1.50, march10);
      await storage.recordRequest('copilot-agent', 200000, 3.00, march11);
      await storage.recordAcceptance('copilot-agent', 5000, 0.375, march10);
      await storage.recordRequest('copilot-agent', 150000, 2.25, march12);

      const summary = storage.getSummary();
      expect(summary.allTime.totalRequests).toBe(3);
      expect(summary.allTime.totalInputTokens).toBe(450000);
      expect(summary.allTime.totalAcceptances).toBe(1);
      expect(summary.allTime.totalOutputTokens).toBe(5000);
      expect(summary.allTime.firstTrackedDate).toBe('2026-03-10');
    });

    it('should correctly aggregate historical and current data in summary', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayTimestamp = yesterday.getTime();

      await storage.recordRequest('copilot-agent', 80000, 1.20, yesterdayTimestamp);
      await storage.recordRequest('typescript', 1000, 0.0025); // today, no timestamp

      const summary = storage.getSummary();
      expect(summary.allTime.totalRequests).toBe(2);
      expect(summary.allTime.totalInputTokens).toBe(81000);

      // Today should only have the typescript request
      expect(summary.today.totalRequests).toBe(1);
      expect(summary.today.totalInputTokens).toBe(1000);

      // This week should include both days
      const weekTotal = summary.thisWeek.reduce((sum, d) => sum + d.totalInputTokens, 0);
      expect(weekTotal).toBe(81000);
    });
  });
});

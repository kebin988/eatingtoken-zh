/**
 * Persistent storage for usage data.
 * Stores daily aggregates in VS Code's globalState.
 */

import * as vscode from 'vscode';

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  totalRequests: number;
  totalAcceptances: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  /** Breakdown by language */
  byLanguage: Record<string, {
    requests: number;
    acceptances: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  /** Breakdown by model (e.g., claude-opus-4.6, gpt-4o-mini) */
  byModel: Record<string, {
    requests: number;
    acceptances: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
}

export interface UsageSummary {
  today: DailyUsage;
  thisWeek: DailyUsage[];
  thisMonth: DailyUsage[];
  allTime: {
    totalRequests: number;
    totalAcceptances: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    firstTrackedDate: string;
  };
}

const STORAGE_KEY = 'eatingtoken.usageData';

export class UsageStorage {
  private globalState: vscode.Memento;
  private dailyData: Map<string, DailyUsage> = new Map();

  constructor(globalState: vscode.Memento) {
    this.globalState = globalState;
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const stored = this.globalState.get<Record<string, DailyUsage>>(STORAGE_KEY, {});
    this.dailyData = new Map(Object.entries(stored));
  }

  private async saveToStorage(): Promise<void> {
    const obj: Record<string, DailyUsage> = {};
    this.dailyData.forEach((value, key) => {
      obj[key] = value;
    });
    await this.globalState.update(STORAGE_KEY, obj);
  }

  private getTodayKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Convert a timestamp (ms since epoch) to a YYYY-MM-DD date key.
   */
  private timestampToDateKey(timestamp: number): string {
    return new Date(timestamp).toISOString().split('T')[0];
  }

  private getOrCreateDay(dateKey: string): DailyUsage {
    if (!this.dailyData.has(dateKey)) {
      this.dailyData.set(dateKey, {
        date: dateKey,
        totalRequests: 0,
        totalAcceptances: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        estimatedCostUsd: 0,
        byLanguage: {},
        byModel: {},
      });
    }
    const day = this.dailyData.get(dateKey)!;
    // Backwards-compat: old stored data may not have byModel
    if (!day.byModel) {
      day.byModel = {};
    }
    return day;
  }

  private getOrCreateToday(): DailyUsage {
    return this.getOrCreateDay(this.getTodayKey());
  }

  /**
   * Record a completion request.
   * @param language - The language or source identifier
   * @param inputTokens - Number of input tokens
   * @param costUsd - Estimated cost in USD
   * @param timestamp - Optional event timestamp (ms since epoch). Defaults to now.
   * @param model - Optional model name (e.g., 'claude-opus-4.6', 'gpt-4o')
   */
  async recordRequest(language: string, inputTokens: number, costUsd: number, timestamp?: number, model?: string): Promise<void> {
    const dateKey = timestamp ? this.timestampToDateKey(timestamp) : this.getTodayKey();
    const day = this.getOrCreateDay(dateKey);
    day.totalRequests++;
    day.totalInputTokens += inputTokens;
    day.estimatedCostUsd += costUsd;

    if (!day.byLanguage[language]) {
      day.byLanguage[language] = { requests: 0, acceptances: 0, inputTokens: 0, outputTokens: 0 };
    }
    day.byLanguage[language].requests++;
    day.byLanguage[language].inputTokens += inputTokens;

    if (model) {
      if (!day.byModel[model]) {
        day.byModel[model] = { requests: 0, acceptances: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      }
      day.byModel[model].requests++;
      day.byModel[model].inputTokens += inputTokens;
      day.byModel[model].costUsd += costUsd;
    }

    await this.saveToStorage();
  }

  /**
   * Record a completion acceptance.
   * @param language - The language or source identifier
   * @param outputTokens - Number of output tokens
   * @param costUsd - Estimated cost in USD
   * @param timestamp - Optional event timestamp (ms since epoch). Defaults to now.
   * @param model - Optional model name (e.g., 'claude-opus-4.6', 'gpt-4o')
   */
  async recordAcceptance(language: string, outputTokens: number, costUsd: number, timestamp?: number, model?: string): Promise<void> {
    const dateKey = timestamp ? this.timestampToDateKey(timestamp) : this.getTodayKey();
    const day = this.getOrCreateDay(dateKey);
    day.totalAcceptances++;
    day.totalOutputTokens += outputTokens;
    day.estimatedCostUsd += costUsd;

    if (!day.byLanguage[language]) {
      day.byLanguage[language] = { requests: 0, acceptances: 0, inputTokens: 0, outputTokens: 0 };
    }
    day.byLanguage[language].acceptances++;
    day.byLanguage[language].outputTokens += outputTokens;

    if (model) {
      if (!day.byModel[model]) {
        day.byModel[model] = { requests: 0, acceptances: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      }
      day.byModel[model].acceptances++;
      day.byModel[model].outputTokens += outputTokens;
      day.byModel[model].costUsd += costUsd;
    }

    await this.saveToStorage();
  }

  /**
   * Get today's usage data.
   */
  getToday(): DailyUsage {
    return this.getOrCreateToday();
  }

  /**
   * Get usage data for the past N days.
   */
  getLastNDays(n: number): DailyUsage[] {
    const result: DailyUsage[] = [];
    const now = new Date();

    for (let i = 0; i < n; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const key = date.toISOString().split('T')[0];
      const data = this.dailyData.get(key);
      if (data) {
        result.push(data);
      } else {
        result.push({
          date: key,
          totalRequests: 0,
          totalAcceptances: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          estimatedCostUsd: 0,
          byLanguage: {},
          byModel: {},
        });
      }
    }

    return result;
  }

  /**
   * Get a full usage summary.
   */
  getSummary(): UsageSummary {
    const today = this.getOrCreateToday();
    const thisWeek = this.getLastNDays(7);
    const thisMonth = this.getLastNDays(30);

    let totalRequests = 0;
    let totalAcceptances = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;
    let firstDate = this.getTodayKey();

    this.dailyData.forEach((data) => {
      totalRequests += data.totalRequests;
      totalAcceptances += data.totalAcceptances;
      totalInputTokens += data.totalInputTokens;
      totalOutputTokens += data.totalOutputTokens;
      totalCostUsd += data.estimatedCostUsd;
      if (data.date < firstDate) {
        firstDate = data.date;
      }
    });

    return {
      today,
      thisWeek,
      thisMonth,
      allTime: {
        totalRequests,
        totalAcceptances,
        totalInputTokens,
        totalOutputTokens,
        totalCostUsd,
        firstTrackedDate: firstDate,
      },
    };
  }

  /**
   * Export all data as JSON.
   */
  exportAsJson(): string {
    const allData: DailyUsage[] = [];
    this.dailyData.forEach((data) => allData.push(data));
    allData.sort((a, b) => a.date.localeCompare(b.date));

    return JSON.stringify({
      exportDate: new Date().toISOString(),
      dailyUsage: allData,
      summary: this.getSummary(),
    }, null, 2);
  }

  /**
   * Reset all stored data.
   */
  async resetAll(): Promise<void> {
    this.dailyData.clear();
    await this.saveToStorage();
  }
}

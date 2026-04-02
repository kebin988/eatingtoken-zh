/**
 * Status bar module.
 * Shows real-time token consumption and estimated cost in the VS Code status bar.
 */

import * as vscode from 'vscode';
import { formatTokenCount, formatCost } from './tokenCounter';

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private sessionInputTokens: number = 0;
  private sessionOutputTokens: number = 0;
  private sessionCost: number = 0;
  private format: string = 'tokens-and-cost';

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      50
    );
    this.statusBarItem.command = 'eatingtoken.showDashboard';
    this.statusBarItem.tooltip = 'Click to open Eating Token dashboard';
    this.updateDisplay();
    this.statusBarItem.show();
  }

  setFormat(format: string): void {
    this.format = format;
    this.updateDisplay();
  }

  addInputTokens(tokens: number, cost: number): void {
    this.sessionInputTokens += tokens;
    this.sessionCost += cost;
    this.updateDisplay();
  }

  addOutputTokens(tokens: number, cost: number): void {
    this.sessionOutputTokens += tokens;
    this.sessionCost += cost;
    this.updateDisplay();
  }

  private updateDisplay(): void {
    const totalTokens = this.sessionInputTokens + this.sessionOutputTokens;
    const tokensStr = formatTokenCount(totalTokens);
    const costStr = formatCost(this.sessionCost);

    switch (this.format) {
      case 'tokens-only':
        this.statusBarItem.text = `$(flame) ${tokensStr} tokens`;
        break;
      case 'cost-only':
        this.statusBarItem.text = `$(flame) ${costStr}`;
        break;
      case 'tokens-and-cost':
      default:
        this.statusBarItem.text = `$(flame) ${tokensStr} | ${costStr}`;
        break;
    }

    this.statusBarItem.tooltip = [
      'Eating Token - Copilot Usage Tracker',
      `Session Input: ${formatTokenCount(this.sessionInputTokens)} tokens`,
      `Session Output: ${formatTokenCount(this.sessionOutputTokens)} tokens`,
      `Estimated Cost: ${costStr}`,
      '',
      'Click to open dashboard',
    ].join('\n');
  }

  resetSession(): void {
    this.sessionInputTokens = 0;
    this.sessionOutputTokens = 0;
    this.sessionCost = 0;
    this.updateDisplay();
  }

  getSessionStats() {
    return {
      inputTokens: this.sessionInputTokens,
      outputTokens: this.sessionOutputTokens,
      cost: this.sessionCost,
    };
  }

  setVisible(visible: boolean): void {
    if (visible) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}

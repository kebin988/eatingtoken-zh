/**
 * Completion tracker module.
 * Detects Copilot inline completion requests and acceptances using heuristics.
 *
 * Strategy:
 * 1. Register an InlineCompletionItemProvider to detect when completions are requested
 * 2. Monitor document changes to detect large insertions (likely accepted completions)
 * 3. Intercept the Tab keybinding to detect suggestion acceptance
 * 4. Correlate timing between requests and insertions
 */

import * as vscode from 'vscode';
import { countTokens } from './tokenCounter';

export interface CompletionEvent {
  timestamp: number;
  type: 'request' | 'acceptance';
  file: string;
  language: string;
  /** Estimated input tokens (context sent to Copilot) */
  inputTokens: number;
  /** Estimated output tokens (completion received) */
  outputTokens: number;
  /** The accepted completion text (only for acceptances) */
  completionText?: string;
}

export interface CompletionStats {
  totalRequests: number;
  totalAcceptances: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  acceptanceRate: number;
  events: CompletionEvent[];
}

type CompletionEventHandler = (event: CompletionEvent) => void;

/**
 * Tracks Copilot completions using heuristic detection.
 */
export class CompletionTracker implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private stats: CompletionStats = {
    totalRequests: 0,
    totalAcceptances: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    acceptanceRate: 0,
    events: [],
  };

  private contextMultiplier: number;
  private lastRequestTime: number = 0;
  private lastRequestFile: string = '';
  private lastDocumentVersion: Map<string, number> = new Map();
  private pendingCompletionRequest: boolean = false;
  private eventHandlers: CompletionEventHandler[] = [];

  /** Debounce timer for document change detection */
  private changeDebounceTimer: NodeJS.Timeout | undefined;

  constructor(contextMultiplier: number = 1.3) {
    this.contextMultiplier = contextMultiplier;
  }

  /**
   * Register a handler to be called on every completion event.
   */
  onCompletionEvent(handler: CompletionEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Start tracking completions.
   */
  activate(context: vscode.ExtensionContext): void {
    // 1. Register inline completion provider to detect requests
    const inlineProvider = vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      {
        provideInlineCompletionItems: (document, position, completionContext, token) => {
          this.onCompletionRequested(document, position);
          return []; // Return empty - we don't provide actual completions
        },
      }
    );
    this.disposables.push(inlineProvider);

    // 2. Monitor document changes for accepted completions
    const docChangeListener = vscode.workspace.onDidChangeTextDocument(
      (event) => this.onDocumentChanged(event)
    );
    this.disposables.push(docChangeListener);

    // 3. Track document versions to detect non-typing insertions
    const docOpenListener = vscode.workspace.onDidOpenTextDocument((doc) => {
      this.lastDocumentVersion.set(doc.uri.toString(), doc.version);
    });
    this.disposables.push(docOpenListener);

    // Initialize versions for already-open documents
    vscode.workspace.textDocuments.forEach((doc) => {
      this.lastDocumentVersion.set(doc.uri.toString(), doc.version);
    });

    // 4. Register command to intercept Tab for inline suggestion acceptance
    this.registerTabInterceptor();
  }

  /**
   * Called when our inline completion provider is invoked (parallel with Copilot).
   */
  private onCompletionRequested(document: vscode.TextDocument, position: vscode.Position): void {
    const now = Date.now();
    this.lastRequestTime = now;
    this.lastRequestFile = document.uri.toString();
    this.pendingCompletionRequest = true;

    // Estimate input tokens: current file content * context multiplier
    const fileText = document.getText();
    const rawTokens = countTokens(fileText);
    const estimatedInputTokens = Math.ceil(rawTokens * this.contextMultiplier);

    const event: CompletionEvent = {
      timestamp: now,
      type: 'request',
      file: document.uri.fsPath,
      language: document.languageId,
      inputTokens: estimatedInputTokens,
      outputTokens: 0,
    };

    this.stats.totalRequests++;
    this.stats.totalInputTokens += estimatedInputTokens;
    this.stats.events.push(event);
    this.emitEvent(event);
  }

  /**
   * Called when a document changes. Uses heuristics to detect accepted completions.
   */
  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    // Ignore undo/redo
    if (event.reason === vscode.TextDocumentChangeReason.Undo ||
        event.reason === vscode.TextDocumentChangeReason.Redo) {
      return;
    }

    // Debounce rapid changes
    if (this.changeDebounceTimer) {
      clearTimeout(this.changeDebounceTimer);
    }

    this.changeDebounceTimer = setTimeout(() => {
      this.processDocumentChange(event);
    }, 50);
  }

  private processDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    const now = Date.now();
    const timeSinceRequest = now - this.lastRequestTime;

    for (const change of event.contentChanges) {
      // Heuristic: A completion acceptance is likely if:
      // 1. The insertion is multi-character (> 5 chars)
      // 2. It happened within 10 seconds of a completion request
      // 3. It's not replacing existing text (rangeLength is small)
      // 4. It's in the same file where completion was requested

      const isLargeInsertion = change.text.length > 5;
      const isRecentRequest = timeSinceRequest < 10000;
      const isNotReplacement = change.rangeLength <= 1;
      const isSameFile = event.document.uri.toString() === this.lastRequestFile;
      const isNotPaste = change.text.length < 2000; // Very large = likely paste

      if (isLargeInsertion && isRecentRequest && isNotReplacement && isSameFile && isNotPaste) {
        const outputTokens = countTokens(change.text);

        const completionEvent: CompletionEvent = {
          timestamp: now,
          type: 'acceptance',
          file: event.document.uri.fsPath,
          language: event.document.languageId,
          inputTokens: 0,
          outputTokens,
          completionText: change.text,
        };

        this.stats.totalAcceptances++;
        this.stats.totalOutputTokens += outputTokens;
        this.updateAcceptanceRate();
        this.stats.events.push(completionEvent);
        this.pendingCompletionRequest = false;
        this.emitEvent(completionEvent);
      }
    }
  }

  /**
   * Register a keybinding interceptor for Tab to detect inline suggestion acceptance.
   * This provides a more reliable signal than document change heuristics alone.
   */
  private registerTabInterceptor(): void {
    const tabCommand = vscode.commands.registerCommand(
      'eatingtoken.acceptSuggestion',
      async () => {
        // Mark that the next document change is likely a completion acceptance
        this.pendingCompletionRequest = true;
        this.lastRequestTime = Date.now();

        // Forward to the real accept command
        await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
      }
    );
    this.disposables.push(tabCommand);
  }

  private updateAcceptanceRate(): void {
    if (this.stats.totalRequests > 0) {
      this.stats.acceptanceRate = this.stats.totalAcceptances / this.stats.totalRequests;
    }
  }

  private emitEvent(event: CompletionEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  getStats(): CompletionStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      totalAcceptances: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      acceptanceRate: 0,
      events: [],
    };
  }

  updateContextMultiplier(multiplier: number): void {
    this.contextMultiplier = multiplier;
  }

  dispose(): void {
    if (this.changeDebounceTimer) {
      clearTimeout(this.changeDebounceTimer);
    }
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

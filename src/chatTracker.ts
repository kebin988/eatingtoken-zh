/**
 * Chat tracker module.
 * Tracks Copilot Chat usage by observing its side-effects:
 *
 * Since we can't intercept Chat messages directly, we track:
 * 1. File creation/modification from chat actions (Apply, Insert)
 * 2. Large multi-file edits that happen in bursts (typical of chat Apply)
 * 3. New file creation events (chat often creates new files)
 * 4. Workspace edit batches (chat Apply uses workspace edits)
 *
 * We also monitor the active editor for signs of chat interaction:
 * - Rapid large insertions across multiple files
 * - File creation bursts
 * - Document saves after chat-like edit patterns
 */

import * as vscode from 'vscode';
import { countTokens } from './tokenCounter';

export interface ChatEvent {
  timestamp: number;
  type: 'chat-edit' | 'chat-file-create' | 'chat-bulk-edit';
  files: string[];
  language: string;
  /** Estimated tokens for the content that was inserted/modified */
  estimatedOutputTokens: number;
  /** Estimated input tokens (we estimate what context chat likely used) */
  estimatedInputTokens: number;
  /** Total lines changed */
  linesChanged: number;
}

export interface ChatStats {
  totalChatEdits: number;
  totalChatInputTokens: number;
  totalChatOutputTokens: number;
  events: ChatEvent[];
}

type ChatEventHandler = (event: ChatEvent) => void;

/**
 * Tracks Copilot Chat activity by observing document/workspace changes.
 */
export class ChatTracker implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private stats: ChatStats = {
    totalChatEdits: 0,
    totalChatInputTokens: 0,
    totalChatOutputTokens: 0,
    events: [],
  };

  private eventHandlers: ChatEventHandler[] = [];

  /**
   * Track recent edit bursts to detect chat Apply patterns.
   * Chat Apply typically modifies multiple ranges in a single file or
   * multiple files in rapid succession.
   */
  private recentEdits: Array<{
    timestamp: number;
    file: string;
    insertedChars: number;
    linesChanged: number;
  }> = [];

  /** Files being tracked for chat-like edit patterns */
  private fileSnapshots: Map<string, { content: string; version: number }> = new Map();

  /** Debounce timer for burst detection */
  private burstTimer: NodeJS.Timeout | undefined;

  /** Context multiplier for estimating chat input tokens */
  private contextMultiplier: number;

  constructor(contextMultiplier: number = 2.0) {
    // Chat sends more context than inline completions (conversation history,
    // referenced files, workspace search results, etc.)
    this.contextMultiplier = contextMultiplier;
  }

  onChatEvent(handler: ChatEventHandler): void {
    this.eventHandlers.push(handler);
  }

  activate(context: vscode.ExtensionContext): void {
    // 1. Track document changes for chat-like edit patterns
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.onDocumentChanged(event);
      })
    );

    // 2. Track new file creation (chat often creates files)
    this.disposables.push(
      vscode.workspace.onDidCreateFiles((event) => {
        this.onFilesCreated(event);
      })
    );

    // 3. Snapshot files when they're opened (to diff later)
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        this.snapshotFile(doc);
      })
    );

    // 4. Track when active editor changes (chat switches between files)
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document) {
          this.snapshotFile(editor.document);
        }
      })
    );

    // Snapshot all currently open documents
    vscode.workspace.textDocuments.forEach((doc) => {
      this.snapshotFile(doc);
    });
  }

  private snapshotFile(doc: vscode.TextDocument): void {
    if (doc.uri.scheme !== 'file') { return; }
    this.fileSnapshots.set(doc.uri.toString(), {
      content: doc.getText(),
      version: doc.version,
    });
  }

  /**
   * Detect chat-like edit patterns in document changes.
   *
   * Chat Apply/Insert produces edits that look different from normal typing:
   * - Multiple ranges edited in a single change event
   * - Large insertions (whole functions, classes, blocks)
   * - Rapid edits across multiple files
   * - Replacements of existing code with new code
   */
  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (event.document.uri.scheme !== 'file') { return; }

    // Ignore undo/redo
    if (event.reason === vscode.TextDocumentChangeReason.Undo ||
        event.reason === vscode.TextDocumentChangeReason.Redo) {
      return;
    }

    const now = Date.now();
    let totalInserted = 0;
    let totalLinesChanged = 0;
    let isLargeEdit = false;
    let isMultiRangeEdit = false;

    for (const change of event.contentChanges) {
      totalInserted += change.text.length;
      totalLinesChanged += change.text.split('\n').length - 1 + (change.range.end.line - change.range.start.line);

      // A single change replacing substantial code is a chat pattern
      if (change.text.length > 50 && change.rangeLength > 10) {
        isLargeEdit = true;
      }
    }

    // Multiple ranges in one event is a strong chat Apply signal
    if (event.contentChanges.length > 1) {
      isMultiRangeEdit = true;
    }

    // Large single insertion (> 200 chars) with replacement is chat-like
    // Normal typing/inline completion is smaller and doesn't replace
    if (isLargeEdit || isMultiRangeEdit || totalInserted > 200) {
      this.recentEdits.push({
        timestamp: now,
        file: event.document.uri.toString(),
        insertedChars: totalInserted,
        linesChanged: totalLinesChanged,
      });

      // Clean old edits (keep last 5 seconds)
      this.recentEdits = this.recentEdits.filter(e => now - e.timestamp < 5000);

      // Debounce: wait for the burst to finish before analyzing
      if (this.burstTimer) { clearTimeout(this.burstTimer); }
      this.burstTimer = setTimeout(() => {
        this.analyzeBurst(event.document);
      }, 500);
    }
  }

  /**
   * Analyze a burst of edits to determine if it's a chat action.
   */
  private analyzeBurst(lastDocument: vscode.TextDocument): void {
    const now = Date.now();
    const recentWindow = this.recentEdits.filter(e => now - e.timestamp < 5000);

    if (recentWindow.length === 0) { return; }

    // Calculate metrics for this burst
    const totalChars = recentWindow.reduce((sum, e) => sum + e.insertedChars, 0);
    const totalLines = recentWindow.reduce((sum, e) => sum + e.linesChanged, 0);
    const uniqueFiles = new Set(recentWindow.map(e => e.file));
    const editCount = recentWindow.length;

    // Heuristics to distinguish chat edits from normal editing:
    //
    // Chat Apply patterns:
    // - Multiple edits in rapid succession (editCount > 2 in 5 sec)
    // - Large total insertion (> 200 chars)
    // - Multi-file edits (> 1 file in burst)
    // - Multi-range edits in single file
    //
    // NOT chat (probably inline completion or normal typing):
    // - Single small insertion
    // - Already tracked by CompletionTracker

    const isChatLikely =
      (totalChars > 200 && editCount >= 2) ||   // Multiple edits, substantial content
      (uniqueFiles.size > 1) ||                   // Multi-file edit burst
      (totalChars > 500) ||                       // Very large single-file edit
      (totalLines > 10 && editCount >= 2);        // Many lines changed in burst

    if (!isChatLikely) {
      this.recentEdits = [];
      return;
    }

    // Estimate tokens
    const outputTokens = countTokens(
      recentWindow.map(e => 'x'.repeat(e.insertedChars)).join('')
    );

    // Chat input typically includes: conversation history + referenced files + workspace context
    // Estimate: the edited file's content * multiplier
    const fileContent = lastDocument.getText();
    const fileTokens = countTokens(fileContent);
    const inputTokens = Math.ceil(fileTokens * this.contextMultiplier);

    const chatEvent: ChatEvent = {
      timestamp: now,
      type: uniqueFiles.size > 1 ? 'chat-bulk-edit' : 'chat-edit',
      files: Array.from(uniqueFiles),
      language: lastDocument.languageId,
      estimatedOutputTokens: outputTokens,
      estimatedInputTokens: inputTokens,
      linesChanged: totalLines,
    };

    this.stats.totalChatEdits++;
    this.stats.totalChatInputTokens += inputTokens;
    this.stats.totalChatOutputTokens += outputTokens;
    this.stats.events.push(chatEvent);
    this.emitEvent(chatEvent);

    // Clear the burst
    this.recentEdits = [];
  }

  /**
   * Track file creation events -- chat frequently creates new files.
   */
  private onFilesCreated(event: vscode.FileCreateEvent): void {
    // Small delay to let the file content be written
    setTimeout(async () => {
      for (const uri of event.files) {
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          const content = doc.getText();

          if (content.length < 10) { continue; } // Skip empty/trivial files

          const outputTokens = countTokens(content);
          const inputTokens = Math.ceil(outputTokens * this.contextMultiplier);

          const chatEvent: ChatEvent = {
            timestamp: Date.now(),
            type: 'chat-file-create',
            files: [uri.fsPath],
            language: doc.languageId,
            estimatedOutputTokens: outputTokens,
            estimatedInputTokens: inputTokens,
            linesChanged: content.split('\n').length,
          };

          this.stats.totalChatEdits++;
          this.stats.totalChatInputTokens += inputTokens;
          this.stats.totalChatOutputTokens += outputTokens;
          this.stats.events.push(chatEvent);
          this.emitEvent(chatEvent);
        } catch {
          // File might not be readable
        }
      }
    }, 1000);
  }

  private emitEvent(event: ChatEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  getStats(): ChatStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      totalChatEdits: 0,
      totalChatInputTokens: 0,
      totalChatOutputTokens: 0,
      events: [],
    };
    this.recentEdits = [];
  }

  updateContextMultiplier(multiplier: number): void {
    this.contextMultiplier = multiplier;
  }

  dispose(): void {
    if (this.burstTimer) { clearTimeout(this.burstTimer); }
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}

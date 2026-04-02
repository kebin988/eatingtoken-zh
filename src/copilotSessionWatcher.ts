// Copilot Session Watcher
//
// Watches ~/.copilot/session-state/<id>/events.jsonl files for ACTUAL token data.
//
// These files are written by GitHub Copilot's agent (Copilot Chat in VS Code,
// Copilot CLI, etc.) and contain structured events including:
//
// - `assistant.message` events with `outputTokens` per response
// - `session.shutdown` events with complete model metrics:
//   - inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens
//   - premium request count
//   - total API duration
//   - per-model breakdown
//
// This is the most accurate data source for token tracking since it contains
// the actual token counts from the API responses, not estimates.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Event types from events.jsonl ────────────────────────────────────────────

export interface SessionMessageEvent {
  type: 'assistant.message';
  data: {
    messageId: string;
    content: string;
    outputTokens: number;
    interactionId: string;
    toolRequests?: Array<{
      toolCallId: string;
      name: string;
      intentionSummary?: string;
    }>;
  };
  id: string;
  timestamp: string;
  parentId: string | null;
}

export interface SessionShutdownEvent {
  type: 'session.shutdown';
  data: {
    shutdownType: string;
    totalPremiumRequests: number;
    totalApiDurationMs: number;
    sessionStartTime: number;
    codeChanges: {
      linesAdded: number;
      linesRemoved: number;
      filesModified: string[];
    };
    modelMetrics: Record<string, {
      requests: { count: number; cost: number };
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
      };
    }>;
    currentModel?: string;
  };
  id: string;
  timestamp: string;
  parentId: string | null;
}

export interface SessionStartEvent {
  type: 'session.start';
  data: {
    sessionId: string;
    startTime: string;
    producer: string;
    copilotVersion: string;
  };
  id: string;
  timestamp: string;
}

type SessionEvent = SessionMessageEvent | SessionShutdownEvent | SessionStartEvent | { type: string; [key: string]: unknown };

// ─── Emitted event types ──────────────────────────────────────────────────────

export interface CopilotTokenEvent {
  timestamp: number;
  source: 'copilot-session';
  type: 'message' | 'session-summary';
  model?: string;
  /** Actual output tokens from the API */
  outputTokens: number;
  /** Actual input tokens (only available in session-summary) */
  inputTokens: number;
  /** Cache read tokens (only available in session-summary) */
  cacheReadTokens: number;
  /** Premium requests count */
  premiumRequests: number;
  /** Session ID */
  sessionId: string;
}

type TokenEventHandler = (event: CopilotTokenEvent) => void;

// ─── Pure parsing functions (exported for testing) ────────────────────────────

/**
 * Parse a single JSONL line into a SessionEvent, or return null if malformed.
 */
export function parseSessionLine(line: string): SessionEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) { return null; }
  try {
    return JSON.parse(trimmed) as SessionEvent;
  } catch {
    return null;
  }
}

/**
 * Convert a raw SessionEvent into zero or more CopilotTokenEvents.
 * Returns an array because session.shutdown events emit one event per model.
 */
export function sessionEventToTokenEvents(event: SessionEvent, sessionId: string): CopilotTokenEvent[] {
  if (event.type === 'assistant.message') {
    const msg = event as SessionMessageEvent;
    if (msg.data.outputTokens > 0) {
      return [{
        timestamp: new Date(msg.timestamp).getTime(),
        source: 'copilot-session',
        type: 'message',
        outputTokens: msg.data.outputTokens,
        inputTokens: 0,
        cacheReadTokens: 0,
        premiumRequests: 0,
        sessionId,
      }];
    }
    return [];
  }

  if (event.type === 'session.shutdown') {
    const shutdown = event as SessionShutdownEvent;
    if (shutdown.data.totalPremiumRequests > 0) {
      const events: CopilotTokenEvent[] = [];
      for (const [model, metrics] of Object.entries(shutdown.data.modelMetrics)) {
        events.push({
          timestamp: new Date(shutdown.timestamp).getTime(),
          source: 'copilot-session',
          type: 'session-summary',
          model,
          outputTokens: metrics.usage.outputTokens,
          inputTokens: metrics.usage.inputTokens,
          cacheReadTokens: metrics.usage.cacheReadTokens,
          premiumRequests: metrics.requests.cost,
          sessionId,
        });
      }
      return events;
    }
  }

  return [];
}

// ─── Watcher class ────────────────────────────────────────────────────────────

export class CopilotSessionWatcher implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private eventHandlers: TokenEventHandler[] = [];

  /** Track file positions to only read new content (tail -f behavior) */
  private filePositions: Map<string, number> = new Map();

  /** Track which event IDs we've already processed */
  private processedEventIds: Set<string> = new Set();

  /** fs.watch watchers */
  private fsWatchers: fs.FSWatcher[] = [];

  /** Polling interval for new session directories */
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  /** Known session directories */
  private knownSessionDirs: Set<string> = new Set();

  /** The base path for Copilot session state */
  private sessionStatePath: string;

  /** Persistent state storage (globalState) */
  private globalState: vscode.Memento | undefined;

  /** Storage keys */
  private static readonly STORAGE_KEY_EVENT_IDS = 'sessionWatcher.processedEventIds';
  private static readonly STORAGE_KEY_FILE_POSITIONS = 'sessionWatcher.filePositions';

  constructor() {
    this.sessionStatePath = path.join(os.homedir(), '.copilot', 'session-state');
  }

  onTokenEvent(handler: TokenEventHandler): void {
    this.eventHandlers.push(handler);
  }

  activate(context: vscode.ExtensionContext): void {
    this.globalState = context.globalState;

    // Restore persisted state from previous sessions
    this.loadPersistedState();

    // Check if the session-state directory exists
    if (!fs.existsSync(this.sessionStatePath)) {
      console.log('Eating Token: Copilot session-state directory not found at', this.sessionStatePath);
      console.log('Eating Token: Session token tracking disabled (Copilot CLI/Agent not installed?)');
      return;
    }

    // Scan existing session directories and start watching
    this.scanSessionDirs();

    // Poll for new session directories every 30 seconds
    this.pollTimer = setInterval(() => {
      this.scanSessionDirs();
    }, 30_000);

    const eventCount = this.processedEventIds.size;
    const fileCount = this.filePositions.size;
    console.log(
      `Eating Token: Copilot session watcher activated - monitoring ${this.sessionStatePath}` +
      ` (restored ${eventCount} processed event IDs, ${fileCount} file positions)`
    );
  }

  /**
   * Load processedEventIds and filePositions from globalState.
   * Merges with in-memory state to pick up changes from other windows.
   */
  private loadPersistedState(): void {
    if (!this.globalState) { return; }

    // Load and merge processed event IDs (union with in-memory set)
    const savedIds = this.globalState.get<string[]>(CopilotSessionWatcher.STORAGE_KEY_EVENT_IDS, []);
    for (const id of savedIds) {
      this.processedEventIds.add(id);
    }

    // Load file positions -- use the max of persisted vs in-memory
    // (another window may have read further in the same file)
    const savedPositions = this.globalState.get<Record<string, number>>(
      CopilotSessionWatcher.STORAGE_KEY_FILE_POSITIONS, {}
    );
    for (const [filePath, pos] of Object.entries(savedPositions)) {
      const current = this.filePositions.get(filePath) || 0;
      this.filePositions.set(filePath, Math.max(current, pos));
    }
  }

  /**
   * Save processedEventIds and filePositions to globalState immediately.
   * No debounce -- ensures other windows see updates promptly.
   */
  private savePersistedState(): void {
    if (!this.globalState) { return; }

    // Save event IDs (as array)
    const ids = Array.from(this.processedEventIds);
    void this.globalState.update(CopilotSessionWatcher.STORAGE_KEY_EVENT_IDS, ids);

    // Save file positions (as plain object)
    const positions: Record<string, number> = {};
    for (const [key, value] of this.filePositions) {
      positions[key] = value;
    }
    void this.globalState.update(CopilotSessionWatcher.STORAGE_KEY_FILE_POSITIONS, positions);
  }

  private scanSessionDirs(): void {
    try {
      const entries = fs.readdirSync(this.sessionStatePath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) { continue; }

        const dirPath = path.join(this.sessionStatePath, entry.name);
        if (this.knownSessionDirs.has(dirPath)) { continue; }

        const eventsFile = path.join(dirPath, 'events.jsonl');
        if (!fs.existsSync(eventsFile)) { continue; }

        this.knownSessionDirs.add(dirPath);
        this.watchEventsFile(eventsFile, entry.name);
      }
    } catch (err) {
      console.log('Eating Token: Error scanning session dirs:', err);
    }
  }

  private watchEventsFile(filePath: string, sessionId: string): void {
    // Read existing content first (for session.shutdown events from past sessions)
    this.readNewContent(filePath, sessionId);

    // Watch for new content
    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          this.readNewContent(filePath, sessionId);
        }
      });

      watcher.on('error', (err) => {
        console.log('Eating Token: fs.watch error for', filePath, err);
      });

      this.fsWatchers.push(watcher);
    } catch (err) {
      console.log('Eating Token: Could not watch', filePath, err);
    }
  }

  private readNewContent(filePath: string, sessionId: string): void {
    try {
      const stat = fs.statSync(filePath);

      // Merge persisted state from other windows before processing
      this.loadPersistedState();

      const currentPos = this.filePositions.get(filePath) || 0;

      if (stat.size <= currentPos) { return; }

      // Read new bytes from where we left off
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(stat.size - currentPos);
      fs.readSync(fd, buffer, 0, buffer.length, currentPos);
      fs.closeSync(fd);

      this.filePositions.set(filePath, stat.size);

      // Parse JSONL lines
      const newContent = buffer.toString('utf8');
      const lines = newContent.split('\n').filter(line => line.trim().length > 0);

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as SessionEvent;
          this.processEvent(event, sessionId);
        } catch {
          // Skip malformed lines
        }
      }

      // Persist state after processing new content
      // Always save file positions even if no new events (to avoid re-reading same bytes)
      this.savePersistedState();
    } catch (err) {
      console.log('Eating Token: Error reading events file:', err);
    }
  }

  private processEvent(event: SessionEvent, sessionId: string): boolean {
    // Deduplicate events
    const eventId = (event as { id?: string }).id;
    if (eventId) {
      if (this.processedEventIds.has(eventId)) { return false; }
      this.processedEventIds.add(eventId);

      // Keep the set from growing unbounded (limit to last 10K events)
      if (this.processedEventIds.size > 10_000) {
        const entries = Array.from(this.processedEventIds);
        this.processedEventIds = new Set(entries.slice(entries.length - 5_000));
      }
    }

    const tokenEvents = sessionEventToTokenEvents(event, sessionId);
    for (const tokenEvent of tokenEvents) {
      this.emitEvent(tokenEvent);
    }
    return tokenEvents.length > 0;
  }

  private emitEvent(event: CopilotTokenEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  dispose(): void {
    // Save state one final time
    this.savePersistedState();

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    for (const watcher of this.fsWatchers) {
      watcher.close();
    }
    this.fsWatchers = [];
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}

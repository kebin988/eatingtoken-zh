// Copilot Chat Log Watcher
//
// Watches VS Code's Copilot Chat log files for request completion records.
//
// Log location: ~/Library/Application Support/Code/logs/<session>/window<N>/exthost/
//   GitHub.copilot-chat/GitHub Copilot Chat.log
//
// These logs contain `ccreq:` lines that record each API request with:
// - Request ID (hex hash)
// - Status (success/error)
// - Model name (e.g., "claude-opus-4.6 -> claude-opus-4-6")
// - Duration in ms
// - Context (e.g., "[panel/editAgent]", "[progressMessages]")
//
// While these don't contain token counts, they give us:
// - Exact request count
// - Which model was used
// - Request duration (can estimate tokens from duration)
// - Whether it was a chat panel request or inline request
//
// Combined with the CopilotSessionWatcher, this gives comprehensive coverage.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Parsed log entry ─────────────────────────────────────────────────────────

export interface CopilotLogEntry {
  timestamp: number;
  requestId: string;
  status: 'success' | 'error' | 'unknown';
  model: string;
  durationMs: number;
  context: string; // e.g., "panel/editAgent", "progressMessages"
}

export interface CopilotLogEvent {
  timestamp: number;
  source: 'copilot-log';
  entry: CopilotLogEntry;
  /** Estimated output tokens based on duration + model */
  estimatedOutputTokens: number;
  /** Estimated input tokens (rough, based on model/context) */
  estimatedInputTokens: number;
}

type LogEventHandler = (event: CopilotLogEvent) => void;

// ─── Token estimation from duration ───────────────────────────────────────────

/**
 * Rough tokens-per-second output rates for different models.
 * These are conservative estimates based on typical throughput.
 */
const MODEL_OUTPUT_RATES: Record<string, number> = {
  'gpt-4o-mini': 120,     // ~120 tokens/sec
  'gpt-4o': 80,           // ~80 tokens/sec
  'claude-opus-4.6': 40,  // ~40 tokens/sec (slower, more capable)
  'claude-sonnet': 80,    // ~80 tokens/sec
  'default': 60,          // fallback
};

function estimateTokensFromDuration(model: string, durationMs: number): { input: number; output: number } {
  // Find the best matching rate
  const normalizedModel = model.toLowerCase();
  let rate = MODEL_OUTPUT_RATES['default'];

  for (const [key, r] of Object.entries(MODEL_OUTPUT_RATES)) {
    if (normalizedModel.includes(key.toLowerCase())) {
      rate = r;
      break;
    }
  }

  // Duration includes: network latency (~200ms) + prompt processing + generation
  // Subtract network overhead and assume ~60% of time is output generation
  const effectiveDuration = Math.max(durationMs - 200, 100);
  const outputGenerationTime = effectiveDuration * 0.6;
  const estimatedOutput = Math.ceil((outputGenerationTime / 1000) * rate);

  // Input tokens are harder to estimate -- use a rough ratio
  // Chat typically sends 5-20x more input than output
  const estimatedInput = estimatedOutput * 10;

  return { input: estimatedInput, output: estimatedOutput };
}

// ─── Log parser ───────────────────────────────────────────────────────────────

/**
 * Parse a ccreq log line.
 *
 * Examples:
 * "ccreq:5bd69225.copilotmd | success | claude-opus-4.6 -> claude-opus-4-6 | 32770ms | [panel/editAgent]"
 * "ccreq:3c1e79c6.copilotmd | success | gpt-4o-mini -> gpt-4o-mini-2024-07-18 | 2164ms | [copilotLanguageModelWrapper]"
 * "ccreq:91e399c7.copilotmd | markdown"
 */
const CCREQ_PATTERN = /ccreq:([a-f0-9]+)\.copilotmd\s*\|\s*(success|error)\s*\|\s*([^\|]+?)\s*\|\s*(\d+)ms\s*\|\s*\[([^\]]+)\]/;

export function parseCcreqLine(line: string): CopilotLogEntry | null {
  const match = line.match(CCREQ_PATTERN);
  if (!match) { return null; }

  const [, requestId, status, modelStr, durationStr, context] = match;

  // Model string can be "gpt-4o-mini -> gpt-4o-mini-2024-07-18" or just "gpt-4o-mini-2024-07-18"
  const model = modelStr.includes('->') ? modelStr.split('->')[0].trim() : modelStr.trim();

  // Extract timestamp from the log line prefix
  // Format: "2026-04-02 11:31:53.459 [info] ccreq:..."
  const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
  const timestamp = timestampMatch ? new Date(timestampMatch[1]).getTime() : Date.now();

  return {
    timestamp,
    requestId,
    status: status as 'success' | 'error',
    model,
    durationMs: parseInt(durationStr, 10),
    context,
  };
}

// ─── Watcher class ────────────────────────────────────────────────────────────

export class CopilotLogWatcher implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private eventHandlers: LogEventHandler[] = [];

  /** Track file positions for tail behavior */
  private filePositions: Map<string, number> = new Map();

  /** Track processed request IDs */
  private processedRequestIds: Set<string> = new Set();

  /** fs.watch watchers */
  private fsWatchers: fs.FSWatcher[] = [];

  /** Polling interval */
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  /** VS Code logs base path */
  private logsBasePath: string;

  /** Persistent state storage (globalState) */
  private globalState: vscode.Memento | undefined;

  /** Storage keys */
  private static readonly STORAGE_KEY_REQUEST_IDS = 'logWatcher.processedRequestIds';
  private static readonly STORAGE_KEY_FILE_POSITIONS = 'logWatcher.filePositions';

  /** Track which files have active fs.watch watchers (separate from filePositions) */
  private watchedFiles: Set<string> = new Set();

  constructor() {
    // Platform-specific VS Code logs path
    if (process.platform === 'darwin') {
      this.logsBasePath = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'logs');
    } else if (process.platform === 'win32') {
      this.logsBasePath = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'logs');
    } else {
      this.logsBasePath = path.join(os.homedir(), '.config', 'Code', 'logs');
    }
  }

  onLogEvent(handler: LogEventHandler): void {
    this.eventHandlers.push(handler);
  }

  activate(context: vscode.ExtensionContext): void {
    this.globalState = context.globalState;

    // Restore persisted state from previous sessions
    this.loadPersistedState();

    if (!fs.existsSync(this.logsBasePath)) {
      console.log('Eating Token: VS Code logs directory not found at', this.logsBasePath);
      return;
    }

    // Find and watch existing Copilot Chat log files
    this.scanForLogFiles();

    // Poll for new log files every 60 seconds (new windows create new log dirs)
    this.pollTimer = setInterval(() => {
      this.scanForLogFiles();
    }, 60_000);

    const reqCount = this.processedRequestIds.size;
    const fileCount = this.filePositions.size;
    console.log(
      `Eating Token: Copilot Chat log watcher activated` +
      ` (restored ${reqCount} processed request IDs, ${fileCount} file positions)`
    );
  }

  /**
   * Load processedRequestIds and filePositions from globalState.
   * Merges with in-memory state to pick up changes from other windows.
   */
  private loadPersistedState(): void {
    if (!this.globalState) { return; }

    // Merge processed request IDs (union with in-memory set)
    const savedIds = this.globalState.get<string[]>(CopilotLogWatcher.STORAGE_KEY_REQUEST_IDS, []);
    for (const id of savedIds) {
      this.processedRequestIds.add(id);
    }

    // Merge file positions -- use max of persisted vs in-memory
    const savedPositions = this.globalState.get<Record<string, number>>(
      CopilotLogWatcher.STORAGE_KEY_FILE_POSITIONS, {}
    );
    for (const [filePath, pos] of Object.entries(savedPositions)) {
      const current = this.filePositions.get(filePath) || 0;
      this.filePositions.set(filePath, Math.max(current, pos));
    }
  }

  /**
   * Save processedRequestIds and filePositions to globalState immediately.
   * No debounce -- ensures other windows see updates promptly.
   */
  private savePersistedState(): void {
    if (!this.globalState) { return; }

    const ids = Array.from(this.processedRequestIds);
    void this.globalState.update(CopilotLogWatcher.STORAGE_KEY_REQUEST_IDS, ids);

    const positions: Record<string, number> = {};
    for (const [key, value] of this.filePositions) {
      positions[key] = value;
    }
    void this.globalState.update(CopilotLogWatcher.STORAGE_KEY_FILE_POSITIONS, positions);
  }

  private scanForLogFiles(): void {
    try {
      // Iterate ALL session dirs (e.g., 20260330T173006/).
      // VS Code creates many small session dirs (CLI invocations, reloads) that only
      // contain cli.log -- no Copilot Chat logs. We scan all dirs but only watch log
      // files modified in the last 7 days to avoid wasting resources on stale ones.
      const sessionDirs = fs.readdirSync(this.logsBasePath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .sort((a, b) => b.name.localeCompare(a.name)); // Most recent first

      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(this.logsBasePath, sessionDir.name);

        let windowDirs: fs.Dirent[];
        try {
          windowDirs = fs.readdirSync(sessionPath, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name.startsWith('window'));
        } catch {
          continue; // Skip dirs we can't read
        }

        for (const windowDir of windowDirs) {
          const logFile = path.join(
            sessionPath, windowDir.name, 'exthost',
            'GitHub.copilot-chat', 'GitHub Copilot Chat.log'
          );

          if (this.watchedFiles.has(logFile)) { continue; }

          try {
            const stat = fs.statSync(logFile);
            // Only watch log files modified in the last 7 days
            if (stat.mtimeMs < sevenDaysAgo) { continue; }
          } catch {
            continue; // File doesn't exist or can't be stat'd
          }

          this.watchedFiles.add(logFile);
          this.watchLogFile(logFile);
        }
      }
    } catch (err) {
      console.log('Eating Token: Error scanning log dirs:', err);
    }
  }

  private watchLogFile(filePath: string): void {
    // Read existing content (only new ccreq lines)
    this.readNewContent(filePath);

    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          this.readNewContent(filePath);
        }
      });

      watcher.on('error', () => {
        // Log file might be deleted when VS Code restarts
      });

      this.fsWatchers.push(watcher);
    } catch {
      // Some files might not be watchable
    }
  }

  private readNewContent(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);

      // Merge persisted state from other windows before processing
      this.loadPersistedState();

      const currentPos = this.filePositions.get(filePath) || 0;

      if (stat.size <= currentPos) { return; }

      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(stat.size - currentPos);
      fs.readSync(fd, buffer, 0, buffer.length, currentPos);
      fs.closeSync(fd);

      this.filePositions.set(filePath, stat.size);

      const newContent = buffer.toString('utf8');
      const lines = newContent.split('\n');

      for (const line of lines) {
        if (!line.includes('ccreq:')) { continue; }

        const entry = parseCcreqLine(line);
        if (!entry) { continue; }

        // Deduplicate
        if (this.processedRequestIds.has(entry.requestId)) { continue; }
        this.processedRequestIds.add(entry.requestId);

        // Keep set bounded
        if (this.processedRequestIds.size > 5_000) {
          const entries = Array.from(this.processedRequestIds);
          this.processedRequestIds = new Set(entries.slice(entries.length - 2_500));
        }

        // Only process successful requests
        if (entry.status !== 'success') { continue; }

        const estimated = estimateTokensFromDuration(entry.model, entry.durationMs);

        this.emitEvent({
          timestamp: entry.timestamp,
          source: 'copilot-log',
          entry,
          estimatedOutputTokens: estimated.output,
          estimatedInputTokens: estimated.input,
        });
      }

      // Persist state after processing new content
      this.savePersistedState();
    } catch {
      // File might be locked or deleted
    }
  }

  private emitEvent(event: CopilotLogEvent): void {
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

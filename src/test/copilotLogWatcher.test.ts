import { describe, it, expect } from 'vitest';
import { parseCcreqLine } from '../copilotLogWatcher';

describe('parseCcreqLine', () => {
  it('should parse a successful Claude request', () => {
    const line = '2026-04-02 11:31:53.459 [info] ccreq:5bd69225.copilotmd | success | claude-opus-4.6 -> claude-opus-4-6 | 32770ms | [panel/editAgent]';
    const result = parseCcreqLine(line);
    expect(result).not.toBeNull();
    expect(result!.requestId).toBe('5bd69225');
    expect(result!.status).toBe('success');
    expect(result!.model).toBe('claude-opus-4.6');
    expect(result!.durationMs).toBe(32770);
    expect(result!.context).toBe('panel/editAgent');
  });

  it('should parse a successful gpt-4o-mini request', () => {
    const line = '2026-04-02 11:31:21.542 [info] ccreq:d1c2790a.copilotmd | success | gpt-4o-mini -> gpt-4o-mini-2024-07-18 | 1389ms | [progressMessages]';
    const result = parseCcreqLine(line);
    expect(result).not.toBeNull();
    expect(result!.requestId).toBe('d1c2790a');
    expect(result!.status).toBe('success');
    expect(result!.model).toBe('gpt-4o-mini');
    expect(result!.durationMs).toBe(1389);
    expect(result!.context).toBe('progressMessages');
  });

  it('should parse a request with copilotLanguageModelWrapper context', () => {
    const line = '2026-04-02 11:31:32.755 [info] ccreq:3c1e79c6.copilotmd | success | gpt-4o-mini -> gpt-4o-mini-2024-07-18 | 2164ms | [copilotLanguageModelWrapper]';
    const result = parseCcreqLine(line);
    expect(result).not.toBeNull();
    expect(result!.context).toBe('copilotLanguageModelWrapper');
    expect(result!.durationMs).toBe(2164);
  });

  it('should return null for non-ccreq lines', () => {
    expect(parseCcreqLine('2026-04-02 11:31:00.816 [info] Logged in as manishsat')).toBeNull();
    expect(parseCcreqLine('')).toBeNull();
    expect(parseCcreqLine('random text')).toBeNull();
  });

  it('should return null for partial ccreq lines without full pattern', () => {
    // This line only has requestId and format, no status/model/duration
    const line = '2026-04-02 11:31:02.763 [info] ccreq:91e399c7.copilotmd | markdown';
    const result = parseCcreqLine(line);
    expect(result).toBeNull();
  });

  it('should return null for "latest" ccreq entries', () => {
    const line = '2026-04-02 11:31:02.763 [info] Latest entry: ccreq:latest.copilotmd';
    const result = parseCcreqLine(line);
    expect(result).toBeNull();
  });

  it('should extract timestamp from log line', () => {
    const line = '2026-04-02 11:31:53.459 [info] ccreq:5bd69225.copilotmd | success | claude-opus-4.6 -> claude-opus-4-6 | 32770ms | [panel/editAgent]';
    const result = parseCcreqLine(line);
    expect(result).not.toBeNull();
    // Timestamp should be a valid date
    expect(result!.timestamp).toBeGreaterThan(0);
    expect(new Date(result!.timestamp).getFullYear()).toBe(2026);
  });

  it('should handle error status', () => {
    const line = '2026-04-02 11:31:53.459 [info] ccreq:abc12345.copilotmd | error | gpt-4o | 5000ms | [panel/editAgent]';
    const result = parseCcreqLine(line);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('error');
    expect(result!.model).toBe('gpt-4o');
  });

  it('should handle model names without arrow (no redirect)', () => {
    const line = '2026-04-02 11:31:53.459 [info] ccreq:abc12345.copilotmd | success | gpt-4o | 1234ms | [panel/editAgent]';
    const result = parseCcreqLine(line);
    expect(result).not.toBeNull();
    expect(result!.model).toBe('gpt-4o');
  });
});

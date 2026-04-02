import { describe, it, expect } from 'vitest';
import {
  parseSessionLine,
  sessionEventToTokenEvents,
  SessionMessageEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from '../copilotSessionWatcher';

// ─── parseSessionLine ─────────────────────────────────────────────────────────

describe('parseSessionLine', () => {
  it('should parse a valid assistant.message event', () => {
    const line = JSON.stringify({
      type: 'assistant.message',
      data: {
        messageId: 'msg-1',
        content: 'Hello world',
        outputTokens: 150,
        interactionId: 'int-1',
      },
      id: 'evt-1',
      timestamp: '2026-04-02T10:00:00.000Z',
      parentId: null,
    });

    const result = parseSessionLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('assistant.message');
  });

  it('should parse a valid session.shutdown event', () => {
    const line = JSON.stringify({
      type: 'session.shutdown',
      data: {
        shutdownType: 'normal',
        totalPremiumRequests: 5,
        totalApiDurationMs: 60000,
        sessionStartTime: 1700000000,
        codeChanges: { linesAdded: 10, linesRemoved: 3, filesModified: ['foo.ts'] },
        modelMetrics: {
          'claude-opus-4.6': {
            requests: { count: 5, cost: 5 },
            usage: { inputTokens: 10000, outputTokens: 500, cacheReadTokens: 8000, cacheWriteTokens: 2000 },
          },
        },
      },
      id: 'evt-shutdown',
      timestamp: '2026-04-02T11:00:00.000Z',
      parentId: null,
    });

    const result = parseSessionLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('session.shutdown');
  });

  it('should return null for empty lines', () => {
    expect(parseSessionLine('')).toBeNull();
    expect(parseSessionLine('  ')).toBeNull();
    expect(parseSessionLine('\n')).toBeNull();
  });

  it('should return null for malformed JSON', () => {
    expect(parseSessionLine('{invalid json')).toBeNull();
    expect(parseSessionLine('not json at all')).toBeNull();
  });

  it('should parse unknown event types gracefully', () => {
    const line = JSON.stringify({ type: 'unknown.event', data: {}, id: 'x' });
    const result = parseSessionLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('unknown.event');
  });
});

// ─── sessionEventToTokenEvents ────────────────────────────────────────────────

describe('sessionEventToTokenEvents', () => {
  describe('assistant.message events', () => {
    it('should emit a message event with outputTokens', () => {
      const event: SessionMessageEvent = {
        type: 'assistant.message',
        data: {
          messageId: 'msg-1',
          content: 'Some response text',
          outputTokens: 250,
          interactionId: 'int-1',
        },
        id: 'evt-1',
        timestamp: '2026-04-02T10:00:00.000Z',
        parentId: null,
      };

      const results = sessionEventToTokenEvents(event, 'session-abc');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        source: 'copilot-session',
        type: 'message',
        outputTokens: 250,
        inputTokens: 0,
        cacheReadTokens: 0,
        premiumRequests: 0,
        sessionId: 'session-abc',
      });
      expect(results[0].timestamp).toBe(new Date('2026-04-02T10:00:00.000Z').getTime());
    });

    it('should return empty array for zero outputTokens', () => {
      const event: SessionMessageEvent = {
        type: 'assistant.message',
        data: {
          messageId: 'msg-2',
          content: '',
          outputTokens: 0,
          interactionId: 'int-2',
        },
        id: 'evt-2',
        timestamp: '2026-04-02T10:00:00.000Z',
        parentId: null,
      };

      const results = sessionEventToTokenEvents(event, 'session-abc');
      expect(results).toHaveLength(0);
    });

    it('should include tool requests in the original event data', () => {
      const event: SessionMessageEvent = {
        type: 'assistant.message',
        data: {
          messageId: 'msg-3',
          content: 'Using a tool...',
          outputTokens: 100,
          interactionId: 'int-3',
          toolRequests: [
            { toolCallId: 'tc-1', name: 'read_file', intentionSummary: 'Reading a file' },
          ],
        },
        id: 'evt-3',
        timestamp: '2026-04-02T10:05:00.000Z',
        parentId: 'evt-1',
      };

      const results = sessionEventToTokenEvents(event, 'session-abc');
      expect(results).toHaveLength(1);
      expect(results[0].outputTokens).toBe(100);
    });
  });

  describe('session.shutdown events', () => {
    it('should emit one event per model in modelMetrics', () => {
      const event: SessionShutdownEvent = {
        type: 'session.shutdown',
        data: {
          shutdownType: 'normal',
          totalPremiumRequests: 10,
          totalApiDurationMs: 120000,
          sessionStartTime: 1700000000,
          codeChanges: { linesAdded: 50, linesRemoved: 10, filesModified: ['a.ts', 'b.ts'] },
          modelMetrics: {
            'claude-opus-4.6': {
              requests: { count: 7, cost: 7 },
              usage: { inputTokens: 100000, outputTokens: 5000, cacheReadTokens: 80000, cacheWriteTokens: 20000 },
            },
            'gpt-4o-mini': {
              requests: { count: 3, cost: 3 },
              usage: { inputTokens: 2000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
            },
          },
        },
        id: 'evt-shutdown',
        timestamp: '2026-04-02T12:00:00.000Z',
        parentId: null,
      };

      const results = sessionEventToTokenEvents(event, 'session-xyz');
      expect(results).toHaveLength(2);

      // Find the claude event
      const claudeEvent = results.find(e => e.model === 'claude-opus-4.6');
      expect(claudeEvent).toBeDefined();
      expect(claudeEvent).toMatchObject({
        source: 'copilot-session',
        type: 'session-summary',
        model: 'claude-opus-4.6',
        inputTokens: 100000,
        outputTokens: 5000,
        cacheReadTokens: 80000,
        premiumRequests: 7,
        sessionId: 'session-xyz',
      });

      // Find the gpt-4o-mini event
      const gptEvent = results.find(e => e.model === 'gpt-4o-mini');
      expect(gptEvent).toBeDefined();
      expect(gptEvent).toMatchObject({
        inputTokens: 2000,
        outputTokens: 300,
        cacheReadTokens: 0,
        premiumRequests: 3,
      });
    });

    it('should return empty array when totalPremiumRequests is 0', () => {
      const event: SessionShutdownEvent = {
        type: 'session.shutdown',
        data: {
          shutdownType: 'normal',
          totalPremiumRequests: 0,
          totalApiDurationMs: 0,
          sessionStartTime: 1700000000,
          codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: [] },
          modelMetrics: {},
        },
        id: 'evt-shutdown-empty',
        timestamp: '2026-04-02T12:00:00.000Z',
        parentId: null,
      };

      const results = sessionEventToTokenEvents(event, 'session-empty');
      expect(results).toHaveLength(0);
    });

    it('should handle a single model in modelMetrics', () => {
      const event: SessionShutdownEvent = {
        type: 'session.shutdown',
        data: {
          shutdownType: 'normal',
          totalPremiumRequests: 84,
          totalApiDurationMs: 500000,
          sessionStartTime: 1700000000,
          codeChanges: { linesAdded: 200, linesRemoved: 50, filesModified: ['main.ts'] },
          modelMetrics: {
            'claude-opus-4.6': {
              requests: { count: 84, cost: 84 },
              usage: { inputTokens: 10100000, outputTokens: 67700, cacheReadTokens: 9600000, cacheWriteTokens: 500300 },
            },
          },
          currentModel: 'claude-opus-4.6',
        },
        id: 'evt-large-session',
        timestamp: '2026-04-02T14:00:00.000Z',
        parentId: null,
      };

      const results = sessionEventToTokenEvents(event, 'session-large');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        model: 'claude-opus-4.6',
        inputTokens: 10100000,
        outputTokens: 67700,
        cacheReadTokens: 9600000,
        premiumRequests: 84,
      });
    });
  });

  describe('other event types', () => {
    it('should return empty array for session.start events', () => {
      const event: SessionStartEvent = {
        type: 'session.start',
        data: {
          sessionId: 'abc-123',
          startTime: '2026-04-02T09:00:00.000Z',
          producer: 'agency',
          copilotVersion: '1.0.0',
        },
        id: 'evt-start',
        timestamp: '2026-04-02T09:00:00.000Z',
      };

      const results = sessionEventToTokenEvents(event, 'session-abc');
      expect(results).toHaveLength(0);
    });

    it('should return empty array for unknown event types', () => {
      const event = { type: 'some.unknown.event', data: {}, id: 'x' } as any;
      const results = sessionEventToTokenEvents(event, 'session-abc');
      expect(results).toHaveLength(0);
    });
  });
});

// ─── End-to-end: parseSessionLine -> sessionEventToTokenEvents ────────────────

describe('parseSessionLine -> sessionEventToTokenEvents pipeline', () => {
  it('should handle a real-world assistant.message JSONL line', () => {
    const jsonl = JSON.stringify({
      type: 'assistant.message',
      data: {
        messageId: 'chatcmpl-BK123abc',
        content: 'Here is the implementation...',
        outputTokens: 342,
        interactionId: 'int-456',
        toolRequests: [
          { toolCallId: 'call_abc123', name: 'editFile', intentionSummary: 'Update the main handler' },
        ],
      },
      id: '7a2b3c4d-ef56-7890-abcd-ef1234567890',
      timestamp: '2026-04-02T10:30:00.000Z',
      parentId: '1a2b3c4d',
    });

    const parsed = parseSessionLine(jsonl);
    expect(parsed).not.toBeNull();

    const events = sessionEventToTokenEvents(parsed!, 'real-session');
    expect(events).toHaveLength(1);
    expect(events[0].outputTokens).toBe(342);
    expect(events[0].type).toBe('message');
  });

  it('should handle a real-world session.shutdown JSONL line', () => {
    const jsonl = JSON.stringify({
      type: 'session.shutdown',
      data: {
        shutdownType: 'normal',
        totalPremiumRequests: 84,
        totalApiDurationMs: 481253,
        sessionStartTime: 1743329417,
        codeChanges: {
          linesAdded: 1234,
          linesRemoved: 567,
          filesModified: ['src/main.ts', 'src/utils.ts', 'package.json'],
        },
        modelMetrics: {
          'claude-opus-4.6': {
            requests: { count: 84, cost: 84 },
            usage: {
              inputTokens: 10149999,
              outputTokens: 67789,
              cacheReadTokens: 9610816,
              cacheWriteTokens: 500370,
            },
          },
        },
        currentModel: 'claude-opus-4.6',
      },
      id: 'shutdown-abc-def',
      timestamp: '2026-04-02T15:00:00.000Z',
      parentId: null,
    });

    const parsed = parseSessionLine(jsonl);
    expect(parsed).not.toBeNull();

    const events = sessionEventToTokenEvents(parsed!, 'real-session');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'session-summary',
      model: 'claude-opus-4.6',
      inputTokens: 10149999,
      outputTokens: 67789,
      cacheReadTokens: 9610816,
      premiumRequests: 84,
    });
  });

  it('should handle multiple JSONL lines in sequence', () => {
    const lines = [
      JSON.stringify({
        type: 'session.start',
        data: { sessionId: 's1', startTime: '2026-04-02T09:00:00Z', producer: 'agency', copilotVersion: '1.0' },
        id: 'e1', timestamp: '2026-04-02T09:00:00Z',
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { messageId: 'm1', content: 'Response 1', outputTokens: 100, interactionId: 'i1' },
        id: 'e2', timestamp: '2026-04-02T09:01:00Z', parentId: null,
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { messageId: 'm2', content: 'Response 2', outputTokens: 200, interactionId: 'i2' },
        id: 'e3', timestamp: '2026-04-02T09:02:00Z', parentId: null,
      }),
      JSON.stringify({
        type: 'session.shutdown',
        data: {
          shutdownType: 'normal', totalPremiumRequests: 2, totalApiDurationMs: 5000, sessionStartTime: 1700000000,
          codeChanges: { linesAdded: 5, linesRemoved: 1, filesModified: ['test.ts'] },
          modelMetrics: { 'gpt-4o': { requests: { count: 2, cost: 2 }, usage: { inputTokens: 5000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
        },
        id: 'e4', timestamp: '2026-04-02T09:05:00Z', parentId: null,
      }),
    ];

    const allEvents = lines.flatMap(line => {
      const parsed = parseSessionLine(line);
      return parsed ? sessionEventToTokenEvents(parsed, 'test-session') : [];
    });

    // session.start => 0 events, 2x assistant.message => 2 events, session.shutdown => 1 event
    expect(allEvents).toHaveLength(3);
    expect(allEvents[0].type).toBe('message');
    expect(allEvents[0].outputTokens).toBe(100);
    expect(allEvents[1].type).toBe('message');
    expect(allEvents[1].outputTokens).toBe(200);
    expect(allEvents[2].type).toBe('session-summary');
    expect(allEvents[2].inputTokens).toBe(5000);
  });
});

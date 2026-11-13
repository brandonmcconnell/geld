import { describe, expect, it } from 'vitest';
import { SseParser } from './sse';

describe('SseParser', () => {
  it('reads named events with ids and joins data lines', () => {
    const parser = new SseParser();
    const events = parser.feed('event: status\ndata: {"a":1}\n\nid: 7-0\nevent: assistant\ndata: one\ndata: two\n\n');
    expect(events).toEqual([
      { event: 'status', data: '{"a":1}', id: null },
      { event: 'assistant', data: 'one\ntwo', id: '7-0' },
    ]);
  });

  it('keeps an event split across chunks, a CRLF split between them included', () => {
    const parser = new SseParser();
    expect(parser.feed('data: hel')).toEqual([]);
    expect(parser.feed('lo\r')).toEqual([]);
    expect(parser.feed('\n\r\n')).toEqual([{ event: 'message', data: 'hello', id: null }]);
  });

  it('skips comments, keeps the id for later events, and drops an unfinished event on flush', () => {
    const parser = new SseParser();
    expect(parser.feed(': keepalive\nid: 1\ndata: x\n\ndata: y\n\n')).toEqual([
      { event: 'message', data: 'x', id: '1' },
      { event: 'message', data: 'y', id: '1' },
    ]);
    expect(parser.feed('data: unfinished')).toEqual([]);
    expect(parser.flush()).toEqual([]);
  });

  it('dispatches nothing for an event with no data', () => {
    expect(new SseParser().feed('event: ping\n\n')).toEqual([]);
  });
});

/** One server-sent event, as the stream wrote it: `event` defaults to `message`, `id` is the last one the stream set. */
export interface SseEvent {
  readonly event: string;
  readonly data: string;
  readonly id: string | null;
}

/**
 * Server-sent events read from text chunks as they arrive (the WHATWG event-stream rules): a blank line ends an
 * event, `data` lines join with newlines, a line opening with a colon is a comment, and a chunk may end anywhere,
 * even between the `\r` and `\n` of one line ending.
 */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  private id: string | null = null;

  feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (match === null) break;
      // A trailing `\r` may be the first half of `\r\n` still on its way.
      if (match[0] === '\r' && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const event = this.line(line);
      if (event !== null) events.push(event);
    }
    return events;
  }

  /** What is left when the stream ends: an event the stream did not close with a blank line is dropped, as the rules say. */
  flush(): SseEvent[] {
    const events = this.buffer === '' ? [] : this.feed('\n');
    this.buffer = '';
    this.event = '';
    this.data = [];
    return events;
  }

  private line(line: string): SseEvent | null {
    if (line === '') {
      if (this.data.length === 0) {
        this.event = '';
        return null;
      }
      const event: SseEvent = { event: this.event === '' ? 'message' : this.event, data: this.data.join('\n'), id: this.id };
      this.event = '';
      this.data = [];
      return event;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    else if (field === 'id' && !value.includes('\0')) this.id = value;
    return null;
  }
}

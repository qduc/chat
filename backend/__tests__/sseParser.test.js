import { parseSSEStream } from '../src/lib/sseParser.js';

describe('parseSSEStream', () => {
  it('parses CRLF-delimited SSE payloads', () => {
    const payload = Buffer.from('data: {"message":"hi"}\r\n\r\n');
    const chunks = [];
    const leftover = parseSSEStream(
      payload,
      '',
      (obj) => chunks.push(obj),
      () => {},
      () => {}
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ message: 'hi' });
    expect(leftover).toBe('');
  });

  it('handles CRLF split across boundaries', () => {
    const first = Buffer.from('data: {"message":"hi"}\r');
    const events = [];
    let leftover = parseSSEStream(
      first,
      '',
      (obj) => events.push(obj),
      () => {},
      () => {}
    );

    expect(events).toHaveLength(0);
    expect(leftover).toBe('data: {"message":"hi"}\r');

    const second = Buffer.from('\n\r\n');
    leftover = parseSSEStream(
      second,
      leftover,
      (obj) => events.push(obj),
      () => {},
      () => {}
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ message: 'hi' });
    expect(leftover).toBe('');
  });

  it('detects [DONE] lines terminated with CRLF', () => {
    const chunk = Buffer.from('data: [DONE]\r\n\r\n');
    let doneCalled = false;

    parseSSEStream(
      chunk,
      '',
      () => {},
      () => { doneCalled = true; },
      () => {}
    );

    expect(doneCalled).toBe(true);
  });
});

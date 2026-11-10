// Replays sanitized real provider traffic (see fixtures/PROVENANCE.md) to
// ChatForge's own provider adapters over loopback HTTP. No real API calls.
//
// Each POST that offers tools is answered with the next recorded turn, frame
// for frame (status, content type, SSE event names and data). Requests without
// tools (conversation title generation) get a 503 so they never consume a turn;
// the title service falls back to a local title.
//
// `load(fixture, { cuts })` can cut a recorded turn short to model failures
// with real frames: after N SSE events, either `stall` (keep the connection
// open, sending nothing) or `drop` (destroy the socket, no terminal event).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function loadFixture(name) {
  const fixture = JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
  if (fixture.schemaVersion !== 1 || fixture.kind !== 'real-traffic-recording') {
    throw new Error(`${name}: not a real-traffic-recording v1 envelope`);
  }
  return fixture;
}

/** True when a provider request body offers tools, in any wire family. */
function offersTools(body) {
  return Array.isArray(body?.tools) && body.tools.length > 0;
}

export class ReplayServer {
  constructor() {
    this.server = null;
    this.sockets = new Set();
    this.turns = [];
    /** Tool-offering requests ChatForge sent, in order: { method, path, body }. */
    this.requests = [];
    /** Requests that arrived after the recording ran out. */
    this.unexpected = [];
    /** turn index -> { afterEvents, then: 'stall' | 'drop' } */
    this.cuts = {};
    /** Turn indexes whose upstream connection the client closed before the turn ended. */
    this.clientClosed = [];
    /** Turn indexes whose connection the server cut on purpose (`drop`). */
    this.dropped = [];
    this.#stalled = new Set();
    this.#stallWaiters = [];
  }

  #stalled;
  #stallWaiters;

  async start() {
    this.server = http.createServer((req, res) => this.#handle(req, res));
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = this.server.address().port;
  }

  async stop() {
    for (const res of this.#stalled) res.destroy();
    this.#stalled.clear();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Arm the server with one recording; clears what was captured before. */
  load(fixture, { cuts = {} } = {}) {
    for (const res of this.#stalled) res.destroy();
    this.#stalled.clear();
    this.turns = fixture.turns.map((turn) => turn.frames);
    this.requests = [];
    this.unexpected = [];
    this.cuts = cuts;
    this.clientClosed = [];
    this.dropped = [];
    this.#stallWaiters = [];
  }

  /** Resolves once a `stall` cut has sent its frames and is holding the connection. */
  waitForStall() {
    if (this.#stalled.size > 0) return Promise.resolve();
    return new Promise((resolve) => this.#stallWaiters.push(resolve));
  }

  #handle(req, res) {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      if (!offersTools(body)) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'replay server: no recording for requests without tools' } }));
        return;
      }
      const frames = this.turns[this.requests.length];
      const captured = { method: req.method, path: req.url, body };
      if (!frames) {
        this.unexpected.push(captured);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'replay server: recording has no more turns' } }));
        return;
      }
      const turnIndex = this.requests.length;
      this.requests.push(captured);
      this.#replay(frames, res, turnIndex);
    });
  }

  #replay(frames, res, turnIndex) {
    const cut = this.cuts[turnIndex];
    let finished = false;
    res.on('close', () => {
      if (!finished) this.clientClosed.push(turnIndex);
      this.#stalled.delete(res);
    });
    const head = frames.find((frame) => frame.kind === 'http-response-head');
    res.writeHead(head?.status ?? 200, { 'content-type': head?.headers?.['content-type'] ?? 'text/event-stream' });
    let events = 0;
    for (const frame of frames) {
      if (frame.kind === 'sse-event') {
        if (cut && events >= cut.afterEvents) break;
        res.write(`${frame.event ? `event: ${frame.event}\n` : ''}data: ${frame.data}\n\n`);
        events += 1;
      } else if (frame.kind === 'json-body') {
        res.write(JSON.stringify(frame.body));
      }
    }
    if (cut?.then === 'stall') {
      this.#stalled.add(res);
      for (const resolve of this.#stallWaiters.splice(0)) resolve();
      return;
    }
    if (cut?.then === 'drop') {
      // Let the partial frames reach the client first, then cut the connection mid-stream.
      finished = true;
      this.dropped.push(turnIndex);
      setTimeout(() => res.socket?.destroy(), 50);
      return;
    }
    finished = true;
    res.end();
  }
}

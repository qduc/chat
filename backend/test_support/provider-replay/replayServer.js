// Replays sanitized real provider traffic (see fixtures/PROVENANCE.md) to
// ChatForge's own provider adapters over loopback HTTP. No real API calls.
//
// Each POST that offers tools is answered with the next recorded turn, frame
// for frame (status, content type, SSE event names and data). Requests without
// tools (conversation title generation) get a 503 so they never consume a turn;
// the title service falls back to a local title.
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
  }

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
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Arm the server with one recording; clears what was captured before. */
  load(fixture) {
    this.turns = fixture.turns.map((turn) => turn.frames);
    this.requests = [];
    this.unexpected = [];
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
      this.requests.push(captured);
      this.#replay(frames, res);
    });
  }

  #replay(frames, res) {
    const head = frames.find((frame) => frame.kind === 'http-response-head');
    res.writeHead(head?.status ?? 200, { 'content-type': head?.headers?.['content-type'] ?? 'text/event-stream' });
    for (const frame of frames) {
      if (frame.kind === 'sse-event') {
        res.write(`${frame.event ? `event: ${frame.event}\n` : ''}data: ${frame.data}\n\n`);
      } else if (frame.kind === 'json-body') {
        res.write(JSON.stringify(frame.body));
      }
    }
    res.end();
  }
}

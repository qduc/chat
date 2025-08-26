// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Set the API base to an empty string for all tests
process.env.NEXT_PUBLIC_API_BASE = '/api';

// Polyfill TextEncoder/TextDecoder for Node/Jest environments
const util = require('util');
if (typeof global.TextEncoder === 'undefined') {
	global.TextEncoder = util.TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
	global.TextDecoder = util.TextDecoder;
}

// Add a small expect.poll helper used by tests: polls a function until the matcher passes or times out
expect.poll = (fn, { timeout = 1000, interval = 50 } = {}) => {
	const poll = async (matcher) => {
		const start = Date.now();
		// eslint-disable-next-line no-constant-condition
		while (true) {
			try {
				const value = fn();
				matcher(value);
				return;
			} catch (err) {
				if (Date.now() - start > timeout) throw err;
				// wait
				// eslint-disable-next-line no-await-in-loop
				await new Promise((r) => setTimeout(r, interval));
			}
		}
	};
	return {
		toBe: (expected) => poll((v) => expect(v).toBe(expected)),
		toEqual: (expected) => poll((v) => expect(v).toEqual(expected)),
		toMatch: (expected) => poll((v) => expect(v).toMatch(expected)),
	};
};

// Ensure global.fetch exists and is mockable
if (typeof global.fetch === 'undefined') {
	global.fetch = jest.fn();
}

// Minimal ReadableStream polyfill suitable for these tests
if (typeof global.ReadableStream === 'undefined') {
	class SimpleReadableStream {
		constructor(underlying) {
			this._chunks = [];
			this._closed = false;
			this._waiting = null;
			const controller = {
				enqueue: (chunk) => {
					this._chunks.push(chunk);
					if (this._waiting) {
						this._waiting.resolve();
						this._waiting = null;
					}
				},
				close: () => {
					this._closed = true;
					if (this._waiting) {
						this._waiting.resolve();
						this._waiting = null;
					}
				},
			};
			if (underlying && typeof underlying.start === 'function') {
				try { underlying.start(controller); } catch (e) { /* ignore */ }
			}
		}
		getReader() {
			const stream = this;
			return {
				read: async () => {
					while (stream._chunks.length === 0 && !stream._closed) {
						// wait for new chunks
						await new Promise((resolve) => { stream._waiting = { resolve }; });
					}
					if (stream._chunks.length === 0 && stream._closed) {
						return { done: true, value: undefined };
					}
					const value = stream._chunks.shift();
					return { done: false, value };
				},
			};
		}
	}
	global.ReadableStream = SimpleReadableStream;
}

// Minimal Response polyfill used by tests
if (typeof global.Response === 'undefined') {
	class ResponsePolyfill {
		constructor(body, init = {}) {
			this._rawBody = body;
			this.status = init.status || 200;
			this.ok = this.status >= 200 && this.status < 300;
			// If body is string, expose a ReadableStream over the encoded string
			if (typeof body === 'string') {
				const encoder = new TextEncoder();
				this.body = new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode(body));
						controller.close();
					},
				});
			} else {
				this.body = body;
			}
		}
		async json() {
			if (typeof this._rawBody === 'string') return JSON.parse(this._rawBody);
			if (this.body && typeof this.body.getReader === 'function') {
				const reader = this.body.getReader();
				const dec = new TextDecoder();
				let out = '';
				while (true) {
					// eslint-disable-next-line no-await-in-loop
					const { done, value } = await reader.read();
					if (done) break;
					out += dec.decode(value, { stream: true });
				}
				return JSON.parse(out);
			}
			return null;
		}
		async text() {
			if (typeof this._rawBody === 'string') return this._rawBody;
			if (this.body && typeof this.body.getReader === 'function') {
				const reader = this.body.getReader();
				const dec = new TextDecoder();
				let out = '';
				while (true) {
					// eslint-disable-next-line no-await-in-loop
					const { done, value } = await reader.read();
					if (done) break;
					out += dec.decode(value, { stream: true });
				}
				return out;
			}
			return '';
		}
	}
	global.Response = ResponsePolyfill;
}

// Mock scrollIntoView as it's not available in jsdom
Element.prototype.scrollIntoView = jest.fn();

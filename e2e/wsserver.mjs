/*
 * ForgeCoach — e2e/wsserver.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A minimal RFC 6455 WebSocket server end for the fake engine, so the e2e
 * tests need no dependency: the opening handshake on an HTTP `upgrade`, text
 * frames both ways, ping/pong, close with a code, and an abrupt drop (the TCP
 * socket destroyed, which the browser reports as close 1006). No extensions
 * (permessage-deflate is never negotiated), no binary payloads beyond noting
 * them.
 */
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * Finishes the handshake for an HTTP `upgrade` request and returns the
 * connection, or null (after answering 400) when the request is not a
 * WebSocket upgrade.
 */
export function acceptUpgrade(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || (req.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
  socket.setNoDelay(true);
  return new WsConnection(socket, head);
}

/** Refuses an upgrade with an HTTP status (the browser sees a failed connection). */
export function refuseUpgrade(socket, status = 503, text = 'Service Unavailable') {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** Events: `message` (string), `close` ({code, reason, abrupt}). */
export class WsConnection extends EventEmitter {
  #socket;
  #buf = Buffer.alloc(0);
  #fragments = [];
  #closed = false;
  #closeSent = false;

  constructor(socket, head) {
    super();
    this.#socket = socket;
    socket.on('data', (d) => this.#onData(d));
    socket.on('close', () => this.#finish(1006, '', true));
    socket.on('error', () => this.#finish(1006, '', true));
    if (head && head.length) this.#onData(head);
  }

  get open() {
    return !this.#closed && !this.#closeSent;
  }

  send(text) {
    if (!this.open) return false;
    this.#socket.write(frame(0x1, Buffer.from(text, 'utf8')));
    return true;
  }

  /** A clean close handshake with `code`. */
  close(code = 1000, reason = '') {
    if (this.#closed || this.#closeSent) return;
    this.#closeSent = true;
    const r = Buffer.from(reason, 'utf8').subarray(0, 120);
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this.#socket.write(frame(0x8, p));
    // The peer answers with its own close; don't wait long for it.
    setTimeout(() => this.#socket.destroy(), 500).unref();
  }

  /** Drop the TCP connection with no close frame: the browser sees 1006. */
  terminate() {
    this.#socket.destroy();
  }

  #finish(code, reason, abrupt) {
    if (this.#closed) return;
    this.#closed = true;
    this.emit('close', { code, reason, abrupt });
  }

  #onData(d) {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, d]) : d;
    for (;;) {
      const f = parse(this.#buf);
      if (!f) return;
      this.#buf = this.#buf.subarray(f.size);
      this.#onFrame(f);
    }
  }

  #onFrame({ fin, opcode, payload }) {
    if (opcode === 0x8) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
      if (!this.#closeSent) {
        this.#closeSent = true;
        this.#socket.write(frame(0x8, payload.subarray(0, 2)));
      }
      this.#socket.end();
      this.#finish(code, reason, false);
      return;
    }
    if (opcode === 0x9) {
      if (this.open) this.#socket.write(frame(0xa, payload));
      return;
    }
    if (opcode === 0xa) return;
    if (opcode === 0x0 || opcode === 0x1 || opcode === 0x2) {
      if (opcode !== 0x0) this.#fragments = [{ opcode, payload }];
      else this.#fragments.push({ opcode, payload });
      if (!fin) return;
      const first = this.#fragments[0]?.opcode ?? 0x1;
      const data = Buffer.concat(this.#fragments.map((x) => x.payload));
      this.#fragments = [];
      this.emit('message', first === 0x1 ? data.toString('utf8') : data);
    }
  }
}

function frame(opcode, payload) {
  const n = payload.length;
  let head;
  if (n < 126) {
    head = Buffer.from([0x80 | opcode, n]);
  } else if (n < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, payload]);
}

function parse(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    off = 10;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < off + maskLen + len) return null;
  const mask = masked ? buf.subarray(off, off + 4) : null;
  const payload = Buffer.from(buf.subarray(off + maskLen, off + maskLen + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  return { fin, opcode, payload, size: off + maskLen + len };
}

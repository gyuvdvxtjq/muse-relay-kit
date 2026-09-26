'use strict';
const net = require('net');
const crypto = require('crypto');
const RELAY_URL = process.env.RELAY_URL || 'ws://147.135.128.19:20178/tunnel?token=_ucQXUQbnT9YjZB5yCB49tEv';
const SSH_HOST = process.env.SSH_HOST || '127.0.0.1';
const SSH_PORT = parseInt(process.env.SSH_PORT || '22', 10);
const PING_INTERVAL = parseInt(process.env.PING_INTERVAL || '30000', 10);
const um = RELAY_URL.match(/^ws:\/\/([^\/]+)(\/.*)$/);
if (!um) { console.error('bad RELAY_URL'); process.exit(1); }
const uparts = um[1].split(':');
const RHOST = uparts[0], RPORT = parseInt(uparts[1] || '80', 10), RPATH = um[2];

class MiniWS {
  constructor() { this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null; this.opened = false; this.buf = Buffer.alloc(0); this.frags = []; }
  connect() {
    this.opened = false; this.buf = Buffer.alloc(0); this.frags = [];
    this.sock = net.connect(RPORT, RHOST, () => {
      const key = crypto.randomBytes(16).toString('base64');
      this.sock.write(`GET ${RPATH} HTTP/1.1\r\nHost: ${RHOST}:${RPORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    this.sock.on('data', d => this._data(d));
    this.sock.on('close', () => { this.opened = false; this.onclose && this.onclose(); });
    this.sock.on('error', e => this.onerror && this.onerror(e));
  }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (!this.opened) {
      const i = this.buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      const head = this.buf.slice(0, i).toString();
      if (!/HTTP\/1\.1 101/.test(head)) { this.onerror && this.onerror(new Error('handshake: ' + head.split('\r\n')[0])); this.sock.destroy(); return; }
      this.buf = this.buf.slice(i + 4); this.opened = true; this.onopen && this.onopen();
    }
    this._frames();
  }
  _frames() {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = b.readUInt32BE(6) + b.readUInt32BE(2) * 4294967296; off = 10; }
      if (len > 16777216) { this.sock.destroy(); return; }
      let mask = null;
      if (masked) { if (b.length < off + 4) return; mask = b.slice(off, off + 4); off += 4; }
      if (b.length < off + len) return;
      let p = b.slice(off, off + len);
      this.buf = b.slice(off + len);
      if (mask) { const q = Buffer.from(p); for (let i = 0; i < q.length; i++) q[i] ^= mask[i & 3]; p = q; }
      if (op === 9) { this.sock.write(this._frame(10, p)); continue; }
      if (op === 10) { this.pongSeen = true; continue; }
      if (op === 8) { this.sock.destroy(); return; }
      if (op === 1 || op === 2) { if (fin) this.onmessage && this.onmessage(p); else this.frags = [p]; }
      else if (op === 0) { this.frags.push(p); if (fin) { const full = Buffer.concat(this.frags); this.frags = []; this.onmessage && this.onmessage(full); } }
    }
  }
  _frame(op, payload) {
    const mask = crypto.randomBytes(4), len = payload.length;
    let h;
    if (len < 126) { h = Buffer.alloc(2); h[1] = 0x80 | len; }
    else if (len < 65536) { h = Buffer.alloc(4); h[1] = 0x80 | 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[1] = 0x80 | 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); }
    h[0] = 0x80 | op;
    const m = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) m[i] = payload[i] ^ mask[i & 3];
    return Buffer.concat([h, mask, m]);
  }
  send(s) { if (this.opened) this.sock.write(this._frame(1, Buffer.from(s))); }
  destroy() { try { this.sock.destroy(); } catch (e) {} }
}

let ws = null, backoff = 2000, pingTimer = null;
const streams = new Map();
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
function send(o) { if (ws && ws.opened) ws.send(JSON.stringify(o)); }
function dialSSH(id) {
  const sock = net.connect(SSH_PORT, SSH_HOST);
  streams.set(id, sock);
  sock.on('data', c => send({ type: 'data', id, b64: c.toString('base64') }));
  sock.on('close', () => { if (streams.delete(id)) send({ type: 'ssh_close', id }); });
  sock.on('error', e => { console.log(`[${ts()}] [ssh] id=${id} ${e.message}`); sock.destroy(); });
}
function destroyAll() { for (const [id, s] of streams) { s.destroy(); streams.delete(id); } }
function stopPing() { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } }
function connect() {
  console.log(`[${ts()}] [ws] dialing relay...`);
  ws = new MiniWS();
  ws.pongSeen = true;
  ws.onopen = () => { console.log(`[${ts()}] tunnel up`); backoff = 2000;
    stopPing(); pingTimer = setInterval(() => {
      if (!ws || !ws.opened) return;
      if (!ws.pongSeen) { console.log(`[${ts()}] [ws] ping timeout, reset`); ws.destroy(); return; }
      ws.pongSeen = false; try { ws.sock.write(ws._frame(9, Buffer.alloc(0))); } catch (e) {}
    }, PING_INTERVAL); };
  ws.onmessage = raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.type === 'ssh_open' && m.id) { console.log(`[${ts()}] [ssh] new session ${m.id}`); dialSSH(m.id); }
    else if (m.type === 'data' && m.id) { const s = streams.get(m.id); if (s) s.write(Buffer.from(m.b64, 'base64')); }
    else if (m.type === 'ssh_close' && m.id) { const s = streams.get(m.id); if (s) { streams.delete(m.id); s.destroy(); } }
  };
  ws.onclose = () => { stopPing(); destroyAll(); const d = backoff + Math.floor(Math.random() * 1000); console.log(`[${ts()}] [ws] closed, retry in ${d}ms`); setTimeout(connect, d); backoff = Math.min(backoff * 2, 30000); };
  ws.onerror = e => console.log(`[${ts()}] [ws] error: ${e.message}`);
  ws.connect();
}
process.on('uncaughtException', e => console.log(`[${ts()}] [uncaught] ${e.message}`));
process.on('unhandledRejection', e => console.log(`[${ts()}] [rejection] ${e && e.message}`));
connect();

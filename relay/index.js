// Katabump 中转：单端口复用（SSH 首包分流 + HTTP/Web终端）
// 依赖: ws, ssh2
'use strict';
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Duplex } = require('stream');
const { WebSocketServer } = require('ws');
const { Client: SSHClient } = require('ssh2');

const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;
const PAGE_TOKEN = process.env.PAGE_TOKEN;
if (!PAGE_TOKEN) { console.error('错误: 需要设置 PAGE_TOKEN 环境变量'); process.exit(1); }
const TUNNEL_TOKEN = process.env.TUNNEL_TOKEN || PAGE_TOKEN;
const SSH_USER = process.env.SSH_USER || 'root';
const PRIVKEY = process.env.SSH_PRIVATE_KEY ||
  fs.readFileSync(path.join(__dirname, 'id_ed25519_relay'), 'utf8');

let dialSock = null;               // muse 拨入的唯一连接
const sessions = new Map();        // id -> TunnelStream

// ============ 隧道数据流：把一条 TCP 流桥接到 muse 的 22 端口 ============
class TunnelStream extends Duplex {
  constructor(id) {
    super();
    this.id = id;
    this.buf = [];
  }
  _read() {}
  _write(chunk, enc, cb) {
    this.tsend({ type: 'data', id: this.id, b64: chunk.toString('base64') });
    cb();
  }
  tsend(obj) {
    if (dialSock && dialSock.readyState === 1) dialSock.send(JSON.stringify(obj));
    else this.emit('error', new Error('tunnel down'));
  }
  pushData(b64) { this.push(Buffer.from(b64, 'base64')); }
  close() { this.tsend({ type: 'ssh_close', id: this.id }); sessions.delete(this.id); this.end(); }
}

function dialSend(obj) {
  if (dialSock && dialSock.readyState === 1) dialSock.send(JSON.stringify(obj));
  return dialSock && dialSock.readyState === 1;
}

// ============ muse 拨入的 WS 通道（/tunnel） ============
function onDialMessage(raw) {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.type === 'data') {
    const s = sessions.get(m.id);
    if (s) s.pushData(m.b64);
  } else if (m.type === 'ssh_close') {
    const s = sessions.get(m.id);
    if (s) { sessions.delete(m.id); s.end(); }
  }
}

// ============ Web 终端（/term?token=xxx）：浏览器 <-> muse sshd ============
function handleTerm(ws) {
  const id = crypto.randomBytes(4).toString('hex');
  const stream = new TunnelStream(id);
  sessions.set(id, stream);
  const ok = dialSend({ type: 'ssh_open', id });
  if (!ok) { ws.send('\r\n[tunnel down: muse 未拨入]\r\n'); ws.close(); return; }

  const conn = new SSHClient();
  conn.on('ready', () => {
    ws.send('\r\n[connected to ' + SSH_USER + '@muse]\r\n');
    conn.shell({ term: 'xterm-256color' }, (err, sh) => {
      if (err) { ws.send('[shell error] ' + err.message + '\r\n'); return; }
      sh.on('data', d => ws.send(d.toString()));
      sh.stderr.on('data', d => ws.send(d.toString()));
      sh.on('close', () => { stream.close(); ws.close(); });
      stream.on('data', d => sh.write(d.toString()));
      ws.on('message', raw => {
        const s = raw.toString();
        if (s.startsWith('{')) {
          try { const j = JSON.parse(s); if (j.type === 'resize') sh.setWindow(j.rows, j.cols, 0, 0); } catch {}
        } else sh.write(s);
      });
    });
  });
  conn.on('error', e => { ws.send('\r\n[ssh error] ' + e.message + '\r\n'); });
  conn.connect({ sock: stream, host: '127.0.0.1', port: 22, username: SSH_USER, privateKey: PRIVKEY });

  ws.on('close', () => { try { conn.end(); } catch {} stream.close(); });
}

// ============ HTTP：healthz / 终端页面 ============
const httpSrv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tunnel: !!dialSock, sessions: sessions.size }));
    return;
  }
  if (u.pathname === '/') {
    if (u.searchParams.get('token') !== PAGE_TOKEN) { res.writeHead(401); res.end('bad token'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'terminal.html')));
    return;
  }
  res.writeHead(404); res.end();
});

// ============ WebSocket 路由 ============
const wssTerm = new WebSocketServer({ noServer: true });
const wssDial = new WebSocketServer({ noServer: true });

httpSrv.on('upgrade', (req, sock, head) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/tunnel' && u.searchParams.get('token') === TUNNEL_TOKEN) {
    wssDial.handleUpgrade(req, sock, head, ws => {
      if (dialSock) { try { dialSock.close(); } catch {} }   // 单会话：新拨入顶掉旧的
      dialSock = ws;
      ws.on('message', onDialMessage);
      ws.on('close', () => { if (dialSock === ws) dialSock = null; for (const s of sessions.values()) s.end(); sessions.clear(); });
      console.log('[tunnel] muse dialed in');
    });
  } else if (u.pathname === '/term' && u.searchParams.get('token') === PAGE_TOKEN) {
    wssTerm.handleUpgrade(req, sock, head, ws => handleTerm(ws));
  } else { sock.destroy(); }
});

// ============ 单端口首包分流：SSH- 开头走直连管道，其余交给 HTTP ============
const tcpSrv = net.createServer(sock => {
  sock.once('data', chunk => {
    if (chunk.slice(0, 4).toString('latin1') === 'SSH-') {
      // 纯管道：客户端 SSH 直接和 muse 的 sshd 握手（真实鉴权在 muse）
      const id = crypto.randomBytes(4).toString('hex');
      const stream = new TunnelStream(id);
      sessions.set(id, stream);
      if (!dialSend({ type: 'ssh_open', id })) { sock.destroy(); return; }
      stream.on('data', d => sock.write(d));
      sock.on('data', d => stream.write(d));
      sock.on('close', () => stream.close());
      stream.on('close', () => sock.destroy());
      sock.unshift(chunk);          // 把首包还给流
    } else {
      sock.unshift(chunk);
      httpSrv.emit('connection', sock);
    }
  });
  sock.on('error', () => {});
});

tcpSrv.listen(PORT, '0.0.0.0', () => console.log(`[relay] listening on 0.0.0.0:${PORT}`));

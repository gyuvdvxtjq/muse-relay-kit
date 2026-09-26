// muse-dial: 内网机主动拨入中转，桥接本机 sshd:22
// 用法: RELAY_URL="ws://中转/tunnel?token=xxx" node muse-dial.js
'use strict';
const WebSocket = require('ws');
const net = require('net');

const RELAY_URL = process.env.RELAY_URL;
if (!RELAY_URL) { console.error('错误: 未设置 RELAY_URL 环境变量'); process.exit(1); }
const SSH_PORT = parseInt(process.env.SSH_PORT || '22', 10);
let ws = null, backoff = 2000, heartbeat = null;
const sessions = new Map();

function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function connect() {
  console.log(new Date().toISOString(), 'dialing relay...');
  ws = new WebSocket(RELAY_URL);
  ws.on('open', () => {
    console.log(new Date().toISOString(), 'tunnel up');
    backoff = 2000;
    clearInterval(heartbeat);
    heartbeat = setInterval(() => { try { ws.ping(); } catch {} }, 25000);
  });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'ssh_open') {
      const s = net.connect(SSH_PORT, '127.0.0.1');
      sessions.set(m.id, s);
      s.on('connect', () => send({ type: 'ssh_opened', id: m.id }));
      s.on('data', d => send({ type: 'data', id: m.id, b64: d.toString('base64') }));
      s.on('error', () => { send({ type: 'ssh_close', id: m.id }); sessions.delete(m.id); });
      s.on('close', () => { send({ type: 'ssh_close', id: m.id }); sessions.delete(m.id); });
    } else if (m.type === 'data') {
      const s = sessions.get(m.id);
      if (s) s.write(Buffer.from(m.b64, 'base64'));
    } else if (m.type === 'ssh_close') {
      const s = sessions.get(m.id);
      if (s) { s.destroy(); sessions.delete(m.id); }
    }
  });
  ws.on('close', () => { clearInterval(heartbeat); retry(); });
  ws.on('error', () => {});
}

function retry() {
  console.log(new Date().toISOString(), 'tunnel down, retry in', backoff, 'ms');
  setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 60000);
}

connect();

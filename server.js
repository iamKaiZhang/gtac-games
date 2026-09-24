import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { Store } from './lib/store.js';
import { sessionToCSV } from './lib/csv.js';
import * as S from './lib/session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.RENDER || !!process.env.FLY_APP_NAME;

let HOST_KEY = process.env.HOST_KEY;
if (!HOST_KEY) {
  if (PRODUCTION) {
    console.error('HOST_KEY is not set. Refusing to start without an instructor key.');
    process.exit(1);
  }
  HOST_KEY = 'dev';
  console.warn('HOST_KEY not set; using "dev" (development only).');
}

const store = new Store(path.join(DATA_DIR, 'sessions.json'));
store.load();
const sessions = store.data.sessions;

function keyOk(key) {
  if (typeof key !== 'string') return false;
  const a = Buffer.from(key), b = Buffer.from(HOST_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------- HTTP ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function sendFile(res, file, status = 200) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(status, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (p === '/' || /^\/j\/[A-Za-z]{4}\/?$/.test(p)) return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
  if (p === '/host' || p === '/host/') return sendFile(res, path.join(PUBLIC_DIR, 'host.html'));
  if (/^\/screen\/[A-Za-z]{4}\/?$/.test(p)) return sendFile(res, path.join(PUBLIC_DIR, 'screen.html'));
  if (p === '/api/qr.svg') {
    const u = (url.searchParams.get('u') || '').slice(0, 300);
    try {
      const svg = await QRCode.toString(u, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
      return res.end(svg);
    } catch { res.writeHead(400); return res.end('bad url'); }
  }
  const m = p.match(/^\/api\/export\/([A-Za-z]{4})\.csv$/);
  if (m) {
    if (!keyOk(url.searchParams.get('key'))) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('unauthorized'); }
    const s = sessions[m[1].toUpperCase()];
    if (!s) { res.writeHead(404); return res.end('no such session'); }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="gtc-${s.code}${s.rehearsal ? '-rehearsal' : ''}.csv"` });
    return res.end(sessionToCSV(s));
  }
  // static assets
  const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendFile(res, path.join(PUBLIC_DIR, 'index.html'), 404);
    sendFile(res, file);
  });
});

// ---------------- WebSocket ----------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 * 1024 });
const meta = new Map(); // ws -> { role, code, playerId, alive }

const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
const sendError = (ws, message, reqId) => send(ws, { type: 'error', message, ...(reqId !== undefined ? { reqId } : {}) });

function connectedIds(code) {
  const ids = new Set();
  for (const [ws, m] of meta) if (m.role === 'student' && m.code === code && m.playerId && ws.readyState === ws.OPEN) ids.add(m.playerId);
  return ids;
}

function viewFor(ws, m) {
  const s = sessions[m.code];
  if (!s) return { type: 'state', view: null };
  if (m.role === 'student') return { type: 'state', view: S.studentView(s, m.playerId) };
  if (m.role === 'screen') return { type: 'state', view: S.screenView(s, connectedIds(m.code).size) };
  if (m.role === 'host') return { type: 'state', view: S.hostView(s, connectedIds(m.code)) };
  return { type: 'state', view: null };
}

function broadcast(code, { students = true } = {}) {
  for (const [ws, m] of meta) {
    if (m.code !== code) continue;
    if (!students && m.role === 'student') continue;
    send(ws, viewFor(ws, m));
  }
}

function sessionList() {
  return Object.values(sessions)
    .map((s) => ({ code: s.code, name: s.name, rehearsal: s.rehearsal, createdAt: s.createdAt, updatedAt: s.updatedAt, players: Object.keys(s.players).length, rounds: s.rounds.filter((r) => r.status === 'revealed').length }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function newCode() {
  for (let i = 0; i < 50; i++) { const c = S.randomCode(4); if (!sessions[c]) return c; }
  throw new Error('could not allocate a room code');
}

wss.on('connection', (ws) => {
  const m = { role: null, code: null, playerId: null, alive: true };
  meta.set(ws, m);
  ws.on('pong', () => { m.alive = true; });
  ws.on('close', () => {
    meta.delete(ws);
    if (m.role === 'student' && m.code) broadcast(m.code, { students: false });
  });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return sendError(ws, 'bad message'); }
    try {
      handle(ws, m, msg);
      if (msg.reqId !== undefined) send(ws, { type: 'ack', reqId: msg.reqId }); // sent after any state broadcast
    } catch (e) {
      if (e instanceof S.SessionError) return sendError(ws, e.message, msg.reqId);
      console.error('handler error', e);
      sendError(ws, 'Server error: ' + e.message, msg.reqId);
    }
  });
});

function handle(ws, m, msg) {
  const t = msg.type;
  if (t === 'ping') return send(ws, { type: 'pong' });

  // ---- student ----
  if (t === 'join') {
    const code = String(msg.code || '').toUpperCase().trim();
    const s = sessions[code];
    if (!s) throw new S.SessionError('No session with that code. Check the code on the projector.');
    let result;
    if (msg.playerId && s.players[msg.playerId]) result = S.joinPlayer(s, { playerId: msg.playerId });
    else if (msg.nickname) result = S.joinPlayer(s, { nickname: msg.nickname });
    else return send(ws, { type: 'need-nickname', code });
    m.role = 'student'; m.code = code; m.playerId = result.player.id;
    send(ws, { type: 'joined', code, playerId: result.player.id, nickname: result.player.nickname });
    send(ws, viewFor(ws, m));
    store.save();
    broadcast(code, { students: false });
    return;
  }
  if (t === 'submit') {
    if (m.role !== 'student' || !m.code) throw new S.SessionError('Join the session first.');
    const s = sessions[m.code];
    if (!s) throw new S.SessionError('This session no longer exists.');
    const round = S.submit(s, m.playerId, msg.value);
    store.save();
    send(ws, { type: 'submitted', roundId: round.id, value: msg.value, at: round.submissions[m.playerId].at });
    send(ws, viewFor(ws, m));
    // other tabs of the same student see the revision too
    for (const [ows, om] of meta) if (ows !== ws && om.role === 'student' && om.code === m.code && om.playerId === m.playerId) send(ows, viewFor(ows, om));
    broadcast(m.code, { students: false });
    return;
  }

  // ---- projector ----
  if (t === 'watch') {
    const code = String(msg.code || '').toUpperCase();
    if (!sessions[code]) throw new S.SessionError('No session with that code.');
    m.role = 'screen'; m.code = code;
    return send(ws, viewFor(ws, m));
  }

  // ---- instructor ----
  if (!t.startsWith('host:')) throw new S.SessionError('Unknown message type.');
  if (!keyOk(msg.key)) return send(ws, { type: 'unauthorized' });
  const action = t.slice(5);

  if (action === 'auth') return send(ws, { type: 'authorized', sessions: sessionList() });
  if (action === 'list') return send(ws, { type: 'sessions', sessions: sessionList() });
  if (action === 'create') {
    const code = newCode();
    sessions[code] = S.createSession({ code, name: msg.name, rehearsal: !!msg.rehearsal });
    m.role = 'host'; m.code = code;
    store.save();
    send(ws, { type: 'sessions', sessions: sessionList() });
    return send(ws, viewFor(ws, m));
  }
  if (action === 'attach') {
    const code = String(msg.code || '').toUpperCase();
    if (!sessions[code]) throw new S.SessionError('No session with that code.');
    m.role = 'host'; m.code = code;
    return send(ws, viewFor(ws, m));
  }
  if (action === 'detach') { m.role = 'host'; m.code = null; return send(ws, { type: 'sessions', sessions: sessionList() }); }
  if (action === 'delete') {
    const code = String(msg.code || '').toUpperCase();
    if (!sessions[code]) throw new S.SessionError('No such session.');
    delete sessions[code];
    store.save();
    for (const [ows, om] of meta) if (om.code === code) { send(ows, { type: 'session-deleted' }); om.code = null; }
    return send(ws, { type: 'sessions', sessions: sessionList() });
  }
  if (action === 'restore') {
    const snap = msg.session;
    if (!snap || typeof snap !== 'object' || !/^[A-Z]{4}$/.test(snap.code || '') || typeof snap.players !== 'object' || !Array.isArray(snap.rounds)) throw new S.SessionError('That backup is not a valid session.');
    sessions[snap.code] = snap;
    m.role = 'host'; m.code = snap.code;
    store.save();
    send(ws, { type: 'sessions', sessions: sessionList() });
    broadcast(snap.code);
    return;
  }

  // everything below needs an attached session
  const s = m.code && sessions[m.code];
  if (!s) throw new S.SessionError('Attach to a session first.');
  let studentsToo = true;
  switch (action) {
    case 'selectGame': S.setSelectedGame(s, msg.game); break;
    case 'startRound': S.startRound(s, msg.game || s.game); break;
    case 'open': S.openRound(s); break;
    case 'close': S.closeRound(s); break;
    case 'reopen': S.reopenRound(s); break;
    case 'reveal': S.revealRound(s); break;
    case 'cancel': S.cancelRound(s); break;
    case 'setRoad': S.setRoad(s, !!msg.open); break;
    case 'revealTheory': S.setTheoryRevealed(s, !!msg.shown); break;
    case 'makeGroups': S.makeGroups(s, Number(msg.size) || 4); break;
    case 'excludeGroup': S.setGroupExcluded(s, msg.roundId, Number(msg.group), !!msg.excluded); break;
    case 'removePlayer': {
      S.removePlayer(s, msg.playerId);
      for (const [ows, om] of meta) if (om.role === 'student' && om.code === s.code && om.playerId === msg.playerId) { send(ows, { type: 'removed' }); om.playerId = null; om.code = null; }
      break;
    }
    default: throw new S.SessionError('Unknown host action: ' + action);
  }
  store.save();
  broadcast(s.code, { students: studentsToo });
}

// heartbeat: drop dead sockets so "online" counts stay honest
setInterval(() => {
  for (const [ws, m] of meta) {
    if (!m.alive) { ws.terminate(); continue; }
    m.alive = false;
    try { ws.ping(); } catch {}
  }
}, 30000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flush(); process.exit(0); });

server.listen(PORT, () => console.log(`gtc-games listening on http://localhost:${PORT}  (data: ${DATA_DIR})`));

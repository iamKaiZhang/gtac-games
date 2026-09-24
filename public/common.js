// Shared client helpers: resilient WebSocket, tiny DOM builder, formatting, network diagram.

export function connect({ onOpen, onMessage, onClose }) {
  let ws = null, tries = 0;
  const api = {
    send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
    get open() { return !!ws && ws.readyState === 1; },
  };
  function start() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { tries = 0; onOpen?.(api); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.type !== 'pong') onMessage?.(m); };
    ws.onclose = () => { onClose?.(); setTimeout(start, Math.min(5000, 400 * 2 ** Math.min(tries++, 4))); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  setInterval(() => api.send({ type: 'ping' }), 25000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && (!ws || ws.readyState > 1)) start(); });
  start();
  return api;
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const fmt = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number.isInteger(n) ? String(n) : Number(n).toFixed(d));

export const GAME_NAMES = { beauty: 'Beauty contest', braess: "Braess's paradox", pgg: 'Public goods' };
export const STATUS_LABEL = { waiting: 'Waiting', open: 'Voting open', closed: 'Voting closed', revealed: 'Results revealed' };
export const ROUTE_META = {
  upper: { label: 'Upper route', path: 'S → A → T', color: 'var(--blue)' },
  lower: { label: 'Lower route', path: 'S → B → T', color: 'var(--yellow)' },
  shortcut: { label: 'Shortcut', path: 'S → A → B → T', color: 'var(--coral)' },
};
// Mentimeter's chart palette: blue, yellow, coral, green, purple
export const PALETTE = ['#5769e7', '#ffc738', '#ff7471', '#52ad6e', '#8e8eea'];

export function toast(text, ms = 2500) {
  const t = h('div', { class: 'toast' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export const INSTRUCTIONS = {
  beauty: 'Choose an integer from 0 to 100. The number closest to two-thirds of the average of all submitted numbers wins. Your own number counts toward the average. Choose independently. Ties share the win.',
  braess: 'You are a driver going from S to T. Travel times on S → A and B → T depend on how many drivers actually choose them: 10 × (share of drivers on that road). A → T and S → B take a fixed 11. Pick the route you expect to be fastest.',
  pgg: 'You receive 10 tokens. Choose how many (0 to 10) to put into your group\'s pot; you keep the rest. The pot is doubled and split equally among everyone in your group, whatever they contributed.',
};

/**
 * Four-node network diagram. loads: {SA:{load,time},...} shows numbers after reveal.
 * onPick(route) makes routes clickable.
 */
export function networkSVG({ roadOpen, route = null, edges = null, N = null, onPick = null, compact = false }) {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 640, H = compact ? 300 : 340;
  const P = { S: [70, H / 2], A: [320, 60], B: [320, H - 60], T: [570, H / 2] };
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'net');
  const routes = { upper: ['SA', 'AT'], lower: ['SB', 'BT'], shortcut: ['SA', 'AB', 'BT'] };
  const onRoute = new Set(route ? routes[route] : []);
  const edgeDefs = [
    ['SA', 'S', 'A', edges ? `10 × ${edges.SA.load}/${N} = ${fmt(edges.SA.time, 1)}` : '10 · x / N', -1],
    ['AT', 'A', 'T', edges ? `11` : '11', -1],
    ['SB', 'S', 'B', edges ? `11` : '11', 1],
    ['BT', 'B', 'T', edges ? `10 × ${edges.BT.load}/${N} = ${fmt(edges.BT.time, 1)}` : '10 · y / N', 1],
    ['AB', 'A', 'B', roadOpen ? (edges ? `0  (${edges.AB.load} drivers)` : '0') : 'closed', 0],
  ];
  const line = (from, to, cls) => {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', P[from][0]); l.setAttribute('y1', P[from][1]);
    l.setAttribute('x2', P[to][0]); l.setAttribute('y2', P[to][1]);
    l.setAttribute('class', cls);
    return l;
  };
  for (const [id, a, b, label, side] of edgeDefs) {
    if (id === 'AB' && !roadOpen && compact) { /* still draw faint */ }
    const cls = ['edge', onRoute.has(id) ? 'on' : '', id === 'AB' && !roadOpen ? 'dashed' : ''].join(' ');
    const l = line(a, b, cls);
    if (id === 'AB' && !roadOpen) l.style.opacity = '0.35';
    if (id === 'AB' && roadOpen && !onRoute.has(id)) l.style.stroke = 'var(--green)';
    svg.append(l);
    const t = document.createElementNS(ns, 'text');
    const mx = (P[a][0] + P[b][0]) / 2, my = (P[a][1] + P[b][1]) / 2;
    const dx = id === 'AB' ? 16 : 0;
    const dy = id === 'AB' ? 0 : side * 22 + (side < 0 ? -2 : 8);
    t.setAttribute('x', mx + dx); t.setAttribute('y', my + dy);
    t.setAttribute('class', 'lbl' + (onRoute.has(id) ? ' strong' : ''));
    if (id === 'AB') t.setAttribute('text-anchor', 'start');
    t.textContent = label;
    svg.append(t);
  }
  if (onPick) {
    const hits = [['upper', 'S', 'A', 'A', 'T'], ['lower', 'S', 'B', 'B', 'T']];
    if (roadOpen) hits.push(['shortcut', 'A', 'B', 'A', 'B']);
    for (const [r, a, b, c, d] of hits) {
      for (const [x, y] of [[a, b], [c, d]]) {
        const l = line(x, y, 'hit');
        l.addEventListener('click', () => onPick(r));
        svg.append(l);
      }
    }
  }
  for (const [name, [x, y]] of Object.entries(P)) {
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'node');
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 24);
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y); t.textContent = name;
    g.append(c, t);
    svg.append(g);
  }
  return svg;
}

/** Histogram with optional vertical markers. bins: [{label, count}], markers: [{pos 0..1, label, color}] */
export function histogram({ bins, markers = [], axis = [], color = 'var(--blue)', showCounts = true }) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  const wrap = h('div', { class: 'chart' });
  const bars = h('div', { class: 'bars' }, bins.map((b) => h('div', { class: 'bar', title: `${b.label}: ${b.count}` },
    showCounts && b.count ? h('b', {}, b.count) : null,
    h('i', { style: { height: `${(b.count / max) * 100}%`, background: color, opacity: b.count ? 1 : 0.15, minHeight: b.count ? '4px' : '2px' } }),
  )));
  wrap.append(bars);
  markers.forEach((m, i) => {
    const left = `${Math.min(99.5, Math.max(0.5, m.pos * 100))}%`;
    // one label row per marker so close values (e.g. mean 53, target 35) never overlap
    wrap.append(h('div', { class: 'marker' + (m.pos > 0.7 ? ' left' : ''), style: { left, background: m.color } }, h('span', { style: { background: m.color, top: `${i * 32}px` } }, m.label)));
  });
  if (axis.length) wrap.append(h('div', { class: 'axis' }, axis.map((a) => h('span', {}, a))));
  return wrap;
}

export function hbars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('div', {}, rows.map((r) => h('div', { class: 'hbar' },
    h('div', {}, r.label),
    h('div', { class: 'track' }, h('i', { style: { width: `${(r.value / max) * 100}%`, background: r.color || 'var(--blue)' } })),
    h('div', { class: 'num' }, r.display ?? r.value),
  )));
}

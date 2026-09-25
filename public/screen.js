import { connect, h, $, clear, fmt, GAME_NAMES, STATUS_LABEL, ROUTE_META, networkSVG, histogram, hbars, pointsList, routeLegend, PAYOFF_FORMULA } from './common.js';

const app = $('#app');
const code = (location.pathname.match(/^\/screen\/([A-Za-z]{4})/) || [])[1]?.toUpperCase();
const joinUrl = `${location.origin}/j/${code}`;
const shortUrl = `${location.host}/j/${code}`;
let view = null;
let connected = false;

const ws = connect({
  onOpen() { connected = true; ws.send({ type: 'watch', code }); },
  onClose() { connected = false; render(); },
  onMessage(m) {
    if (m.type === 'state') { view = m.view; render(); }
    if (m.type === 'error') { clear(app).append(h('div', { class: 'body full' }, h('div', { class: 'card' }, h('h1', {}, 'No such session'), h('p', {}, m.message)))); }
  },
});

function qr(cls = 'qr') { return h('div', { class: cls, html: '' }, h('img', { src: `/api/qr.svg?u=${encodeURIComponent(joinUrl)}`, alt: 'QR code to join', style: { width: '100%', display: 'block' } })); }

function render() {
  if (!view) return;
  $('#banner').classList.toggle('hidden', !view.rehearsal);
  clear(app);
  const r = view.round;
  app.append(h('div', { class: 'head' },
    h('div', { class: 'go' }, 'Go to ', h('b', {}, shortUrl.replace(/\/j\/.*/, '')), ' and use the code', h('span', { class: 'code' }, view.code)),
    h('div', { class: 'row', style: { gap: '28px' } },
      h('div', { class: 'stat' }, h('div', { class: 'v', style: { fontSize: '36px' } }, view.playerCount), h('div', { class: 'k' }, 'joined')),
      r ? h('span', { class: 'pill ' + r.status }, STATUS_LABEL[r.status]) : null,
      !connected ? h('span', { class: 'pill closed' }, 'reconnecting…') : null,
      r ? qr('qr mini') : null),
  ));
  if (!r) return app.append(renderLobby());
  const main = h('div', {});
  if (r.status === 'waiting' || r.status === 'open' || r.status === 'closed') main.append(renderInstructions(r));
  if (r.status === 'revealed') main.append(renderResults(r));
  const side = h('div', {});
  if (r.status === 'open' || r.status === 'closed') side.append(renderProgress(r));
  if (r.status === 'revealed') side.append(renderHistory(r));
  if (view.braess.theoryRevealed && view.braess.theory && r.game === 'braess' && r.status === 'revealed') side.append(renderTheory(view.braess.theory));
  app.append(h('div', { class: 'body' + (side.childElementCount ? '' : ' full') }, main, side));
}

function renderLobby() {
  return h('div', { class: 'body' },
    h('div', {},
      h('h1', {}, view.name || 'Game Theory & Control'),
      h('p', {}, 'Scan the QR code or open ', h('b', {}, shortUrl.replace(/\/j\/.*/, '')), ' and enter the code ', h('b', { style: { letterSpacing: '0.15em' } }, view.code), '.'),
      h('p', {}, 'Choose a nickname, then keep the page open. You stay connected while we switch between games.'),
      h('div', { class: 'stats', style: { marginTop: '40px' } }, h('div', { class: 'stat' }, h('div', { class: 'v', style: { fontSize: '96px' } }, view.playerCount), h('div', { class: 'k' }, 'students joined')))),
    h('div', {}, qr()));
}

function renderProgress(r) {
  const pct = r.expected ? (r.submitted / r.expected) * 100 : 0;
  return h('div', { class: 'card' },
    h('div', { class: 'stat' }, h('div', { class: 'v', style: { fontSize: '84px' } }, `${r.submitted}`, h('span', { style: { fontSize: '40px', color: 'var(--text-2)' } }, ` / ${r.expected}`)), h('div', { class: 'k' }, r.status === 'open' ? 'submitted so far' : 'submitted')),
    h('div', { class: 'progress mt', style: { height: '28px' } }, h('div', { style: { width: `${pct}%` } })),
    r.status === 'open' ? h('p', { class: 'muted mt', style: { fontSize: '22px' } }, 'You can change your answer until voting closes.') : h('p', { class: 'muted mt', style: { fontSize: '22px' } }, 'Voting is closed. Results coming up…'));
}

function renderInstructions(r) {
  const box = h('div', { class: 'slide' }, h('h1', {}, `${GAME_NAMES[r.game]}`, h('span', { class: 'sub' }, ` · Round ${r.index}`)));
  if (r.game === 'beauty') {
    box.append(pointsList('beauty'),
      h('div', { class: 'callout' }, h('span', { class: 'muted' }, 'Example  '), 'average 30  →  target ', h('mark', { class: 'hl' }, '20')));
  }
  if (r.game === 'braess') {
    box.append(h('div', { class: 'slide-cols' },
      h('div', {}, pointsList('braess', { roadOpen: r.config.roadOpen })),
      h('div', { class: 'card', style: { margin: 0 } }, networkSVG({ roadOpen: r.config.roadOpen }), routeLegend(r.config.roadOpen))),
      h('p', { class: 'muted small-screen' }, 'x = drivers on S → A, y = drivers on B → T, N = drivers who submitted.'));
  }
  if (r.game === 'pgg') {
    box.append(pointsList('pgg'),
      h('div', { class: 'callout' }, PAYOFF_FORMULA),
      h('p', { class: 'muted small-screen' }, `${r.config.groupCount} groups (sizes ${r.config.sizes.join(', ')}). Your group is shown on your phone and stays the same every round.`));
  }
  return box;
}

function renderResults(r) {
  const res = r.result;
  const box = h('div', {}, h('h1', {}, `${GAME_NAMES[r.game]}`, h('span', { class: 'sub' }, ` · Round ${r.index} results`)));
  if (r.game === 'beauty') {
    if (!res.n) return box.append(h('p', {}, 'No submissions in this round.')), box;
    box.append(h('div', { class: 'stats mb' },
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(res.mean)), h('div', { class: 'k' }, 'mean')),
      h('div', { class: 'stat' }, h('div', { class: 'v', style: { color: 'var(--blue-700)' } }, fmt(res.target)), h('div', { class: 'k' }, 'target = ⅔ × mean')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, res.n), h('div', { class: 'k' }, 'submissions'))));
    const bins = res.histogram.map((b) => ({ label: `${b.from}–${b.to === 100 ? 100 : b.to - 1}`, count: b.count }));
    box.append(h('div', { class: 'card' }, histogram({ bins, axis: ['0', '25', '50', '75', '100'], markers: [{ pos: res.mean / 100, label: `mean ${fmt(res.mean, 1)}`, color: 'var(--yellow)' }, { pos: res.target / 100, label: `target ${fmt(res.target, 1)}`, color: 'var(--coral)' }] })));
    box.append(h('div', { class: 'card', style: { background: 'var(--yellow-soft)', borderColor: 'transparent' } }, h('p', { style: { margin: 0 } }, `Winner${res.winners.length > 1 ? 's' : ''}: `, h('b', {}, res.winners.map((w) => `${w.nickname} (${w.value})`).join(', ')))));
  } else if (r.game === 'braess') {
    if (!res.N) return box.append(h('p', {}, 'No submissions in this round.')), box;
    const routes = ['upper', 'lower', ...(res.roadOpen ? ['shortcut'] : [])];
    box.append(h('div', { class: 'stats mb' },
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(res.average, 2)), h('div', { class: 'k' }, 'average travel time')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, res.N), h('div', { class: 'k' }, 'drivers')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, res.roadOpen ? 'open' : 'closed'), h('div', { class: 'k' }, 'road A → B'))));
    box.append(h('div', { class: 'card' }, hbars(routes.map((k) => ({ label: ROUTE_META[k].label, value: res.counts[k], display: `${res.counts[k]} · ${fmt(res.times[k], 1)}`, color: ROUTE_META[k].color }))), h('div', { class: 'legend' }, h('span', {}, 'drivers · travel time on that route'))));
    box.append(h('div', { class: 'card', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'center' } },
      networkSVG({ roadOpen: res.roadOpen, edges: res.edges, N: res.N, compact: true }),
      h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Edge'), h('th', { class: 'num' }, 'Drivers'), h('th', { class: 'num' }, 'Time'))), h('tbody', {},
        [['S → A', 'SA'], ['A → T', 'AT'], ['S → B', 'SB'], ['B → T', 'BT'], ...(res.roadOpen ? [['A → B', 'AB']] : [])].map(([n, k]) => h('tr', {}, h('td', {}, n), h('td', { class: 'num' }, res.edges[k].load), h('td', { class: 'num' }, fmt(res.edges[k].time, 2))))))));
  } else if (r.game === 'pgg') {
    box.append(h('div', { class: 'stats mb' },
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(res.avgContribution)), h('div', { class: 'k' }, 'average contribution')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(res.avgPayoff)), h('div', { class: 'k' }, 'average payoff')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, `${res.scoredGroupCount} / ${res.groupCount}`), h('div', { class: 'k' }, 'groups scored'))));
    box.append(h('div', { class: 'card' }, h('h3', {}, 'Contributions (anonymous)'), histogram({ bins: res.histogram.map((b) => ({ label: String(b.value), count: b.count })), axis: Array.from({ length: 11 }, (_, i) => String(i)), color: 'var(--green)' })));
    if (res.incompleteGroupCount || res.excludedGroupCount) box.append(h('p', { class: 'muted' }, `${res.incompleteGroupCount ? `${res.incompleteGroupCount} incomplete group(s) not scored. ` : ''}${res.excludedGroupCount ? `${res.excludedGroupCount} group(s) excluded by the instructor.` : ''}`));
    box.append(h('p', { class: 'muted' }, 'Everyone would be best off contributing everything; each individual is best off contributing nothing. Where did the class land?'));
  }
  return box;
}

function renderHistory(r) {
  const same = view.history.filter((x) => x.game === r.game);
  if (same.length < 2) return h('div', {});
  const box = h('div', { class: 'card' }, h('h3', {}, `${GAME_NAMES[r.game]} · round by round`));
  if (r.game === 'beauty') box.append(hbars(same.map((x) => ({ label: `Round ${x.index}`, value: x.result.target ?? 0, display: x.result.n ? `target ${fmt(x.result.target, 1)}` : '–', color: 'var(--coral)' }))));
  if (r.game === 'braess') box.append(hbars(same.map((x) => ({ label: `Round ${x.index} · ${x.roadOpen ? 'open' : 'closed'}`, value: x.result.average ?? 0, display: x.result.N ? `avg ${fmt(x.result.average, 1)}` : '–', color: x.roadOpen ? 'var(--coral)' : 'var(--blue)' }))), h('div', { class: 'legend' }, h('span', {}, h('i', { style: { background: 'var(--blue)' } }), 'road closed'), h('span', {}, h('i', { style: { background: 'var(--coral)' } }), 'road open')));
  if (r.game === 'pgg') box.append(hbars(same.map((x) => ({ label: `Round ${x.index}`, value: x.result.avgContribution ?? 0, display: x.result.nScored ? `avg ${fmt(x.result.avgContribution, 1)}` : '–', color: 'var(--green)' }))), h('div', { class: 'legend' }, h('span', {}, 'average contribution per round (0–10)')));
  return box;
}

function renderTheory(t) {
  return h('div', { class: 'card', style: { background: 'var(--yellow-soft)', borderColor: 'transparent' } }, h('h3', {}, `Theory · N = ${t.N} drivers`),
    h('p', {}, h('b', {}, 'Road closed: '), `split ${t.closed.split.upper} / ${t.closed.split.lower} gives ${fmt(t.closed.times.upper, 1)} and ${fmt(t.closed.times.lower, 1)}.`, t.N % 2 === 0 ? ' Everyone takes 16.' : '', t.closed.deviateToLower !== null ? ` Switching alone to the lower route would take ${fmt(t.closed.deviateToLower, 1)}.` : ''),
    h('p', {}, h('b', {}, 'Road open: '), `everyone on the shortcut takes ${fmt(t.open.allShortcut, 1)}. A lone driver switching to an outer route takes ${fmt(t.open.deviateToUpper, 1)}, so nobody wants to switch: a Nash equilibrium that is worse for everyone than 16.`));
}

import { connect, h, $, clear, fmt, toast, GAME_NAMES, ROUTE_META, networkSVG, pointsList, PAYOFF_FORMULA } from './common.js';

const app = $('#app');
const urlCode = (location.pathname.match(/^\/j\/([A-Za-z]{4})/) || [])[1];
let code = (urlCode || localStorage.getItem('gtc_last_code') || '').toUpperCase();
let playerId = code ? localStorage.getItem('gtc_player_' + code) : null;
let view = null;          // last server state
let joined = false;
let draft = {};           // per-round unsent choice: { roundId, value }
let lastKey = '';         // re-render guard for the round card

const ws = connect({
  onOpen() {
    setConn(true);
    joined = false; // must be confirmed by the server again after every (re)connect
    if (code && playerId) ws.send({ type: 'join', code, playerId });
    else renderJoin();
  },
  onClose() { setConn(false); },
  onMessage(m) {
    if (m.type === 'need-nickname') { playerId = null; renderJoin(m.code); return; }
    if (m.type === 'joined') {
      joined = true; code = m.code; playerId = m.playerId;
      localStorage.setItem('gtc_player_' + code, playerId);
      localStorage.setItem('gtc_last_code', code);
      $('#who').textContent = `${m.nickname} · ${code}`;
      return;
    }
    if (m.type === 'state') { view = m.view; if (!view) return renderGone(); render(); return; }
    if (m.type === 'submitted') { toast('Submitted ✓'); return; }
    if (m.type === 'removed') { localStorage.removeItem('gtc_player_' + code); playerId = null; joined = false; renderJoin(code, 'The instructor removed you from the session. You can rejoin with a nickname.'); return; }
    if (m.type === 'error') {
      if (!joined && !$('#err')) {
        // An automatic rejoin failed (room gone after a server restart, or deleted): show the
        // join form with the reason. The stored identity is kept on purpose: if the instructor
        // restores the session, pressing Join with the same code reattaches the old player.
        renderJoin(code, m.message);
        return;
      }
      showError(m.message);
      return;
    }
  },
});

function setConn(on) {
  $('#conn .dot').className = 'dot' + (on ? ' on' : '');
  const b = $('#offline');
  if (!on && !b) app.prepend(h('div', { id: 'offline', class: 'card warn center' }, 'Connection lost. Reconnecting…'));
  if (on && b) b.remove();
}

function showError(msg) {
  const e = $('#err');
  if (e) { e.textContent = msg; e.classList.remove('hidden'); } else toast(msg, 4000);
}

function renderJoin(prefill = code, note = null) {
  joined = false;
  lastKey = '';
  clear(app);
  const codeInput = h('input', { class: 'input code', maxlength: 4, autocomplete: 'off', autocapitalize: 'characters', placeholder: 'CODE', value: prefill || '' });
  const nick = h('input', { class: 'input', maxlength: 20, autocomplete: 'off', placeholder: 'e.g. Ada', value: localStorage.getItem('gtc_nick') || '' });
  const err = h('div', { id: 'err', class: 'card err hidden' });
  const go = () => {
    const c = codeInput.value.trim().toUpperCase();
    const n = nick.value.trim();
    if (c.length !== 4) return showError('Enter the 4-letter code shown on the projector.');
    if (!n) return showError('Enter a nickname.');
    code = c; localStorage.setItem('gtc_nick', n);
    err.classList.add('hidden');
    ws.send({ type: 'join', code: c, nickname: n, playerId: localStorage.getItem('gtc_player_' + c) || undefined });
  };
  app.append(
    h('div', { class: 'join-page' },
      h('h1', {}, 'Enter the code to join'),
      h('p', { class: 'sub' }, "It's on the screen in front of you"),
      note ? h('div', { class: 'card warn', style: { textAlign: 'left' } }, note) : null,
      h('label', {}, 'Code'), codeInput,
      h('div', { class: 'mt' }), h('label', {}, 'Nickname'), nick,
      h('p', { class: 'small muted', style: { textAlign: 'left', marginTop: '6px' } }, 'No account needed. Pick a name others in the room can recognise.'),
      err,
      h('button', { class: 'btn btn-primary btn-lg mt', onclick: go }, 'Join'),
    ),
  );
  nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  (prefill ? nick : codeInput).focus();
}

function renderGone() {
  clear(app);
  app.append(h('div', { class: 'card warn' }, h('h2', {}, 'Session ended'), h('p', {}, 'This session no longer exists. Scan the QR code again if the instructor started a new one.')));
}

function render() {
  if (!view || !view.nickname) return;
  $('#banner').classList.toggle('hidden', !view.rehearsal);
  $('#who').textContent = `${view.nickname} · ${view.code}`;
  const r = view.round;
  const key = r ? `${r.id}|${r.status}|${r.mine ? r.mine.value + '@' + r.mine.at : ''}|${r.config?.roadOpen}|${r.config?.myGroup?.index}` : 'none';
  if (key !== lastKey) {
    lastKey = key;
    const existing = $('#round');
    const card = renderRound(r);
    if (existing) existing.replaceWith(card); else { clear(app); app.append(card); }
  }
  let hist = $('#history');
  const next = renderHistory();
  if (hist) hist.replaceWith(next); else app.append(next);
}

function renderRound(r) {
  const card = h('div', { id: 'round' });
  if (!r) {
    card.append(h('div', { class: 'join-page' },
      h('h1', {}, `You're in, ${view.nickname}`),
      h('p', { class: 'muted' }, 'Keep this page open. The instructor will start a game shortly.'),
      h('p', { class: 'small muted' }, `${view.playerCount} joined`)));
    return card;
  }
  const title = h('div', { class: 'row between mb' }, h('h2', { style: { margin: 0 } }, `${GAME_NAMES[r.game]} · Round ${r.index}`), statusPill(r.status));
  card.append(title);
  if (r.status === 'waiting') {
    card.append(h('div', { class: 'card accent' }, h('h3', {}, 'Instructions'), pointsList(r.game, { roadOpen: r.config.roadOpen }, 'points compact'), r.game === 'pgg' ? h('div', { class: 'formula' }, PAYOFF_FORMULA) : null, gameExtras(r), h('p', { class: 'muted', style: { marginTop: '12px' } }, 'Voting has not opened yet. Get ready…')));
  } else if (r.status === 'open') {
    card.append(renderForm(r));
  } else if (r.status === 'closed') {
    card.append(h('div', { class: 'card' }, h('h2', {}, 'Voting closed'), mineLine(r), h('p', { class: 'muted' }, 'Waiting for the instructor to reveal the results…')));
  } else if (r.status === 'revealed') {
    card.append(renderResult(r));
  }
  return card;
}

function statusPill(s) {
  const L = { waiting: 'Waiting', open: 'Voting open', closed: 'Closed', revealed: 'Results' };
  return h('span', { class: 'pill ' + s }, L[s]);
}

function gameExtras(r) {
  if (r.game === 'braess') return h('div', { class: 'mt' }, networkSVG({ roadOpen: r.config.roadOpen, compact: true }));
  if (r.game === 'pgg') {
    const g = r.config.myGroup;
    return g
      ? h('p', { class: 'small' }, h('b', {}, `Group ${g.index + 1}`), ` · with ${g.members.filter((n) => n !== view.nickname).join(', ') || 'nobody yet'}`)
      : h('div', { class: 'card warn' }, 'You are not in a group for this round. Ask the instructor to regroup.');
  }
  return null;
}

function mineLine(r) {
  if (!r.mine) return h('p', { class: 'muted' }, 'You did not submit in this round.');
  const v = r.mine.value;
  const text = r.game === 'braess' ? `${ROUTE_META[v].label} (${ROUTE_META[v].path})` : r.game === 'pgg' ? `${v} token${v === 1 ? '' : 's'}` : String(v);
  return h('p', {}, 'Your submission: ', h('b', {}, text));
}

function submitBtn(label, getValue, enabled = () => true) {
  const b = h('button', { class: 'btn btn-primary btn-lg mt' }, label);
  b.addEventListener('click', () => { const v = getValue(); if (v === null || v === undefined) return; ws.send({ type: 'submit', value: v }); });
  b.disabled = !enabled();
  return b;
}

function confirmation(r, describe) {
  if (!r.mine) return h('p', { class: 'small muted mt' }, 'Nothing submitted yet.');
  return h('div', { class: 'card ok mt', style: { marginBottom: 0 } }, h('b', {}, '✓ Submitted: ' + describe(r.mine.value)), h('div', { class: 'small' }, 'You can change your answer until voting closes. Only your latest submission counts.'));
}

function renderForm(r) {
  const box = h('div', { class: 'card' });
  box.append(pointsList(r.game, { roadOpen: r.config.roadOpen }, 'points compact'));
  if (r.game === 'beauty') {
    const start = draft.roundId === r.id ? draft.value : (r.mine ? r.mine.value : '');
    const num = h('input', { class: 'input big-number', type: 'number', inputmode: 'numeric', min: 0, max: 100, step: 1, placeholder: '0–100', value: start });
    const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, value: start === '' ? 50 : start, style: { width: '100%', marginTop: '12px' } });
    num.addEventListener('input', () => { draft = { roundId: r.id, value: num.value }; if (num.value !== '') slider.value = num.value; });
    slider.addEventListener('input', () => { num.value = slider.value; draft = { roundId: r.id, value: num.value }; });
    const get = () => { const v = Number(num.value); if (num.value === '' || !Number.isInteger(v) || v < 0 || v > 100) { showError('Enter a whole number from 0 to 100.'); return null; } return v; };
    box.append(h('label', { class: 'mt' }, 'Your number'), num, slider, h('div', { id: 'err', class: 'card err hidden mt' }), submitBtn(r.mine ? 'Update my number' : 'Submit', get), confirmation(r, (v) => v));
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = get(); if (v !== null) ws.send({ type: 'submit', value: v }); } });
  } else if (r.game === 'braess') {
    let sel = draft.roundId === r.id ? draft.value : (r.mine ? r.mine.value : null);
    const diagramWrap = h('div', { class: 'mt' });
    const list = h('div', { class: 'grid mt' });
    const routes = ['upper', 'lower', ...(r.config.roadOpen ? ['shortcut'] : [])];
    const btn = submitBtn(r.mine ? 'Update my route' : 'Submit route', () => sel, () => !!sel);
    const paint = () => {
      clear(diagramWrap).append(networkSVG({ roadOpen: r.config.roadOpen, route: sel, onPick: (x) => { sel = x; draft = { roundId: r.id, value: x }; paint(); } }));
      clear(list).append(...routes.map((k) => h('button', { class: 'route' + (sel === k ? ' selected' : ''), onclick: () => { sel = k; draft = { roundId: r.id, value: k }; paint(); } },
        h('span', { class: 'sw', style: { background: ROUTE_META[k].color } }),
        h('span', {}, h('div', { class: 't' }, ROUTE_META[k].label), h('div', { class: 'd' }, ROUTE_META[k].path + (k === 'upper' ? '  ·  10·x/N + 11' : k === 'lower' ? '  ·  11 + 10·y/N' : '  ·  10·x/N + 0 + 10·y/N'))))));
      btn.disabled = !sel;
    };
    paint();
    box.append(diagramWrap, list, btn, confirmation(r, (v) => `${ROUTE_META[v].label} (${ROUTE_META[v].path})`));
  } else if (r.game === 'pgg') {
    const g = r.config.myGroup;
    if (!g) { box.append(h('div', { class: 'card warn' }, 'You are not in a group for this round, so you cannot contribute. Ask the instructor to regroup.')); return box; }
    let sel = draft.roundId === r.id ? draft.value : (r.mine ? r.mine.value : null);
    const grid = h('div', { class: 'grid cols-4 mt' });
    const info = h('p', { class: 'small muted mt' });
    const btn = submitBtn(r.mine ? 'Update my contribution' : 'Submit contribution', () => sel, () => sel !== null);
    const paint = () => {
      clear(grid).append(...Array.from({ length: 11 }, (_, v) => h('button', { class: 'choice' + (sel === v ? ' selected' : ''), onclick: () => { sel = v; draft = { roundId: r.id, value: v }; paint(); } }, v)));
      info.textContent = sel === null ? 'Tap the number of tokens to contribute.' : `You keep ${10 - sel} token${10 - sel === 1 ? '' : 's'}; ${sel} go${sel === 1 ? 'es' : ''} into the pot, which is doubled and shared by all ${g.members.length} of you.`;
      btn.disabled = sel === null;
    };
    paint();
    box.append(h('div', { class: 'formula' }, PAYOFF_FORMULA), h('p', { class: 'small mt' }, h('b', {}, `Group ${g.index + 1}`), ` (${g.members.length} people): ${g.members.join(', ')}`), h('label', { class: 'mt' }, 'Tokens to contribute'), grid, info, btn, confirmation(r, (v) => `${v} token${v === 1 ? '' : 's'}`));
  }
  return box;
}

function renderResult(r) {
  const res = r.result;
  const box = h('div', {});
  if (r.game === 'beauty') {
    const mine = res.mine;
    box.append(h('div', { class: 'card' + (mine?.winner ? ' ok' : '') },
      mine?.winner ? h('div', { class: 'big', style: { marginBottom: '12px' } }, 'You won!') : null,
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(res.target)), h('div', { class: 'k' }, 'Target (⅔ of mean)')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(res.mean)), h('div', { class: 'k' }, `Mean of ${res.n}`)),
        mine ? h('div', { class: 'stat' }, h('div', { class: 'v' }, mine.value), h('div', { class: 'k' }, 'Your guess')) : null,
        mine ? h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(mine.distance)), h('div', { class: 'k' }, 'Your distance')) : null,
      ),
      !mine ? h('p', { class: 'muted mt' }, 'You did not submit in this round.') : null,
      h('p', { class: 'mt', style: { marginBottom: 0 } }, res.winners.length ? `Winner${res.winners.length > 1 ? 's' : ''}: ` : 'No submissions.', h('b', {}, res.winners.map((w) => `${w.nickname} (${w.value})`).join(', '))),
    ));
  } else if (r.game === 'braess') {
    const mine = res.mine;
    box.append(h('div', { class: 'card' },
      mine ? h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(mine.time, 1)), h('div', { class: 'k' }, 'Your travel time')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(res.average, 1)), h('div', { class: 'k' }, 'Class average')),
      ) : h('p', { class: 'muted' }, 'You did not choose a route in this round.'),
      mine ? h('p', { class: 'mt' }, 'Your route: ', h('b', {}, `${ROUTE_META[mine.route].label} (${ROUTE_META[mine.route].path})`)) : null,
      mine && Object.keys(mine.alternatives).length ? h('p', { class: 'small muted' }, 'If you alone had switched: ' + Object.entries(mine.alternatives).map(([k, t]) => `${ROUTE_META[k].label} → ${fmt(t, 1)}`).join(' · ')) : null,
      networkSVG({ roadOpen: res.roadOpen, route: mine?.route ?? null, edges: res.edges, N: res.N, compact: true }),
      h('table', { class: 't mt' }, h('tbody', {},
        ['upper', 'lower', ...(res.roadOpen ? ['shortcut'] : [])].map((k) => h('tr', {}, h('td', {}, h('span', { class: 'sw', style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: ROUTE_META[k].color, marginRight: '8px' } }), ROUTE_META[k].label), h('td', { class: 'num' }, `${res.counts[k]} driver${res.counts[k] === 1 ? '' : 's'}`), h('td', { class: 'num' }, fmt(res.times[k], 1)))),
      )),
    ));
  } else if (r.game === 'pgg') {
    const mine = res.mine;
    const scored = mine?.status === 'scored';
    box.append(h('div', { class: 'card' },
      mine && scored ? h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(mine.payoff)), h('div', { class: 'k' }, 'Your payoff')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, mine.contribution), h('div', { class: 'k' }, 'You contributed')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, mine.groupTotal), h('div', { class: 'k' }, 'Group pot')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(mine.share)), h('div', { class: 'k' }, 'Each received')),
      ) : null,
      mine && scored ? h('p', { class: 'mt small muted' }, `Payoff = 10 − ${mine.contribution} + 2 × ${mine.groupTotal} / ${r.config.myGroup?.members.length ?? '?'} = ${fmt(mine.payoff)}`) : null,
      mine && mine.status === 'incomplete' ? h('div', { class: 'card warn', style: { marginBottom: 0 } }, 'Your group was incomplete (someone did not submit), so this round was not scored for your group.') : null,
      mine && mine.status === 'excluded' ? h('div', { class: 'card warn', style: { marginBottom: 0 } }, 'The instructor excluded your group from scoring in this round.') : null,
      !mine ? h('p', { class: 'muted' }, 'You were not part of a scored group in this round.') : null,
      h('p', { class: 'mt small muted', style: { marginBottom: 0 } }, `Class average contribution: ${fmt(res.avgContribution)} · ${res.scoredGroupCount} of ${res.groupCount} groups scored`),
    ));
  }
  return box;
}

function renderHistory() {
  const wrap = h('div', { id: 'history' });
  const past = (view.history || []).filter((x) => !view.round || x.id !== view.round.id);
  if (!past.length) return wrap;
  wrap.append(h('h3', { class: 'mt' }, 'Your previous rounds'));
  wrap.append(h('div', { class: 'card' }, h('ul', { class: 'history' }, past.slice().reverse().map((x) => {
    const m = x.result?.mine;
    let text = '—';
    if (x.game === 'beauty') text = m ? `guess ${m.value}, target ${fmt(x.result.target)}, off by ${fmt(m.distance)}${m.winner ? ' (won)' : ''}` : 'no submission';
    if (x.game === 'braess') text = m ? `${ROUTE_META[m.route].label}, time ${fmt(m.time, 1)} (avg ${fmt(x.result.average, 1)})` : 'no submission';
    if (x.game === 'pgg') text = m ? (m.status === 'scored' ? `gave ${m.contribution}, payoff ${fmt(m.payoff)}` : m.status) : 'no submission';
    return h('li', {}, h('span', {}, h('b', {}, `${GAME_NAMES[x.game]} ${x.index}`), x.game === 'braess' ? h('span', { class: 'small muted' }, x.roadOpen ? ' · road open' : ' · road closed') : null), h('span', { class: 'small' }, text));
  }))));
  return wrap;
}

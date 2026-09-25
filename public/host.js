import { connect, h, $, clear, fmt, toast, GAME_NAMES, STATUS_LABEL, ROUTE_META, networkSVG, histogram, hbars } from './common.js';

const app = $('#app');
let key = localStorage.getItem('gtc_host_key') || '';
let authed = false;
let sessions = [];
let view = null;          // host view of the attached session
let attachedCode = localStorage.getItem('gtc_host_code') || null;
let tab = 'beauty';

const ws = connect({
  onOpen() { setConn(true); if (key) ws.send({ type: 'host:auth', key }); else renderKeyGate(); },
  onClose() { setConn(false); },
  onMessage(m) {
    if (m.type === 'unauthorized') { authed = false; localStorage.removeItem('gtc_host_key'); renderKeyGate('That key is not correct.'); return; }
    if (m.type === 'authorized') { authed = true; sessions = m.sessions; if (attachedCode) ws.send({ type: 'host:attach', key, code: attachedCode }); else renderLobby(); return; }
    if (m.type === 'sessions') { sessions = m.sessions; if (!view) renderLobby(); return; }
    if (m.type === 'session-deleted') { view = null; attachedCode = null; localStorage.removeItem('gtc_host_code'); toast('Session deleted'); ws.send({ type: 'host:list', key }); return; }
    if (m.type === 'state') {
      if (!m.view) { view = null; attachedCode = null; localStorage.removeItem('gtc_host_code'); ws.send({ type: 'host:list', key }); return; }
      view = m.view; attachedCode = view.code; localStorage.setItem('gtc_host_code', view.code);
      try { localStorage.setItem('gtc_backup_' + view.code, JSON.stringify(view.snapshot)); } catch {}
      renderSession();
      return;
    }
    if (m.type === 'error') { toast(m.message, 4000); if (!view && authed && attachedCode) { attachedCode = null; localStorage.removeItem('gtc_host_code'); renderLobby(); } return; }
  },
});

const cmd = (action, extra = {}) => ws.send({ type: 'host:' + action, key, ...extra });

// Inline two-step confirmation (no native dialogs: they are blocked in some kiosk browsers).
// The pending id survives the full re-renders triggered by incoming submissions.
let pendingConfirm = null;
function confirmBtn(id, label, question, onYes, cls = 'btn btn-primary btn-lg') {
  if (pendingConfirm === id) {
    return h('span', { class: 'card warn', style: { display: 'inline-flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', margin: 0, padding: '10px 14px' } },
      h('span', { style: { fontWeight: 700 } }, question),
      h('button', { class: 'btn btn-sm btn-primary', onclick: () => { pendingConfirm = null; onYes(); } }, 'Yes'),
      h('button', { class: 'btn btn-sm', onclick: () => { pendingConfirm = null; view ? renderSession() : renderLobby(); } }, 'No'));
  }
  return h('button', { class: cls, onclick: () => { pendingConfirm = id; view ? renderSession() : renderLobby(); } }, label);
}

function setConn(on) { $('#conn .dot').className = 'dot' + (on ? ' on' : ''); }

function renderKeyGate(msg) {
  clear(app);
  const inp = h('input', { class: 'input', type: 'password', placeholder: 'Instructor key', autocomplete: 'current-password' });
  const go = () => { key = inp.value.trim(); if (!key) return; localStorage.setItem('gtc_host_key', key); ws.send({ type: 'host:auth', key }); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  app.append(h('div', { class: 'card', style: { maxWidth: '480px', margin: '40px auto' } },
    h('h1', {}, 'Instructor sign-in'),
    h('p', { class: 'muted' }, 'Enter the private instructor key (HOST_KEY). It is never shown to students.'),
    msg ? h('div', { class: 'card err' }, msg) : null,
    inp, h('button', { class: 'btn btn-primary btn-lg mt', onclick: go }, 'Continue')));
  inp.focus();
}

function renderLobby() {
  view = null;
  $('#banner').classList.add('hidden');
  $('#crumb').textContent = '';
  clear(app);
  const name = h('input', { class: 'input', placeholder: 'e.g. GTC tutorial, 26 Sep', maxlength: 60 });
  const reh = h('input', { type: 'checkbox', style: { width: '22px', height: '22px' } });
  const create = h('div', { class: 'card' },
    h('h2', {}, 'New session'),
    h('label', {}, 'Name (optional)'), name,
    h('label', { class: 'mt', style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '17px', color: 'var(--text)' } }, reh, 'Rehearsal session (test run; kept separate from real sessions)'),
    h('button', { class: 'btn btn-primary btn-lg mt', onclick: () => cmd('create', { name: name.value, rehearsal: reh.checked }) }, 'Create session'));
  const list = (items, title) => h('div', { class: 'card' }, h('h2', {}, title), items.length ? h('table', { class: 't' }, h('tbody', {}, items.map((s) => h('tr', {},
    h('td', {}, h('b', { style: { letterSpacing: '0.15em' } }, s.code)),
    h('td', {}, s.name || h('span', { class: 'muted' }, '(no name)')),
    h('td', { class: 'num' }, `${s.players} players`),
    h('td', { class: 'num' }, `${s.rounds} rounds`),
    h('td', { class: 'small muted' }, new Date(s.createdAt).toLocaleString()),
    h('td', { class: 'num' }, h('button', { class: 'btn btn-sm btn-primary', onclick: () => cmd('attach', { code: s.code }) }, 'Open'), ' ',
      confirmBtn('delete:' + s.code, 'Delete', `Delete ${s.code} and all its results?`, () => cmd('delete', { code: s.code }), 'btn btn-sm btn-danger')),
  )))) : h('p', { class: 'muted' }, 'None yet.'));
  const backups = Object.keys(localStorage).filter((k) => k.startsWith('gtc_backup_')).map((k) => k.slice(11)).filter((c) => !sessions.some((s) => s.code === c));
  app.append(h('div', {},
    h('h1', {}, 'Sessions'),
    create,
    list(sessions.filter((s) => !s.rehearsal), 'Real sessions'),
    list(sessions.filter((s) => s.rehearsal), 'Rehearsal sessions'),
    backups.length ? h('div', { class: 'card warn' }, h('h2', {}, 'Backups in this browser'),
      h('p', { class: 'small' }, 'These sessions are no longer on the server (for example after a server restart). Restoring puts them back exactly as this browser last saw them; students reconnect automatically.'),
      backups.map((c) => h('div', { class: 'row', style: { marginBottom: '8px' } }, h('b', {}, c), h('button', { class: 'btn btn-sm btn-primary', onclick: () => { try { cmd('restore', { session: JSON.parse(localStorage.getItem('gtc_backup_' + c)) }); } catch { toast('Backup unreadable'); } } }, 'Restore'), h('button', { class: 'btn btn-sm', onclick: () => { localStorage.removeItem('gtc_backup_' + c); renderLobby(); } }, 'Forget')))) : null,
    h('p', { class: 'small muted' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); localStorage.removeItem('gtc_host_key'); key = ''; renderKeyGate(); } }, 'Sign out')),
  ));
}

// ------------------------------------------------------------- session view
function renderSession() {
  const v = view;
  $('#banner').classList.toggle('hidden', !v.rehearsal);
  $('#crumb').textContent = `${v.code}${v.name ? ' · ' + v.name : ''}`;
  clear(app);
  const joinUrl = `${location.origin}/j/${v.code}`;
  app.append(
    h('div', { class: 'row between mb' },
      h('div', { class: 'row' }, h('button', { class: 'btn btn-sm', onclick: () => { attachedCode = null; localStorage.removeItem('gtc_host_code'); view = null; cmd('detach'); } }, '← All sessions'),
        h('span', { class: 'big', style: { letterSpacing: '0.15em' } }, v.code), v.rehearsal ? h('span', { class: 'pill rehearsal' }, 'Rehearsal') : null),
      h('div', { class: 'row' },
        h('a', { class: 'btn btn-sm', href: `/screen/${v.code}`, target: '_blank' }, 'Open projector view'),
        h('a', { class: 'btn btn-sm', href: `/api/export/${v.code}.csv?key=${encodeURIComponent(key)}` }, 'Export CSV'))),
    h('div', { class: 'card soft small' }, 'Students join at ', h('b', {}, joinUrl), ' or enter code ', h('b', {}, v.code), ' at ', h('b', {}, location.origin), '. The projector view shows the QR code.'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: '16px' }, class: 'session-grid' },
      h('div', {}, renderGameTabs(), renderRoundPanel(), renderRoundHistory()),
      h('div', {}, renderPlayers())),
  );
  if (window.innerWidth < 800) $('.session-grid').style.gridTemplateColumns = '1fr';
}

function renderGameTabs() {
  const v = view;
  const cur = v.round;
  const locked = cur && (cur.status === 'open' || cur.status === 'closed');
  tab = locked ? cur.game : v.game; // the server remembers the selected game; a running round pins it
  const tabs = h('div', { class: 'row mb' }, Object.entries(GAME_NAMES).map(([k, name]) => h('button', { class: 'btn btn-sm' + (tab === k ? ' selected' : ''), disabled: locked && k !== cur.game, onclick: () => cmd('selectGame', { game: k }) }, name)));
  const box = h('div', { class: 'card' }, h('h3', {}, 'Game'), tabs);
  if (tab === 'braess') {
    const open = v.braess.roadOpen;
    box.append(h('div', { class: 'row between' },
      h('div', {}, h('b', {}, `New road A → B: ${open ? 'OPEN' : 'CLOSED'}`), h('div', { class: 'small muted' }, 'Applies to the next round (and to a round still in Waiting).')),
      h('button', { class: 'btn ' + (open ? 'btn-danger' : 'btn-primary'), disabled: locked, onclick: () => cmd('setRoad', { open: !open }) }, open ? 'Close the road' : 'Open the new road')));
    box.append(h('div', { class: 'row between mt' },
      h('div', {}, h('b', {}, `Theory panel on projector: ${v.braess.theoryRevealed ? 'SHOWN' : 'hidden'}`), h('div', { class: 'small muted' }, 'Equal split 16 · all on shortcut 20 · lone deviator 21. Reveal after the game so it does not spoil it.')),
      h('button', { class: 'btn btn-sm', onclick: () => cmd('revealTheory', { shown: !v.braess.theoryRevealed }) }, v.braess.theoryRevealed ? 'Hide theory' : 'Show theory')));
  }
  if (tab === 'pgg') {
    const g = v.pgg.groupNames;
    const n = v.players.length;
    box.append(h('div', { class: 'row between' },
      h('div', {}, h('b', {}, g ? `${g.length} groups (sizes ${g.map((x) => x.length).join(', ')})` : 'No groups yet'), h('div', { class: 'small muted' }, `Groups of 4 by default; leftovers form groups of 3 to 5. ${n} players joined, need at least ${v.pgg.minPlayers}. Groups persist across rounds.`)),
      g ? (locked ? h('button', { class: 'btn', disabled: true }, 'Regroup') : confirmBtn('regroup', 'Regroup', 'Shuffle everyone into new groups?', () => cmd('makeGroups', { size: 4 }), 'btn'))
        : h('button', { class: 'btn btn-primary', disabled: locked || n < v.pgg.minPlayers, onclick: () => cmd('makeGroups', { size: 4 }) }, 'Make groups')));
    if (g) box.append(h('div', { class: 'grid cols-2 mt', style: { gap: '8px' } }, g.map((members, i) => h('div', { class: 'card soft small', style: { margin: 0, padding: '10px 14px' } }, h('b', {}, `Group ${i + 1}`), ' · ', members.join(', ')))));
    const ungrouped = v.players.filter((p) => !(v.pgg.groups || []).flat().includes(p.id));
    if (g && ungrouped.length) box.append(h('div', { class: 'card warn small mt', style: { marginBottom: 0 } }, `Not in any group (joined after grouping): ${ungrouped.map((p) => p.nickname).join(', ')}. Regroup between rounds to include them.`));
  }
  return box;
}

function renderRoundPanel() {
  const v = view;
  const r = v.round;
  const box = h('div', { class: 'card accent' });
  if (!r) {
    const canStart = tab !== 'pgg' || !!v.pgg.groups;
    box.append(h('h3', {}, 'Round'), h('p', { class: 'muted' }, 'No round running. Students see a waiting screen.'),
      h('button', { class: 'btn btn-primary btn-lg', disabled: !canStart, onclick: () => cmd('startRound', { game: tab }) }, `Start ${GAME_NAMES[tab]} round ${v.rounds.filter((x) => x.game === tab).length + 1}`));
    if (!canStart) box.append(h('p', { class: 'small muted mt' }, 'Make groups first.'));
    return box;
  }
  const p = r.progress;
  box.append(h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, `${GAME_NAMES[r.game]} · Round ${r.index}`), h('span', { class: 'pill ' + r.status }, STATUS_LABEL[r.status])));
  if (r.game === 'braess') box.append(h('p', { class: 'small muted' }, `Road A → B ${r.config.roadOpen ? 'open' : 'closed'} in this round.`));
  // progress
  box.append(h('div', { class: 'mt' }, h('div', { class: 'row between' }, h('b', {}, `${p.submitted} / ${p.expected} submitted`), h('span', { class: 'muted small' }, `${v.connectedCount} online`)),
    h('div', { class: 'progress mt', style: { marginTop: '6px' } }, h('div', { style: { width: `${p.expected ? (p.submitted / p.expected) * 100 : 0}%` } }))));
  if (p.missing && (r.status === 'open' || r.status === 'closed')) box.append(h('p', { class: 'small muted mt' }, `Missing (${p.missing}): ${p.missingNames.join(', ')}`));
  // actions
  const actions = h('div', { class: 'row mt' });
  if (r.status === 'waiting') actions.append(h('button', { class: 'btn btn-primary btn-lg', onclick: () => cmd('open') }, 'Open voting'), h('button', { class: 'btn', onclick: () => cmd('cancel') }, 'Cancel round'));
  if (r.status === 'open') actions.append(
    p.missing === 0
      ? h('button', { class: 'btn btn-primary btn-lg', onclick: () => cmd('close') }, 'Close voting')
      : confirmBtn('close', `Close voting (${p.missing} missing)`, `${p.missing} of ${p.expected} have not submitted. Close anyway? Missing answers stay missing (never invented).`, () => cmd('close')),
    confirmBtn('cancel', 'Cancel round', 'Discard this round and its submissions?', () => cmd('cancel'), 'btn'));
  if (r.status === 'closed') actions.append(h('button', { class: 'btn btn-primary btn-lg', onclick: () => cmd('reveal') }, 'Reveal results'), h('button', { class: 'btn', onclick: () => cmd('reopen') }, 'Reopen voting'));
  if (r.status === 'revealed') {
    const canStart = tab !== 'pgg' || !!v.pgg.groups;
    actions.append(h('button', { class: 'btn btn-primary btn-lg', disabled: !canStart, onclick: () => cmd('startRound', { game: tab }) }, `Start ${GAME_NAMES[tab]} round ${v.rounds.filter((x) => x.game === tab).length + 1}`));
    if (!canStart) actions.append(h('span', { class: 'small muted' }, 'Make groups first.'));
  }
  box.append(actions);
  if (r.results && (r.status === 'closed' || r.status === 'revealed')) box.append(h('h3', { class: 'mt' }, r.status === 'closed' ? 'Preview (only you can see this until you reveal)' : 'Results'), renderResults(r));
  return box;
}

function renderResults(r) {
  const res = r.results;
  const wrap = h('div', {});
  if (r.game === 'beauty') {
    if (!res.n) return h('p', { class: 'muted' }, 'No submissions in this round.');
    wrap.append(h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(res.mean)), h('div', { class: 'k' }, 'Mean')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(res.target)), h('div', { class: 'k' }, 'Target ⅔·mean')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, res.n), h('div', { class: 'k' }, 'Submissions'))),
      h('p', { class: 'mt' }, h('b', {}, `Winner${res.winners.length > 1 ? 's' : ''}: `), res.winners.map((w) => `${w.nickname} (${w.value})`).join(', ')),
      beautyHistogram(res));
  } else if (r.game === 'braess') {
    if (!res.N) return h('p', { class: 'muted' }, 'No submissions in this round.');
    wrap.append(h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(res.average, 2)), h('div', { class: 'k' }, 'Average travel time')), h('div', { class: 'stat' }, h('div', { class: 'v' }, res.N), h('div', { class: 'k' }, 'Drivers'))),
      braessTable(res));
  } else if (r.game === 'pgg') {
    wrap.append(h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(res.avgContribution)), h('div', { class: 'k' }, 'Avg contribution')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(res.avgPayoff)), h('div', { class: 'k' }, 'Avg payoff')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, `${res.scoredGroupCount}/${res.groups.length}`), h('div', { class: 'k' }, 'Groups scored'))));
    wrap.append(h('table', { class: 't mt' }, h('thead', {}, h('tr', {}, h('th', {}, 'Group'), h('th', { class: 'num' }, 'Submitted'), h('th', { class: 'num' }, 'Pot'), h('th', { class: 'num' }, 'Each gets'), h('th', {}, 'Status'), h('th', {}))),
      h('tbody', {}, res.groups.map((g) => h('tr', {},
        h('td', {}, h('b', {}, `Group ${g.index + 1}`), h('div', { class: 'small muted' }, r.config.groupNames[g.index].join(', '))),
        h('td', { class: 'num' }, `${g.submitted}/${g.size}`),
        h('td', { class: 'num' }, g.scored ? g.total : '–'),
        h('td', { class: 'num' }, g.scored ? fmt(g.share) : '–'),
        h('td', {}, g.excluded ? h('span', { class: 'pill closed' }, 'excluded') : g.complete ? h('span', { class: 'pill revealed' }, 'scored') : h('span', { class: 'pill bad' }, `missing: ${g.missingNames.join(', ')}`)),
        h('td', { class: 'num' }, !g.complete || g.excluded ? h('button', { class: 'btn btn-sm', onclick: () => cmd('excludeGroup', { roundId: r.id, group: g.index, excluded: !g.excluded }) }, g.excluded ? 'Include again' : 'Exclude from scoring') : null),
      )))));
    if (res.incompleteGroups.length && r.status === 'closed') wrap.append(h('div', { class: 'card warn small mt' }, `${res.incompleteGroups.length} group(s) incomplete. Either reopen voting and wait, or exclude them; their members are not scored either way. Missing contributions are never counted as zero.`));
  }
  return wrap;
}

export function beautyHistogram(res) {
  const bins = res.histogram.map((b) => ({ label: `${b.from}–${b.to === 100 ? 100 : b.to - 1}`, count: b.count }));
  return h('div', { class: 'mt' }, histogram({ bins, axis: ['0', '25', '50', '75', '100'], markers: [{ pos: res.mean / 100, label: `mean ${fmt(res.mean, 1)}`, color: 'var(--yellow)' }, { pos: res.target / 100, label: `target ${fmt(res.target, 1)}`, color: 'var(--coral)' }] }));
}

export function braessTable(res) {
  const routes = ['upper', 'lower', ...(res.roadOpen ? ['shortcut'] : [])];
  return h('div', { class: 'mt' },
    hbars(routes.map((k) => ({ label: `${ROUTE_META[k].label}`, value: res.counts[k], display: `${res.counts[k]}  ·  ${fmt(res.times[k], 1)}`, color: ROUTE_META[k].color }))),
    h('p', { class: 'small muted' }, 'drivers · travel time per route'),
    h('table', { class: 't mt' }, h('thead', {}, h('tr', {}, h('th', {}, 'Edge'), h('th', { class: 'num' }, 'Drivers'), h('th', { class: 'num' }, 'Travel time'))), h('tbody', {},
      [['S → A', 'SA', `10 × ${res.edges.SA.load} / ${res.N}`], ['A → T', 'AT', '11'], ['S → B', 'SB', '11'], ['B → T', 'BT', `10 × ${res.edges.BT.load} / ${res.N}`], ...(res.roadOpen ? [['A → B', 'AB', '0']] : [])].map(([n, k, f]) =>
        h('tr', {}, h('td', {}, n, ' ', h('span', { class: 'small muted' }, f)), h('td', { class: 'num' }, res.edges[k].load), h('td', { class: 'num' }, fmt(res.edges[k].time, 2)))))));
}

function renderRoundHistory() {
  const v = view;
  const past = v.rounds.filter((r) => r.status === 'revealed');
  if (!past.length) return null;
  return h('div', { class: 'card' }, h('h3', {}, 'Round history'), h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Round'), h('th', { class: 'num' }, 'Submitted'), h('th', {}, 'Key numbers'))), h('tbody', {}, past.map((r) => {
    const res = r.result;
    let key = '';
    if (r.game === 'beauty') key = res.n ? `mean ${fmt(res.mean)}, target ${fmt(res.target)}, winner${res.winners.length > 1 ? 's' : ''} ${res.winners.map((w) => `${w.nickname} (${w.value})`).join(', ')}` : 'no submissions';
    if (r.game === 'braess') key = res.N ? `road ${r.roadOpen ? 'open' : 'closed'} · avg time ${fmt(res.average, 2)} · upper ${res.counts.upper}, lower ${res.counts.lower}${r.roadOpen ? `, shortcut ${res.counts.shortcut}` : ''}` : 'no submissions';
    if (r.game === 'pgg') key = `avg contribution ${fmt(res.avgContribution)} · avg payoff ${fmt(res.avgPayoff)} · ${res.scoredGroupCount}/${res.groupCount} groups scored`;
    return h('tr', {}, h('td', {}, h('b', {}, `${GAME_NAMES[r.game]} ${r.index}`)), h('td', { class: 'num' }, `${r.submitted}/${r.expected}`), h('td', { class: 'small' }, key));
  }))));
}

function renderPlayers() {
  const v = view;
  const r = v.round;
  return h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, `Players · ${v.players.length}`), h('span', { class: 'pill' }, `${v.connectedCount} online`)),
    v.players.length ? h('table', { class: 't mt' }, h('tbody', {}, v.players.map((p) => h('tr', {},
      h('td', {}, p.nickname, p.connected ? null : h('span', { class: 'small muted' }, ' (offline)')),
      h('td', { class: 'num small muted' }, r && r.status !== 'waiting' && r.submissions[p.id] ? 'submitted' : ''),
      h('td', { class: 'num' }, confirmBtn('remove:' + p.id, 'Remove', `Remove ${p.nickname}?`, () => cmd('removePlayer', { playerId: p.id }), 'btn btn-sm')),
    )))) : h('p', { class: 'muted mt' }, 'Nobody has joined yet. Show the projector view so students can scan the QR code.'));
}

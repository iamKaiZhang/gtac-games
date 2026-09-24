// Session state machine. Pure functions over a plain serialisable session object.
// The server owns persistence and sockets; this module owns the rules.
import { randomUUID } from 'node:crypto';
import * as beauty from './games/beauty.js';
import * as braess from './games/braess.js';
import * as pgg from './games/pgg.js';

export const GAMES = { beauty, braess, pgg };
export const GAME_NAMES = { beauty: 'Beauty contest', braess: "Braess's paradox", pgg: 'Public goods' };
export const STATUSES = ['waiting', 'open', 'closed', 'revealed'];

export class SessionError extends Error {}
const fail = (msg) => { throw new SessionError(msg); };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function randomCode(len = 4) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export function createSession({ code, name = '', rehearsal = false }) {
  const now = Date.now();
  return {
    code,
    name: String(name || '').slice(0, 60),
    rehearsal: !!rehearsal,
    createdAt: now,
    updatedAt: now,
    players: {},
    game: 'beauty',
    braess: { roadOpen: false, theoryRevealed: false },
    pgg: { groups: null },
    rounds: [],
    currentRoundId: null,
  };
}

export function normalizeNickname(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

export function joinPlayer(session, { playerId, nickname }) {
  if (playerId && session.players[playerId]) {
    const p = session.players[playerId];
    p.lastSeen = Date.now();
    return { player: p, created: false };
  }
  const nick = normalizeNickname(nickname);
  if (nick.length < 1) fail('Please enter a nickname.');
  const taken = Object.values(session.players).some((p) => p.nickname.toLowerCase() === nick.toLowerCase());
  if (taken) fail(`The nickname "${nick}" is already taken in this session. Pick another one.`);
  const id = randomUUID();
  const player = { id, nickname: nick, joinedAt: Date.now(), lastSeen: Date.now() };
  session.players[id] = player;
  touch(session);
  return { player, created: true };
}

export function removePlayer(session, playerId) {
  if (!session.players[playerId]) fail('Unknown player.');
  delete session.players[playerId];
  if (session.pgg.groups) {
    session.pgg.groups = session.pgg.groups.map((g) => g.filter((p) => p !== playerId)).filter((g) => g.length > 0);
  }
  const r = currentRound(session);
  if (r && r.game === 'pgg' && r.status === 'waiting') r.config.groups = session.pgg.groups;
  touch(session);
}

export function currentRound(session) {
  return session.rounds.find((r) => r.id === session.currentRoundId) || null;
}

export function startRound(session, game) {
  if (!GAMES[game]) fail('Unknown game.');
  const cur = currentRound(session);
  if (cur && (cur.status === 'open' || cur.status === 'closed')) fail('Reveal or cancel the current round first.');
  if (cur && cur.status === 'waiting') session.rounds = session.rounds.filter((r) => r.id !== cur.id);
  if (game === 'pgg') {
    if (!session.pgg.groups) fail('Make groups before starting a public-goods round.');
    if (Object.keys(session.players).length < pgg.MIN_PLAYERS) fail(`Public goods needs at least ${pgg.MIN_PLAYERS} players.`);
  }
  const index = session.rounds.filter((r) => r.game === game).length + 1;
  const round = {
    id: randomUUID(),
    game,
    index,
    status: 'waiting',
    createdAt: Date.now(),
    openedAt: null,
    closedAt: null,
    revealedAt: null,
    config: roundConfig(session, game),
    submissions: {},
    results: null,
  };
  session.rounds.push(round);
  session.currentRoundId = round.id;
  session.game = game;
  touch(session);
  return round;
}

function roundConfig(session, game) {
  if (game === 'braess') return { roadOpen: session.braess.roadOpen };
  if (game === 'pgg') return { groups: session.pgg.groups.map((g) => [...g]), excludedGroups: [] };
  return {};
}

export function cancelRound(session) {
  const cur = currentRound(session);
  if (!cur) fail('No round to cancel.');
  if (cur.status === 'revealed') fail('A revealed round cannot be cancelled.');
  session.rounds = session.rounds.filter((r) => r.id !== cur.id);
  session.currentRoundId = null;
  touch(session);
}

export function openRound(session) {
  const cur = currentRound(session) || fail('Start a round first.');
  if (cur.status !== 'waiting') fail('Voting can only be opened from the waiting state.');
  cur.status = 'open';
  cur.openedAt = Date.now();
  touch(session);
}

export function closeRound(session) {
  const cur = currentRound(session) || fail('No round.');
  if (cur.status !== 'open') fail('Voting is not open.');
  cur.status = 'closed';
  cur.closedAt = Date.now();
  cur.results = computeResults(cur);
  touch(session);
}

export function reopenRound(session) {
  const cur = currentRound(session) || fail('No round.');
  if (cur.status !== 'closed') fail('Only a closed round can be reopened.');
  cur.status = 'open';
  cur.closedAt = null;
  cur.results = null;
  touch(session);
}

export function revealRound(session) {
  const cur = currentRound(session) || fail('No round.');
  if (cur.status !== 'closed') fail('Close voting before revealing results.');
  cur.status = 'revealed';
  cur.revealedAt = Date.now();
  cur.results = computeResults(cur);
  touch(session);
}

export function computeResults(round) {
  const entries = Object.entries(round.submissions).map(([playerId, s]) => ({ playerId, value: s.value }));
  return GAMES[round.game].compute(entries, round.config);
}

export function submit(session, playerId, value) {
  const player = session.players[playerId] || fail('You are not part of this session. Please rejoin.');
  const cur = currentRound(session) || fail('No round is running.');
  if (cur.status !== 'open') fail('Voting is not open right now.');
  if (cur.game === 'pgg' && !cur.config.groups.some((g) => g.includes(playerId))) fail('You are not in a group for this round. Ask the instructor to regroup.');
  const err = GAMES[cur.game].validate(value, cur.config);
  if (err) fail(err);
  cur.submissions[playerId] = { value, at: Date.now() };
  player.lastSeen = Date.now();
  touch(session);
  return cur;
}

export function setRoad(session, open) {
  const cur = currentRound(session);
  if (cur && cur.game === 'braess' && (cur.status === 'open' || cur.status === 'closed')) fail('Reveal the current round before changing the road.');
  session.braess.roadOpen = !!open;
  if (cur && cur.game === 'braess' && cur.status === 'waiting') cur.config.roadOpen = !!open;
  touch(session);
}

export function setTheoryRevealed(session, shown) {
  session.braess.theoryRevealed = !!shown;
  touch(session);
}

export function makeGroups(session, size = 4, shuffle = defaultShuffle) {
  const cur = currentRound(session);
  if (cur && cur.game === 'pgg' && (cur.status === 'open' || cur.status === 'closed')) fail('Reveal the current round before regrouping.');
  const ids = shuffle(Object.keys(session.players));
  const groups = pgg.makeGroups(ids, size); // throws below MIN_PLAYERS
  session.pgg.groups = groups;
  if (cur && cur.game === 'pgg' && cur.status === 'waiting') cur.config = { groups: groups.map((g) => [...g]), excludedGroups: [] };
  touch(session);
  return groups;
}

export function setGroupExcluded(session, roundId, groupIndex, excluded) {
  const round = session.rounds.find((r) => r.id === roundId) || fail('Unknown round.');
  if (round.game !== 'pgg') fail('Not a public-goods round.');
  const set = new Set(round.config.excludedGroups || []);
  if (excluded) set.add(groupIndex); else set.delete(groupIndex);
  round.config.excludedGroups = [...set].sort((a, b) => a - b);
  if (round.status === 'closed' || round.status === 'revealed') round.results = computeResults(round);
  touch(session);
}

export function setSelectedGame(session, game) {
  if (!GAMES[game]) fail('Unknown game.');
  session.game = game;
  touch(session);
}

function defaultShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function touch(session) { session.updatedAt = Date.now(); }

// ---------- expected / missing submissions ----------

export function expectedPlayers(session, round) {
  if (round.game === 'pgg') return round.config.groups.flat().filter((p) => session.players[p]);
  return Object.keys(session.players);
}

export function progress(session, round) {
  const expected = expectedPlayers(session, round);
  const submitted = expected.filter((p) => round.submissions[p]);
  const missing = expected.filter((p) => !round.submissions[p]);
  return { expected: expected.length, submitted: submitted.length, missing: missing.length, missingIds: missing };
}

// ---------- views: what each role may see ----------
// Hidden-until-reveal is enforced here: student and screen views never carry
// submissions, aggregates or payoffs unless round.status === 'revealed'.

const nick = (session, id) => session.players[id]?.nickname ?? '(left)';

function publicResult(session, round) {
  const r = round.results;
  if (!r) return null;
  if (round.game === 'beauty') {
    return { n: r.n, mean: r.mean, target: r.target, histogram: r.histogram, winners: r.winners.map((w) => ({ nickname: nick(session, w.playerId), value: w.value })) };
  }
  if (round.game === 'braess') {
    return { N: r.N, roadOpen: r.roadOpen, counts: r.counts, times: r.times, edges: r.edges, average: r.average };
  }
  if (round.game === 'pgg') {
    return {
      nScored: r.nScored,
      groupCount: r.groups.length,
      scoredGroupCount: r.scoredGroupCount,
      incompleteGroupCount: r.incompleteGroups.length,
      excludedGroupCount: r.groups.filter((g) => g.excluded).length,
      avgContribution: r.avgContribution,
      avgPayoff: r.avgPayoff,
      histogram: r.histogram,
    };
  }
  return null;
}

function publicConfig(session, round, playerId) {
  if (round.game === 'braess') return { roadOpen: round.config.roadOpen };
  if (round.game === 'pgg') {
    const cfg = { groupCount: round.config.groups.length, sizes: round.config.groups.map((g) => g.length) };
    if (playerId) {
      const gi = round.config.groups.findIndex((g) => g.includes(playerId));
      cfg.myGroup = gi >= 0 ? { index: gi, members: round.config.groups[gi].map((p) => nick(session, p)) } : null;
    }
    return cfg;
  }
  return {};
}

function roundSummary(session, round) {
  const p = progress(session, round);
  return {
    id: round.id, game: round.game, index: round.index, status: round.status,
    openedAt: round.openedAt, closedAt: round.closedAt, revealedAt: round.revealedAt,
    submitted: p.submitted, expected: p.expected, missing: p.missing,
  };
}

export function studentView(session, playerId) {
  const player = session.players[playerId];
  const cur = currentRound(session);
  const view = {
    role: 'student',
    code: session.code, name: session.name, rehearsal: session.rehearsal,
    playerId, nickname: player?.nickname ?? null,
    playerCount: Object.keys(session.players).length,
    round: null,
    history: [],
    braess: { roadOpen: session.braess.roadOpen },
  };
  if (!player) return view;
  if (cur) {
    view.round = {
      ...roundSummary(session, cur),
      config: publicConfig(session, cur, playerId),
      mine: cur.submissions[playerId] ?? null,
      result: cur.status === 'revealed' ? { ...publicResult(session, cur), mine: cur.results.perPlayer[playerId] ?? null } : null,
    };
  }
  view.history = session.rounds
    .filter((r) => r.status === 'revealed')
    .map((r) => ({ id: r.id, game: r.game, index: r.index, roadOpen: r.config.roadOpen ?? null, mine: r.submissions[playerId]?.value ?? null, result: { ...publicResult(session, r), mine: r.results.perPlayer[playerId] ?? null } }));
  return view;
}

export function screenView(session, connectedCount = 0) {
  const cur = currentRound(session);
  const lastBraess = [...session.rounds].reverse().find((r) => r.game === 'braess' && r.status === 'revealed');
  const N = lastBraess ? lastBraess.results.N : Object.keys(session.players).length;
  return {
    role: 'screen',
    code: session.code, name: session.name, rehearsal: session.rehearsal,
    playerCount: Object.keys(session.players).length,
    connectedCount,
    game: session.game,
    round: cur ? { ...roundSummary(session, cur), config: publicConfig(session, cur, null), result: cur.status === 'revealed' ? publicResult(session, cur) : null } : null,
    history: session.rounds.filter((r) => r.status === 'revealed').map((r) => ({ id: r.id, game: r.game, index: r.index, roadOpen: r.config.roadOpen ?? null, result: publicResult(session, r) })),
    braess: { roadOpen: session.braess.roadOpen, theoryRevealed: session.braess.theoryRevealed, theory: session.braess.theoryRevealed ? braess.theory(N) : null },
    pgg: { groupCount: session.pgg.groups ? session.pgg.groups.length : 0 },
  };
}

export function hostView(session, connectedIds = new Set()) {
  const cur = currentRound(session);
  const players = Object.values(session.players)
    .map((p) => ({ ...p, connected: connectedIds.has(p.id) }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const withNames = (round) => {
    const p = progress(session, round);
    return {
      ...round,
      progress: { ...p, missingNames: p.missingIds.map((id) => nick(session, id)) },
      submissionsByName: Object.fromEntries(Object.entries(round.submissions).map(([id, s]) => [nick(session, id), s.value])),
      results: round.results ? withResultNames(session, round) : null,
      config: round.game === 'pgg' ? { ...round.config, groupNames: round.config.groups.map((g) => g.map((id) => nick(session, id))) } : round.config,
    };
  };
  return {
    role: 'host',
    code: session.code, name: session.name, rehearsal: session.rehearsal, createdAt: session.createdAt,
    game: session.game,
    players,
    connectedCount: players.filter((p) => p.connected).length,
    braess: { ...session.braess, theory: braess.theory(cur?.game === 'braess' && cur.results ? cur.results.N : players.length) },
    pgg: { groups: session.pgg.groups, groupNames: session.pgg.groups ? session.pgg.groups.map((g) => g.map((id) => nick(session, id))) : null, minPlayers: pgg.MIN_PLAYERS },
    round: cur ? withNames(cur) : null,
    rounds: session.rounds.map((r) => ({ ...roundSummary(session, r), roadOpen: r.config.roadOpen ?? null, result: r.results ? publicResult(session, r) : null })),
    snapshot: session, // full state, host-only, used by the instructor browser as a backup
  };
}

function withResultNames(session, round) {
  const r = round.results;
  const named = { ...r };
  if (round.game === 'beauty') named.winners = r.winners.map((w) => ({ ...w, nickname: nick(session, w.playerId) }));
  if (round.game === 'pgg') named.groups = r.groups.map((g) => ({ ...g, missingNames: g.missing.map((id) => nick(session, id)) }));
  named.perPlayerByName = Object.fromEntries(Object.entries(r.perPlayer).map(([id, v]) => [nick(session, id), v]));
  return named;
}

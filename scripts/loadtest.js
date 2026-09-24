// End-to-end concurrency test over real WebSockets.
//   node scripts/loadtest.js --url http://localhost:3000 --key dev --n 100          # full automated run in a fresh rehearsal session
//   node scripts/loadtest.js --url http://localhost:3000 --code ABCD --n 40 --join-only   # add bots to an existing session and keep them connected
import WebSocket from 'ws';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));
const URL_ = (args.url || 'http://localhost:3000').replace(/^http/, 'ws') + '/ws';
const N = Number(args.n || 100);
const KEY = args.key || process.env.HOST_KEY || 'dev';
const assert = (c, m) => { if (!c) { console.error('ASSERTION FAILED:', m); process.exit(1); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) { this.name = name; this.state = null; this.playerId = null; this.msgs = []; this.cursor = 0; this.waiters = []; }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL_);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'state') this.state = m.view;
        if (m.type === 'joined') this.playerId = m.playerId;
        this.msgs.push(m);
        this.waiters = this.waiters.filter((w) => !w());
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  // Resolves with the first not-yet-consumed message matching pred (messages are consumed in order).
  wait(pred, ms = 8000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.name}: timeout waiting`)), ms);
      const scan = () => {
        for (let i = this.cursor; i < this.msgs.length; i++) {
          if (pred(this.msgs[i])) { this.cursor = i + 1; clearTimeout(t); resolve(this.msgs[i]); return true; }
        }
        return false;
      };
      if (!scan()) this.waiters.push(scan);
    });
  }
  close() { this.ws.close(); }
}

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---- host ----
const host = new Client('host');
await host.connect();
let code = args.code;
if (!code) {
  host.send({ type: 'host:create', key: KEY, name: `Load test ${new Date().toISOString()}`, rehearsal: true });
  const st = await host.wait((m) => m.type === 'state');
  code = st.view.code;
  log('created rehearsal session', code);
} else {
  host.send({ type: 'host:attach', key: KEY, code });
  await host.wait((m) => m.type === 'state');
  log('attached to', code);
}
let reqSeq = 0;
const hostCmd = async (action, extra = {}) => {
  const reqId = ++reqSeq;
  host.send({ type: 'host:' + action, key: KEY, reqId, ...extra });
  const m = await host.wait((x) => (x.type === 'ack' || x.type === 'error') && x.reqId === reqId);
  return m.type === 'ack' ? { type: 'state', view: host.state } : m;
};

// ---- students join concurrently ----
const students = Array.from({ length: N }, (_, i) => new Client(`bot${i + 1}`));
await Promise.all(students.map((s) => s.connect()));
await Promise.all(students.map(async (s) => { s.send({ type: 'join', code, nickname: s.name }); await s.wait((m) => m.type === 'joined'); await s.wait((m) => m.type === 'state'); }));
log(`${N} students joined`);
// duplicate nickname must be rejected
const dup = new Client('dup'); await dup.connect(); dup.send({ type: 'join', code, nickname: 'BOT1' });
const dupErr = await dup.wait((m) => m.type === 'error' || m.type === 'joined');
assert(dupErr.type === 'error', 'duplicate nickname accepted');
dup.close();
await sleep(300);
assert(host.state.players.length >= N, `host sees ${host.state.players.length} players, expected >= ${N}`);
if (args['join-only']) {
  // Bots answer any round the instructor opens (every 10th bot stays silent to exercise the missing-count flow).
  const answered = new Map();
  const pick = (game, cfg) => game === 'beauty' ? Math.floor(Math.random() * 101) : game === 'pgg' ? Math.floor(Math.random() * 11) : (['upper', 'lower', ...(cfg.roadOpen ? ['shortcut', 'shortcut'] : [])])[Math.floor(Math.random() * (cfg.roadOpen ? 4 : 2))];
  students.forEach((s, i) => {
    const silent = i % 10 === 9;
    s.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type !== 'state' || !m.view?.round || m.view.round.status !== 'open' || silent) return;
      const r = m.view.round;
      if (answered.get(s.name) === r.id || r.mine) return;
      if (r.game === 'pgg' && !r.config.myGroup) return;
      answered.set(s.name, r.id);
      setTimeout(() => s.send({ type: 'submit', value: pick(r.game, r.config) }), 200 + Math.random() * 2500);
    });
  });
  log('bots connected and auto-answering; press Ctrl-C to disconnect them');
  await new Promise(() => {});
}

// ---- beauty contest ----
let st = await hostCmd('startRound', { game: 'beauty' });
assert(st.view.round.status === 'waiting', 'round not waiting');
// submitting before open must fail
students[0].send({ type: 'submit', value: 10 });
assert((await students[0].wait((m) => m.type === 'error')).message.includes('not open'), 'submit before open accepted');
await hostCmd('open');
await Promise.all(students.map((s) => s.wait((m) => m.type === 'state' && m.view.round?.status === 'open')));
const guesses = students.map(() => Math.floor(Math.random() * 101));
await Promise.all(students.map(async (s, i) => { s.send({ type: 'submit', value: guesses[i] }); await s.wait((m) => m.type === 'submitted'); }));
log('all submitted');
// revisions: first 10 change their mind; last 5 disconnect and reconnect and keep their submission
for (let i = 0; i < Math.min(10, N); i++) { guesses[i] = (guesses[i] + 7) % 101; students[i].send({ type: 'submit', value: guesses[i] }); await students[i].wait((m) => m.type === 'submitted'); }
for (let i = Math.max(0, N - 5); i < N; i++) {
  const s = students[i]; const pid = s.playerId; s.close(); await sleep(50);
  await s.connect(); s.send({ type: 'join', code, playerId: pid });
  await s.wait((m) => m.type === 'joined'); const stt = await s.wait((m) => m.type === 'state');
  assert(stt.view.playerId === pid, 'reconnect changed identity');
  assert(stt.view.round.mine.value === guesses[i], 'reconnect lost submission');
}
log('revisions + reconnects ok');
// hidden before reveal
for (const s of students.slice(0, 3)) assert(s.state.round.result === null && !JSON.stringify(s.state).includes('"mean"'), 'result leaked before close');
await sleep(300);
assert(host.state.round.progress.submitted === N, `host progress ${host.state.round.progress.submitted} != ${N}`);
// bad values rejected
students[1].send({ type: 'submit', value: 101 });
assert((await students[1].wait((m) => m.type === 'error')).message.includes('between'), '101 accepted');
students[1].send({ type: 'submit', value: 'abc' });
await students[1].wait((m) => m.type === 'error');
st = await hostCmd('close');
assert(st.view.round.status === 'closed', 'not closed');
for (const s of students.slice(0, 3)) { await s.wait((m) => m.type === 'state' && m.view.round.status === 'closed'); assert(s.state.round.result === null, 'result leaked after close'); }
students[2].send({ type: 'submit', value: 3 });
assert((await students[2].wait((m) => m.type === 'error')).message.includes('not open'), 'submit after close accepted');
st = await hostCmd('reveal');
const res = st.view.round.results;
const sum = guesses.reduce((a, b) => a + b, 0);
assert(Math.abs(res.mean - sum / N) < 1e-9, 'mean mismatch');
assert(Math.abs(res.target - (2 * sum) / (3 * N)) < 1e-9, 'target mismatch');
const bestKey = Math.min(...guesses.map((g) => Math.abs(3 * N * g - 2 * sum)));
const expectedWinners = guesses.filter((g) => Math.abs(3 * N * g - 2 * sum) === bestKey).length;
assert(res.winners.length === expectedWinners, `winners ${res.winners.length} != ${expectedWinners}`);
await Promise.all(students.map((s) => s.wait((m) => m.type === 'state' && m.view.round.status === 'revealed')));
students.forEach((s, i) => { assert(s.state.round.result.mine.value === guesses[i], 'own value mismatch'); assert(Math.abs(s.state.round.result.mine.distance - Math.abs(guesses[i] - res.target)) < 1e-9, 'distance mismatch'); });
log(`beauty ok: n=${res.n} mean=${res.mean.toFixed(2)} target=${res.target.toFixed(2)} winners=${res.winners.map((w) => w.nickname + ':' + w.value).join(',')}`);

// ---- braess, road closed then open ----
await hostCmd('startRound', { game: 'braess' });
await hostCmd('open');
await Promise.all(students.map((s) => s.wait((m) => m.type === 'state' && m.view.round?.status === 'open' && m.view.round.game === 'braess')));
students[0].send({ type: 'submit', value: 'shortcut' });
assert((await students[0].wait((m) => m.type === 'error')).message.includes('not open yet'), 'shortcut accepted while closed');
await Promise.all(students.map(async (s, i) => { s.send({ type: 'submit', value: i % 2 ? 'upper' : 'lower' }); await s.wait((m) => m.type === 'submitted'); }));
await hostCmd('close');
st = await hostCmd('reveal');
const b1 = st.view.round.results;
if (N % 2 === 0) assert(b1.average === 16 && b1.times.upper === 16, 'even split should give 16');
log(`braess closed-road ok: avg=${b1.average.toFixed(2)} upper=${b1.counts.upper} lower=${b1.counts.lower}`);
let e = await hostCmd('setRoad', { open: true });
assert(e.type === 'state' && e.view.braess.roadOpen === true, 'road did not open: ' + JSON.stringify(e).slice(0, 300));
await hostCmd('startRound', { game: 'braess' });
await hostCmd('open');
await Promise.all(students.map((s) => s.wait((m) => m.type === 'state' && m.view.round?.status === 'open' && m.view.round.config.roadOpen)));
await Promise.all(students.map(async (s) => { s.send({ type: 'submit', value: 'shortcut' }); await s.wait((m) => m.type === 'submitted'); }));
await hostCmd('close');
st = await hostCmd('reveal');
const b2 = st.view.round.results;
assert(b2.average === 20 && b2.times.shortcut === 20 && b2.edges.SA.load === N && b2.edges.BT.load === N, 'all-shortcut should give 20');
await students[0].wait((m) => m.type === 'state' && m.view.round.status === 'revealed' && m.view.round.config.roadOpen);
assert(students[0].state.round.result.mine.alternatives.upper === 21, 'deviation should give 21');
await hostCmd('revealTheory', { shown: true });
log(`braess open-road ok: avg=${b2.average} deviation=21`);

// ---- public goods ----
st = await hostCmd('makeGroups', { size: 4 });
const groups = st.view.pgg.groups;
assert(groups.flat().length === N && groups.every((g) => g.length >= 3 && g.length <= 5), 'bad groups');
await hostCmd('startRound', { game: 'pgg' });
await hostCmd('open');
await Promise.all(students.map((s) => s.wait((m) => m.type === 'state' && m.view.round?.status === 'open' && m.view.round.game === 'pgg')));
// everyone but the last student submits; their group must be flagged incomplete
const contrib = students.map((_, i) => i % 11);
await Promise.all(students.slice(0, N - 1).map(async (s, i) => { s.send({ type: 'submit', value: contrib[i] }); await s.wait((m) => m.type === 'submitted'); }));
st = await hostCmd('close');
let pr = st.view.round.results;
assert(pr.incompleteGroups.length === 1, `expected 1 incomplete group, got ${pr.incompleteGroups.length}`);
const lastPid = students[N - 1].playerId;
const gi = groups.findIndex((g) => g.includes(lastPid));
assert(pr.groups[gi].complete === false && pr.groups[gi].missing.includes(lastPid), 'missing player not flagged');
assert(pr.perPlayer[lastPid].contribution === null, 'missing contribution treated as a number');
st = await hostCmd('excludeGroup', { roundId: st.view.round.id, group: gi, excluded: true });
pr = st.view.round.results;
assert(pr.incompleteGroups.length === 0 && pr.groups[gi].excluded, 'exclusion failed');
st = await hostCmd('reveal');
pr = st.view.round.results;
for (const g of pr.groups) {
  if (!g.scored) continue;
  const members = groups[g.index];
  const total = members.reduce((a, pid) => a + contrib[students.findIndex((s) => s.playerId === pid)], 0);
  assert(g.total === total && Math.abs(g.share - (2 * total) / members.length) < 1e-9, 'group math wrong');
  for (const pid of members) assert(Math.abs(pr.perPlayer[pid].payoff - (10 - pr.perPlayer[pid].contribution + g.share)) < 1e-9, 'payoff wrong');
}
await students[0].wait((m) => m.type === 'state' && m.view.round.status === 'revealed' && m.view.round.game === 'pgg');
const sv = students[0].state;
assert(!JSON.stringify(sv.round.result).includes('perPlayer'), 'student sees per-player pgg data');
log(`pgg ok: ${pr.scoredGroupCount}/${pr.groups.length} groups scored, avg contribution ${pr.avgContribution === null ? 'n/a' : pr.avgContribution.toFixed(2)}`);
// second pgg round keeps the groups
st = await hostCmd('startRound', { game: 'pgg' });
assert(JSON.stringify(st.view.round.config.groups) === JSON.stringify(groups), 'groups changed between rounds');
await hostCmd('cancel');

// ---- CSV export ----
const csv = await fetch((args.url || 'http://localhost:3000') + `/api/export/${code}.csv?key=${KEY}`).then((r) => r.text());
assert(csv.split('\n').length > 3 * N, 'csv too short');
const unauth = await fetch((args.url || 'http://localhost:3000') + `/api/export/${code}.csv?key=wrong`);
assert(unauth.status === 401, 'export without key allowed');
log(`csv ok (${csv.length} bytes)`);

if (!args.keep) { host.send({ type: 'host:delete', key: KEY, code }); await sleep(200); }
students.forEach((s) => s.close()); host.close();
log('ALL CHECKS PASSED', `N=${N}`);
process.exit(0);

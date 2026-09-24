import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../lib/session.js';

function fresh(n = 0) {
  const s = S.createSession({ code: 'ABCD', name: 'Test' });
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(S.joinPlayer(s, { nickname: `Student ${i}` }).player.id);
  return { s, ids };
}

test('join: unique nicknames (case-insensitive), rejoin by id keeps identity', () => {
  const { s } = fresh();
  const a = S.joinPlayer(s, { nickname: '  Kai  ' });
  assert.equal(a.player.nickname, 'Kai');
  assert.throws(() => S.joinPlayer(s, { nickname: 'kai' }), /already taken/);
  assert.throws(() => S.joinPlayer(s, { nickname: '   ' }), /nickname/);
  const again = S.joinPlayer(s, { playerId: a.player.id, nickname: 'Whatever' });
  assert.equal(again.created, false);
  assert.equal(again.player.id, a.player.id);
  assert.equal(again.player.nickname, 'Kai');
  assert.equal(Object.keys(s.players).length, 1);
  // unknown id with a nickname creates a new player (storage was cleared)
  const b = S.joinPlayer(s, { playerId: 'nope', nickname: 'Ana' });
  assert.equal(b.created, true);
  assert.equal(Object.keys(s.players).length, 2);
});

test('lifecycle: waiting -> open -> closed -> revealed, with guards', () => {
  const { s, ids } = fresh(3);
  assert.throws(() => S.openRound(s), /Start a round/);
  S.startRound(s, 'beauty');
  const r = S.currentRound(s);
  assert.equal(r.status, 'waiting');
  assert.throws(() => S.submit(s, ids[0], 10), /not open/);
  assert.throws(() => S.closeRound(s), /not open/);
  assert.throws(() => S.revealRound(s), /Close voting/);
  S.openRound(s);
  assert.throws(() => S.startRound(s, 'beauty'), /Reveal or cancel/);
  S.submit(s, ids[0], 10);
  S.submit(s, ids[0], 20); // revision keeps only the latest
  S.submit(s, ids[1], 40);
  assert.equal(Object.keys(r.submissions).length, 2);
  assert.equal(r.submissions[ids[0]].value, 20);
  assert.throws(() => S.submit(s, ids[2], 101), /between 0 and 100/);
  assert.throws(() => S.submit(s, 'ghost', 5), /rejoin/);
  const p = S.progress(s, r);
  assert.deepEqual([p.expected, p.submitted, p.missing], [3, 2, 1]);
  S.closeRound(s);
  assert.equal(r.status, 'closed');
  assert.throws(() => S.submit(s, ids[2], 5), /not open/);
  assert.equal(r.results.n, 2); // absent student is not invented
  assert.equal(r.results.mean, 30);
  S.reopenRound(s);
  assert.equal(r.results, null);
  S.submit(s, ids[2], 0);
  S.closeRound(s);
  assert.equal(r.results.n, 3);
  S.revealRound(s);
  assert.equal(r.status, 'revealed');
  assert.throws(() => S.cancelRound(s), /revealed/);
  S.startRound(s, 'beauty');
  assert.equal(S.currentRound(s).index, 2);
  assert.equal(s.rounds.length, 2);
});

test('views: students and projector never see submissions or aggregates before reveal', () => {
  const { s, ids } = fresh(4);
  S.startRound(s, 'beauty');
  S.openRound(s);
  S.submit(s, ids[0], 33);
  S.submit(s, ids[1], 66);
  // ignore ids and timestamps, whose random digits could contain the guessed values by chance
  const asJson = (v) => JSON.stringify(v, (k, x) => (/(^id$|Id$|^at$|At$|playerId)/.test(k) ? undefined : x));
  let sv = S.studentView(s, ids[1]);
  assert.equal(sv.round.mine.value, 66);
  assert.equal(sv.round.result, null);
  assert.ok(!asJson(sv).includes('33'), 'other student value leaked');
  assert.ok(!asJson(sv).includes('mean'));
  let scr = S.screenView(s, 2);
  assert.equal(scr.round.submitted, 2);
  assert.equal(scr.round.result, null);
  assert.ok(!asJson(scr).includes('"33"') && !asJson(scr).includes('66'));
  assert.ok(!asJson(scr).includes('submissions'));
  S.closeRound(s);
  sv = S.studentView(s, ids[1]);
  scr = S.screenView(s, 2);
  assert.equal(sv.round.result, null);
  assert.equal(scr.round.result, null);
  assert.equal(sv.round.status, 'closed');
  // host may preview after close
  const hv = S.hostView(s, new Set(ids));
  assert.equal(hv.round.results.mean, 49.5);
  assert.equal(hv.round.progress.missing, 2);
  assert.equal(hv.round.progress.missingNames.length, 2);
  S.revealRound(s);
  sv = S.studentView(s, ids[1]);
  scr = S.screenView(s, 2);
  assert.equal(sv.round.result.mean, 49.5);
  assert.equal(sv.round.result.mine.value, 66);
  assert.equal(sv.round.result.mine.winner, false);
  assert.equal(scr.round.result.winners[0].nickname, 'Student 0');
  assert.equal(scr.round.result.winners[0].value, 33);
  assert.ok(!('perPlayer' in scr.round.result));
  assert.equal(S.studentView(s, ids[3]).round.result.mine, null); // absent student: no invented result
});

test('braess: road can only change between rounds and is snapshotted per round', () => {
  const { s, ids } = fresh(4);
  S.startRound(s, 'braess');
  S.openRound(s);
  assert.throws(() => S.submit(s, ids[0], 'shortcut'), /not open yet/);
  S.submit(s, ids[0], 'upper');
  assert.throws(() => S.setRoad(s, true), /Reveal the current round/);
  S.closeRound(s);
  S.revealRound(s);
  assert.equal(S.currentRound(s).results.times.shortcut, null);
  S.setRoad(s, true);
  S.startRound(s, 'braess');
  assert.equal(S.currentRound(s).config.roadOpen, true);
  S.setRoad(s, false); // still waiting: config follows
  assert.equal(S.currentRound(s).config.roadOpen, false);
  S.setRoad(s, true);
  S.openRound(s);
  ids.forEach((id) => S.submit(s, id, 'shortcut'));
  S.closeRound(s);
  S.revealRound(s);
  const scr = S.screenView(s);
  assert.equal(scr.round.result.average, 20);
  assert.equal(scr.braess.theory, null);
  S.setTheoryRevealed(s, true);
  assert.equal(S.screenView(s).braess.theory.open.allShortcut, 20);
  assert.equal(S.studentView(s, ids[0]).round.result.mine.alternatives.upper, 21);
  assert.equal(S.studentView(s, ids[0]).history.length, 2);
});

test('pgg: needs groups and 3+ players; incomplete groups flagged, exclusion recomputes', () => {
  const { s, ids } = fresh(2);
  assert.throws(() => S.makeGroups(s), /at least 3/);
  const third = S.joinPlayer(s, { nickname: 'Third' }).player.id;
  ids.push(third);
  assert.throws(() => S.startRound(s, 'pgg'), /Make groups/);
  const groups = S.makeGroups(s, 4, (a) => a);
  assert.deepEqual(groups, [ids]);
  S.startRound(s, 'pgg');
  const late = S.joinPlayer(s, { nickname: 'Late' }).player.id; // joined after grouping
  S.openRound(s);
  assert.throws(() => S.submit(s, late, 5), /not in a group/);
  assert.throws(() => S.makeGroups(s), /Reveal the current round/);
  S.submit(s, ids[0], 10);
  S.submit(s, ids[1], 0);
  const p = S.progress(s, S.currentRound(s));
  assert.deepEqual([p.expected, p.submitted, p.missing], [3, 2, 1]); // late joiner not expected
  S.closeRound(s);
  const r = S.currentRound(s);
  assert.deepEqual(r.results.incompleteGroups, [0]);
  assert.equal(r.results.perPlayer[ids[0]].payoff, null);
  S.setGroupExcluded(s, r.id, 0, true);
  assert.equal(r.results.incompleteGroups.length, 0);
  assert.equal(r.results.groups[0].excluded, true);
  S.revealRound(s);
  const sv = S.studentView(s, ids[0]);
  assert.equal(sv.round.result.mine.status, 'excluded');
  assert.equal(sv.round.config.myGroup.index, 0);
  assert.deepEqual(sv.round.config.myGroup.members.sort(), ['Student 0', 'Student 1', 'Third']);
  const scr = S.screenView(s);
  assert.ok(!JSON.stringify(scr).includes('Student 0'), 'projector must not name contributors');
  // groups persist to the next round
  S.startRound(s, 'pgg');
  assert.deepEqual(S.currentRound(s).config.groups, [ids]);
  assert.equal(S.currentRound(s).index, 2);
});

test('removePlayer drops them from groups and from expected counts', () => {
  const { s, ids } = fresh(5);
  S.makeGroups(s, 4, (a) => a);
  S.startRound(s, 'pgg');
  S.removePlayer(s, ids[4]);
  assert.equal(S.currentRound(s).config.groups.flat().length, 4);
  S.openRound(s);
  assert.equal(S.progress(s, S.currentRound(s)).expected, 4);
});

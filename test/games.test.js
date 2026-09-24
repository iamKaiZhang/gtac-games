import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as beauty from '../lib/games/beauty.js';
import * as braess from '../lib/games/braess.js';
import * as pgg from '../lib/games/pgg.js';

const E = (vals) => vals.map((v, i) => ({ playerId: `p${i}`, value: v }));

test('beauty: mean, target, single winner, distances', () => {
  const r = beauty.compute(E([10, 20, 30, 40]));
  assert.equal(r.n, 4);
  assert.equal(r.mean, 25);
  assert.ok(Math.abs(r.target - 50 / 3) < 1e-12);
  assert.deepEqual(r.winners, [{ playerId: 'p1', value: 20 }]);
  assert.equal(r.perPlayer.p1.winner, true);
  assert.equal(r.perPlayer.p0.winner, false);
  assert.ok(Math.abs(r.perPlayer.p0.distance - (50 / 3 - 10)) < 1e-12);
});

test('beauty: exact ties share the win (no floating-point rounding)', () => {
  // mean = 30, target = 20; guesses 19 and 21 are equidistant
  const r = beauty.compute(E([19, 21, 50]));
  assert.equal(r.target, 20);
  assert.deepEqual(r.winners.map((w) => w.value).sort(), [19, 21]);
});

test('beauty: tie detection is exact where floating point would lie', () => {
  // n=3, S=7: target = 14/9 = 1.555...; |1-14/9| = 5/9, |2-14/9| = 4/9 -> 2 wins alone
  const r = beauty.compute(E([1, 2, 4]));
  assert.deepEqual(r.winners.map((w) => w.value), [2]);
  // n=6, S=9: target = 1; guesses 0 and 2 tie exactly
  const r2 = beauty.compute(E([0, 2, 2, 1, 2, 2]));
  assert.equal(r2.target, 1);
  assert.deepEqual(r2.winners.map((w) => w.value), [1]);
  const r3 = beauty.compute(E([0, 2, 3, 4]));
  // S=9,n=4: target 1.5 -> 0 and 2 tie? |0-1.5|=1.5, |2-1.5|=0.5 -> 2 wins alone
  assert.deepEqual(r3.winners.map((w) => w.value), [2]);
});

test('beauty: all-same guesses all win; empty round is handled', () => {
  const r = beauty.compute(E([0, 0, 0]));
  assert.equal(r.winners.length, 3);
  const e = beauty.compute([]);
  assert.equal(e.n, 0);
  assert.equal(e.mean, null);
  assert.deepEqual(e.winners, []);
});

test('beauty: histogram bins and validation', () => {
  const h = beauty.histogram([0, 4, 5, 99, 100]);
  assert.equal(h[0].count, 2);
  assert.equal(h[1].count, 1);
  assert.equal(h[19].count, 2);
  assert.equal(beauty.validate(50), null);
  assert.ok(beauty.validate(101));
  assert.ok(beauty.validate(-1));
  assert.ok(beauty.validate(2.5));
  assert.ok(beauty.validate('50'));
});

test('braess: even split before the road opens gives 16 to everyone', () => {
  const N = 40;
  const entries = E(Array.from({ length: N }, (_, i) => (i % 2 ? 'upper' : 'lower')));
  const r = braess.compute(entries, { roadOpen: false });
  assert.equal(r.times.upper, 16);
  assert.equal(r.times.lower, 16);
  assert.equal(r.average, 16);
  assert.equal(r.times.shortcut, null);
  assert.equal(r.edges.SA.load, 20);
  assert.equal(r.edges.BT.load, 20);
});

test('braess: everyone on the shortcut is an equilibrium at 20; lone deviator gets 21', () => {
  const N = 37;
  const r = braess.compute(E(Array(N).fill('shortcut')), { roadOpen: true });
  assert.equal(r.times.shortcut, 20);
  assert.equal(r.average, 20);
  assert.equal(r.edges.SA.load, N);
  assert.equal(r.edges.BT.load, N);
  assert.equal(r.edges.AB.load, N);
  // unilateral deviations recompute congestion
  assert.equal(r.perPlayer.p0.alternatives.upper, 21);
  assert.equal(r.perPlayer.p0.alternatives.lower, 21);
  const t = braess.theory(N);
  assert.equal(t.open.allShortcut, 20);
  assert.equal(t.open.deviateToUpper, 21);
  assert.equal(t.open.deviateToLower, 21);
});

test('braess: shortcut users load both congestible edges', () => {
  const r = braess.compute(E(['upper', 'lower', 'shortcut', 'shortcut']), { roadOpen: true });
  assert.equal(r.N, 4);
  assert.equal(r.edges.SA.load, 3);
  assert.equal(r.edges.BT.load, 3);
  assert.equal(r.times.upper, 7.5 + 11);
  assert.equal(r.times.lower, 11 + 7.5);
  assert.equal(r.times.shortcut, 15);
  assert.equal(r.perPlayer.p2.time, 15);
  assert.ok(Math.abs(r.average - (18.5 + 18.5 + 15 + 15) / 4) < 1e-12);
});

test('braess: validation and empty round', () => {
  assert.equal(braess.validate('upper', { roadOpen: false }), null);
  assert.ok(braess.validate('shortcut', { roadOpen: false }));
  assert.equal(braess.validate('shortcut', { roadOpen: true }), null);
  assert.ok(braess.validate('sideways', { roadOpen: true }));
  const r = braess.compute([], { roadOpen: false });
  assert.equal(r.average, null);
  assert.equal(braess.theory(0), null);
  const t = braess.theory(10);
  assert.equal(t.closed.times.upper, 16);
  assert.ok(t.closed.deviateToLower > 16);
});

test('pgg: group sizes stay within 3..5 and sum to n', () => {
  for (let n = 3; n <= 120; n++) {
    const s = pgg.groupSizes(n);
    assert.equal(s.reduce((a, b) => a + b, 0), n, `n=${n}`);
    assert.ok(s.every((x) => x >= 3 && x <= 5), `n=${n} sizes ${s}`);
  }
  assert.deepEqual(pgg.groupSizes(3), [3]);
  assert.deepEqual(pgg.groupSizes(5), [5]);
  assert.deepEqual(pgg.groupSizes(6), [3, 3]);
  assert.deepEqual(pgg.groupSizes(7), [4, 3]);
  assert.deepEqual(pgg.groupSizes(8), [4, 4]);
  assert.deepEqual(pgg.groupSizes(9), [5, 4]);
  assert.deepEqual(pgg.groupSizes(10), [5, 5]);
  assert.deepEqual(pgg.groupSizes(11), [4, 4, 3]);
  assert.throws(() => pgg.makeGroups(['a', 'b']));
});

test('pgg: payoffs, fractional shares, incomplete and excluded groups', () => {
  const groups = [['a', 'b', 'c', 'd'], ['e', 'f', 'g'], ['h', 'i', 'j', 'k']];
  const entries = [
    { playerId: 'a', value: 10 }, { playerId: 'b', value: 0 }, { playerId: 'c', value: 5 }, { playerId: 'd', value: 3 },
    { playerId: 'e', value: 4 }, { playerId: 'f', value: 4 }, // g missing
    { playerId: 'h', value: 1 }, { playerId: 'i', value: 1 }, { playerId: 'j', value: 1 }, { playerId: 'k', value: 1 },
  ];
  const r = pgg.compute(entries, { groups, excludedGroups: [2] });
  // group 0: total 18, share 9
  assert.equal(r.groups[0].total, 18);
  assert.equal(r.groups[0].share, 9);
  assert.equal(r.perPlayer.a.payoff, 10 - 10 + 9);
  assert.equal(r.perPlayer.b.payoff, 10 - 0 + 9);
  assert.equal(r.perPlayer.c.payoff, 14);
  // group 1 incomplete: not scored, missing flagged, nobody silently treated as zero
  assert.equal(r.groups[1].complete, false);
  assert.deepEqual(r.groups[1].missing, ['g']);
  assert.equal(r.perPlayer.e.payoff, null);
  assert.equal(r.perPlayer.e.status, 'incomplete');
  assert.equal(r.perPlayer.g.contribution, null);
  assert.deepEqual(r.incompleteGroups, [1]);
  // group 2 excluded explicitly
  assert.equal(r.groups[2].excluded, true);
  assert.equal(r.perPlayer.h.payoff, null);
  assert.equal(r.perPlayer.h.status, 'excluded');
  assert.equal(r.scoredGroupCount, 1);
  assert.equal(r.nScored, 4);
  assert.equal(r.avgContribution, 18 / 4);
  // fractional share with group of 3
  const r2 = pgg.compute([{ playerId: 'e', value: 4 }, { playerId: 'f', value: 4 }, { playerId: 'g', value: 1 }], { groups: [['e', 'f', 'g']] });
  assert.equal(r2.groups[0].share, 6);
  assert.equal(r2.perPlayer.g.payoff, 10 - 1 + 6);
  const r3 = pgg.compute([{ playerId: 'e', value: 1 }, { playerId: 'f', value: 0 }, { playerId: 'g', value: 0 }], { groups: [['e', 'f', 'g']] });
  assert.ok(Math.abs(r3.groups[0].share - 2 / 3) < 1e-12);
  assert.equal(pgg.validate(11), 'Contribute between 0 and 10 tokens.');
  assert.equal(pgg.validate(0), null);
});

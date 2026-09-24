// Beauty contest: choose an integer 0..100; closest to 2/3 of the mean wins.
// All computations are exact for integer guesses: the winner set minimises
// |3n*g - 2S| where n is the number of submissions and S their sum.

export const MIN = 0;
export const MAX = 100;

export function validate(value) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'Choose a whole number.';
  if (value < MIN || value > MAX) return `Choose a number between ${MIN} and ${MAX}.`;
  return null;
}

/**
 * @param {Array<{playerId: string, value: number}>} entries
 */
export function compute(entries) {
  const n = entries.length;
  if (n === 0) {
    return { n: 0, sum: 0, mean: null, target: null, winners: [], perPlayer: {}, histogram: histogram([]) };
  }
  const sum = entries.reduce((a, e) => a + e.value, 0);
  const mean = sum / n;
  const target = (2 * mean) / 3;
  // exact integer distance key: |3n*g - 2S|
  let best = Infinity;
  const keyed = entries.map((e) => {
    const key = Math.abs(3 * n * e.value - 2 * sum);
    if (key < best) best = key;
    return { ...e, key };
  });
  const winners = keyed.filter((e) => e.key === best).map((e) => ({ playerId: e.playerId, value: e.value }));
  const perPlayer = {};
  for (const e of keyed) {
    perPlayer[e.playerId] = {
      value: e.value,
      distance: Math.abs(e.value - target),
      winner: e.key === best,
    };
  }
  return { n, sum, mean, target, winners, perPlayer, histogram: histogram(entries.map((e) => e.value)) };
}

// 20 bins of width 5: [0,5), [5,10), ... [95,100]; 100 falls into the last bin.
export function histogram(values) {
  const bins = Array.from({ length: 20 }, (_, i) => ({ from: i * 5, to: i * 5 + 5, count: 0 }));
  for (const v of values) {
    const i = Math.min(19, Math.floor(v / 5));
    bins[i].count += 1;
  }
  return bins;
}

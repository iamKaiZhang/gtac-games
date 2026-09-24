// Braess's paradox on a four-node network S, A, B, T.
//   S->A : 10 * x / N      (x = drivers on S->A)
//   A->T : 11 (fixed)
//   S->B : 11 (fixed)
//   B->T : 10 * y / N      (y = drivers on B->T)
//   A->B : 0 when open, unavailable otherwise
// Routes: upper = S-A-T, lower = S-B-T, shortcut = S-A-B-T (uses both congestible edges).

export const ROUTES = ['upper', 'lower', 'shortcut'];
export const ROUTE_LABELS = { upper: 'Upper route  S → A → T', lower: 'Lower route  S → B → T', shortcut: 'Shortcut  S → A → B → T' };
export const FIXED = 11;
export const CONGESTION = 10;

export function validate(value, { roadOpen }) {
  if (value === 'shortcut' && !roadOpen) return 'The shortcut is not open yet.';
  if (!ROUTES.includes(value)) return 'Choose one of the routes.';
  return null;
}

export function edgeLoads(counts) {
  const x = counts.upper + counts.shortcut;
  const y = counts.lower + counts.shortcut;
  return { x, y };
}

export function travelTimes(counts, N) {
  if (N === 0) return { upper: null, lower: null, shortcut: null, edges: null };
  const { x, y } = edgeLoads(counts);
  const sa = (CONGESTION * x) / N;
  const bt = (CONGESTION * y) / N;
  return {
    upper: sa + FIXED,
    lower: FIXED + bt,
    shortcut: sa + bt,
    edges: {
      SA: { load: x, time: sa },
      AT: { load: counts.upper, time: FIXED },
      SB: { load: counts.lower, time: FIXED },
      BT: { load: y, time: bt },
      AB: { load: counts.shortcut, time: 0 },
    },
  };
}

/**
 * @param {Array<{playerId: string, value: 'upper'|'lower'|'shortcut'}>} entries
 * @param {{roadOpen: boolean}} config
 */
export function compute(entries, { roadOpen }) {
  const N = entries.length;
  const counts = { upper: 0, lower: 0, shortcut: 0 };
  for (const e of entries) counts[e.value] += 1;
  const times = travelTimes(counts, N);
  const perPlayer = {};
  let total = 0;
  for (const e of entries) {
    const t = times[e.value];
    total += t;
    // Unilateral deviation: recompute congestion after this driver alone switches.
    const alternatives = {};
    for (const r of ROUTES) {
      if (r === e.value) continue;
      if (r === 'shortcut' && !roadOpen) continue;
      const c = { ...counts };
      c[e.value] -= 1;
      c[r] += 1;
      alternatives[r] = travelTimes(c, N)[r];
    }
    perPlayer[e.playerId] = { route: e.value, time: t, alternatives };
  }
  return {
    N,
    roadOpen,
    counts,
    times: { upper: times.upper, lower: times.lower, shortcut: roadOpen ? times.shortcut : null },
    edges: times.edges,
    average: N ? total / N : null,
    perPlayer,
  };
}

/**
 * Theoretical comparison for N drivers, revealed only by the instructor.
 *  - Without the road, an (as-)even split; with N even everyone takes 16.
 *  - With the road, everyone on the shortcut takes 20 and a lone deviator takes 21.
 */
export function theory(N) {
  if (!N || N < 1) return null;
  const half = Math.floor(N / 2);
  const split = { upper: N - half, lower: half, shortcut: 0 };
  const splitTimes = travelTimes(split, N);
  const allShort = { upper: 0, lower: 0, shortcut: N };
  const shortTimes = travelTimes(allShort, N);
  const devUpper = travelTimes({ upper: 1, lower: 0, shortcut: N - 1 }, N).upper;
  const devLower = travelTimes({ upper: 0, lower: 1, shortcut: N - 1 }, N).lower;
  // Deviation from the even split (road closed): one upper driver moves to lower.
  const devSplit = N >= 2 ? travelTimes({ upper: split.upper - 1, lower: split.lower + 1, shortcut: 0 }, N).lower : null;
  return {
    N,
    closed: { split, times: { upper: splitTimes.upper, lower: splitTimes.lower }, deviateToLower: devSplit },
    open: { allShortcut: shortTimes.shortcut, deviateToUpper: devUpper, deviateToLower: devLower },
  };
}

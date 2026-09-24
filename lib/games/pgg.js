// Public goods game: endowment 10, contribute integer 0..10, group total doubled and shared equally.
// payoff = 10 - c_i + 2 * sum(c_group) / groupSize

export const ENDOWMENT = 10;
export const MULTIPLIER = 2;
export const MIN_PLAYERS = 3;

export function validate(value) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'Choose a whole number of tokens.';
  if (value < 0 || value > ENDOWMENT) return `Contribute between 0 and ${ENDOWMENT} tokens.`;
  return null;
}

/**
 * Persistent groups: default size 4, leftovers folded into groups of 3..5.
 * @param {string[]} playerIds already shuffled by the caller if randomness is wanted
 */
export function makeGroups(playerIds, size = 4) {
  const n = playerIds.length;
  if (n < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players, have ${n}.`);
  const sizes = groupSizes(n, size);
  const groups = [];
  let i = 0;
  for (const s of sizes) {
    groups.push(playerIds.slice(i, i + s));
    i += s;
  }
  return groups;
}

export function groupSizes(n, size = 4) {
  if (size < 3) size = 3;
  const k = Math.floor(n / size);
  const r = n % size;
  if (r === 0) return Array(k).fill(size);
  if (k === 0) return [n]; // fewer than `size` players: one small group
  const sizes = Array(k).fill(size);
  if (r >= 3) { sizes.push(r); return sizes; }       // leftover is already a valid small group
  if (r <= k) { for (let g = 0; g < r; g++) sizes[g] += 1; return sizes; } // grow r groups to size+1
  // r > k (only n = 6 with size 4): leftover too small, steal members until it has 3
  sizes.push(r);
  let need = 3 - r;
  for (let g = 0; g < sizes.length - 1 && need > 0; g++) {
    while (sizes[g] > 3 && need > 0) { sizes[g] -= 1; sizes[sizes.length - 1] += 1; need -= 1; }
  }
  return sizes;
}

/**
 * @param {Array<{playerId: string, value: number}>} entries
 * @param {{groups: string[][], excludedGroups?: number[]}} config
 */
export function compute(entries, { groups, excludedGroups = [] }) {
  const byPlayer = new Map(entries.map((e) => [e.playerId, e.value]));
  const perPlayer = {};
  const groupResults = groups.map((members, gi) => {
    const submitted = members.filter((p) => byPlayer.has(p));
    const missing = members.filter((p) => !byPlayer.has(p));
    const excluded = excludedGroups.includes(gi);
    const complete = missing.length === 0;
    const scored = complete && !excluded;
    const total = submitted.reduce((a, p) => a + byPlayer.get(p), 0);
    const share = scored ? (MULTIPLIER * total) / members.length : null;
    for (const p of members) {
      const c = byPlayer.has(p) ? byPlayer.get(p) : null;
      perPlayer[p] = {
        group: gi,
        contribution: c,
        groupTotal: scored ? total : null,
        share,
        payoff: scored && c !== null ? ENDOWMENT - c + share : null,
        status: excluded ? 'excluded' : complete ? 'scored' : 'incomplete',
      };
    }
    return { index: gi, size: members.length, submitted: submitted.length, missing, complete, excluded, scored, total: scored ? total : null, share };
  });
  const scoredGroups = groupResults.filter((g) => g.scored);
  const scoredContribs = entries.filter((e) => perPlayer[e.playerId]?.status === 'scored').map((e) => e.value);
  const avgContribution = scoredContribs.length ? scoredContribs.reduce((a, b) => a + b, 0) / scoredContribs.length : null;
  const hist = Array.from({ length: ENDOWMENT + 1 }, (_, v) => ({ value: v, count: 0 }));
  for (const c of scoredContribs) hist[c].count += 1;
  const avgPayoff = scoredContribs.length
    ? Object.values(perPlayer).filter((p) => p.status === 'scored' && p.payoff !== null).reduce((a, p) => a + p.payoff, 0) / scoredContribs.length
    : null;
  return {
    groups: groupResults,
    perPlayer,
    scoredGroupCount: scoredGroups.length,
    incompleteGroups: groupResults.filter((g) => !g.complete && !g.excluded).map((g) => g.index),
    avgContribution,
    avgPayoff,
    histogram: hist,
    nScored: scoredContribs.length,
  };
}

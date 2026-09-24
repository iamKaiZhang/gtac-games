// Long-format CSV: one row per (round, player). Aggregates are repeated per row.
const COLS = [
  'session_code', 'session_name', 'rehearsal', 'game', 'round_index', 'round_status', 'road_open', 'group',
  'player_id', 'nickname', 'submission', 'submitted_at',
  'n_submitted', 'mean', 'target', 'distance', 'winner',
  'travel_time', 'avg_travel_time',
  'group_total', 'share', 'payoff', 'group_status',
];

const esc = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function sessionToCSV(session) {
  const rows = [COLS.join(',')];
  for (const round of session.rounds) {
    const res = round.results;
    const players = round.game === 'pgg' ? round.config.groups.flat() : Object.keys(session.players);
    const ids = new Set([...players, ...Object.keys(round.submissions)]);
    for (const id of ids) {
      const p = session.players[id];
      const sub = round.submissions[id];
      const pr = res?.perPlayer?.[id];
      const gi = round.game === 'pgg' ? round.config.groups.findIndex((g) => g.includes(id)) : null;
      const row = {
        session_code: session.code, session_name: session.name, rehearsal: session.rehearsal ? 'yes' : 'no',
        game: round.game, round_index: round.index, round_status: round.status,
        road_open: round.game === 'braess' ? (round.config.roadOpen ? 'yes' : 'no') : null,
        group: gi === null ? null : gi >= 0 ? gi + 1 : null,
        player_id: id, nickname: p?.nickname ?? '(left)',
        submission: sub ? sub.value : null, submitted_at: sub ? new Date(sub.at).toISOString() : null,
        n_submitted: res ? (res.n ?? res.N ?? res.nScored ?? null) : null,
        mean: res?.mean ?? null, target: res?.target ?? null,
        distance: pr?.distance ?? null, winner: pr ? (pr.winner ? 'yes' : 'no') : null,
        travel_time: pr?.time ?? null, avg_travel_time: res?.average ?? null,
        group_total: pr?.groupTotal ?? null, share: pr?.share ?? null, payoff: pr?.payoff ?? null, group_status: pr?.status ?? null,
      };
      rows.push(COLS.map((c) => esc(row[c])).join(','));
    }
  }
  return rows.join('\n') + '\n';
}

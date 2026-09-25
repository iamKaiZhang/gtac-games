# gtc-games

Multiplayer classroom games for the *Game Theory and Control* tutorial:
**beauty contest**, **Braess's paradox**, and a **public-goods game**.
Students scan one QR code, pick a nickname, and stay connected while the
instructor switches games. Everything is computed and enforced on the server.

Three views:

| View | URL | Who |
|---|---|---|
| Student | `/` or `/j/CODE` (the QR target) | students, phones |
| Instructor | `/host` (needs the private `HOST_KEY`) | you |
| Projector | `/screen/CODE` | classroom screen |

Stack: one Node.js process (`node:http` + `ws`), no database. State lives in
memory and is snapshotted to `data/sessions.json`. Two runtime dependencies:
`ws` and `qrcode`.

---

## Instructor guide

### Before class (5 minutes)

1. Open `https://<your-app-url>/host` and enter the instructor key
   (`HOST_KEY`, see *Deploy*). The key is stored only in that browser.
2. **Create session.** Give it a name. Tick **Rehearsal** only for test runs:
   rehearsal sessions are listed separately and their CSV is labelled.
3. Click **Open projector view** and put that tab on the projector. It shows
   the join URL, the 4-letter code, the QR code, and a live "joined" counter.
4. Keep the instructor tab on your laptop. Both tabs can be reloaded at any
   time without losing anything.

If the app is on Render's free plan, open the instructor page about five
minutes early: a sleeping instance takes about a minute to wake.

### Students join

Students scan the QR code (or type the URL and the code), enter a nickname,
and see "You're in". Nicknames must be unique within the session. Each phone
gets a persistent anonymous player id, so reloading the page, locking the
phone, or dropping off Wi-Fi does not create a new player or lose a
submission. Nothing to install, no accounts.

If a student cannot rejoin (for example after clearing browser data, the old
nickname is now "taken"), remove the old entry with ✕ in the player list and
let them join again.

### Running a round

Every round follows the same lifecycle, controlled by one big button:

    Waiting  →  Voting open  →  Voting closed  →  Results revealed

* **Start round**: students and the projector see the instructions; nobody
  can submit yet. Explain the game now.
* **Open voting**: students submit. They may change their answer until you
  close; only the latest counts. They see a green "Submitted ✓" confirmation.
  The projector shows "37 / 52 submitted" and nothing else.
* **Close voting**: if answers are missing you are shown how many and who,
  and asked to confirm. Missing answers stay missing; the server never invents
  a choice. You now see a private preview of the results. **Reopen voting** if
  you closed too early.
* **Reveal results**: results appear on the projector and each student sees
  their own outcome. Until this moment no student or projector page receives
  any submission, aggregate, or payoff (enforced server-side, not just hidden).
* **New round**: same game again; the history accumulates.

**Cancel round** discards a round that has not been revealed.

### Game 1: Beauty contest

Students pick an integer 0-100. On reveal the server computes the mean, the
target (two-thirds of the mean), and the winners as the guesses minimising
|3n·g − 2S| exactly (no rounding issues). Projector: histogram with mean and
target markers, all winners with their guesses, and a round-by-round strip.
Students: their guess and distance from the target. Ties share the win; an
empty round is reported as such.

### Game 2: Braess's paradox

Network S→A (10·x/N), A→T (11), S→B (11), B→T (10·y/N), and A→B (0, initially
closed). Routes: upper S-A-T, lower S-B-T, and, once you open the road,
shortcut S-A-B-T. Shortcut users load *both* congestible edges.

1. Run one or two rounds with the road closed.
2. Press **🚧 Open the new road** (only possible between rounds), run more
   rounds.
3. On reveal the projector shows route counts, edge loads and times, the
   average travel time, and the before/after history. Each student sees their
   own travel time and what they would have got by switching alone (with
   congestion recomputed).
4. Press **Show theory** when you want the comparison on the projector:
   even split gives 16, everyone on the shortcut gives 20, a lone deviator
   gets 21. It stays hidden until you press it so it does not spoil the game.

### Game 3: Public goods

Needs at least 3 players. Press **Make groups**: groups of 4, leftovers
folded into groups of 3 to 5; the grouping is shown to you and each student
sees their own group members. Groups persist across rounds so you can let
them talk and play again. **Regroup** reshuffles (asks for confirmation).

Each round: 10 tokens, contribute 0-10, pot doubled and split equally.
Payoff = 10 − c + 2·(group total)/(group size).

If someone in a group did not submit, that group is flagged **incomplete** and
not scored. You can **Reopen voting** and wait, or **Exclude from scoring**
for that round. Missing contributions are never counted as zero. The projector
shows only anonymous aggregates (contribution histogram, averages, trend); it
never names contributors. Students see only their own numbers.

Students who join after grouping are listed as ungrouped; regroup between
rounds to include them.

### Export and history

**⬇ Export CSV** downloads every round and player of the session (one row per
round × player, with submissions and outcomes). The instructor page also
keeps a round history table.

### Recovery from problems

* **A student's phone loses connection**: the page shows "Reconnecting…" and
  recovers on its own; their submission is safe on the server.
* **Your laptop loses connection**: reload `/host`; you are still signed in
  and attached to the session.
* **The server restarts** (for example Render's free instance went to sleep or
  was redeployed): sessions are restored from `data/sessions.json` where the
  disk is persistent (Fly, your own machine). On Render's free plan the disk is
  wiped, but the instructor browser keeps a live backup of the session. Open
  `/host`: under **Backups in this browser** press **Restore**. Students
  reconnect automatically with their identities and submissions intact.
* **A student sees "No session with that code"**: the room they were in no
  longer exists on the server (usually a restart). Restore the session from the
  browser backup, then tell them to press **Join** again with the same code;
  their phone still holds their identity, so they come back as the same player.
* **Wrong key / lost key**: the key is the `HOST_KEY` environment variable of
  the deployment; read it in the hosting dashboard.
* **Emergency fallback**: the app runs on any laptop with Node 22
  (`HOST_KEY=something npm start`) and can be exposed with a tunnel such as
  `cloudflared tunnel --url http://localhost:3000`.

---

## Deploy

### Render (free, no card)

1. Push this repository to GitHub.
2. In the Render dashboard: **New → Blueprint**, pick the repository. Render
   reads `render.yaml` and creates a free web service in Frankfurt with a
   generated `HOST_KEY`.
3. After the first deploy, open the service → **Environment** to read
   `HOST_KEY`. The app URL is `https://<service-name>.onrender.com`.
4. Optional: **Settings → Custom domains** to serve it from a subdomain of
   your own site (one CNAME record).

Limits of the free plan (from Render's docs): the service sleeps after 15
minutes without traffic and takes about a minute to wake; the disk is
ephemeral (use the browser backup described above); 750 instance hours per
month. Open WebSockets keep it awake during class.

### Fly.io (about 2-3 USD/month, always on, persistent disk)

```bash
fly launch --no-deploy --copy-config
fly volumes create data --size 1 --region fra
fly secrets set HOST_KEY="$(openssl rand -hex 24)"
fly deploy
```

### Anywhere with Docker or Node

`docker build -t gtc-games . && docker run -p 3000:3000 -e HOST_KEY=... -v gtc-data:/data gtc-games`
or simply `HOST_KEY=... node server.js`. Environment variables: `PORT`
(default 3000), `HOST_KEY` (required in production), `DATA_DIR` (default
`./data`).

---

## Development

```bash
npm install
npm run dev          # http://localhost:3000, HOST_KEY=dev
npm test             # unit tests: game math, ties, empty rounds, lifecycle, hidden views
npm run loadtest -- --url http://localhost:3000 --key dev --n 100
```

The load test opens 100 real WebSocket clients, joins them, runs a beauty
contest with revisions and reconnects, two Braess rounds (road closed/open)
checking the 16/20/21 values, a public-goods round with a missing
contribution and an exclusion, and the CSV export. Add `--code ABCD
--join-only` to attach auto-answering bots to a session you are driving by
hand (every tenth bot stays silent so the missing-count flow is exercised).

Layout: `lib/games/*.js` pure game math, `lib/session.js` state machine and
per-role views, `server.js` HTTP + WebSocket, `public/` the three pages.

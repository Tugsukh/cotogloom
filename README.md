# Cotogloom — 3D hide & seek in the browser

A multiplayer first-person hide-and-seek game for 2–8 players. One **seeker** hunts with a flashlight. The **hiders**
creep around a dark two-storey building, solve tasks at glowing stations, and escape through the exit door.

- Node.js + Express + Socket.io, authoritative server (it owns state, timers, tasks, catching and win checks)
- Three.js served locally from `node_modules` through an import map. There is no build step, no database, and no internet needed at runtime.
- Physics, map and line-of-sight code is shared by server and browser (`shared/`)

## Run it

```bash
npm install
```

```bash
npm start
```

The server listens on `0.0.0.0:3000` (or `$PORT`) and prints its addresses, e.g.

```
Cotogloom server listening on port 3000
  Local:   http://localhost:3000
  LAN:     http://192.168.1.23:3000
```

Open the LAN link on every computer on the same Wi-Fi. The browser connects back to whatever address served the page,
so nothing is hard-coded.

### Put it online (players outside your network)

With [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installed and `npm start` running:

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints a public `https://<random>.trycloudflare.com` link. Share it. The link lives as long as that command runs.

## How to play

1. Enter a name, pick one of 8 colors, **Join lobby**. The first player in is the **host** (if the host leaves, the next player takes over).
2. Everyone clicks **Ready**. The host sets the options and presses **Start game** (needs 2+ players, all ready).
3. **Hiding phase** (30 s): the seeker's screen is black and they can't move. Hiders scatter.
4. **Seeking phase** (5 min): the seeker clicks to catch a hider, who must be within 1.5 m, in line of sight, and in front of the seeker.
   Caught hiders become spectators.
5. Hiders press **E** at a glowing station to do a task. After enough tasks (4) the **EXIT** door turns green *for that hider*.
   Walking into it means you escaped.
6. **Hiders win** if at least half of them escape. **The seeker wins** once that's impossible or the timer runs out.
7. The end screen shows who escaped, who was caught by whom, and the round time. The host presses **Play again**
   (the seeker rotates to the next player) or **Back to lobby**.

### Controls

| Key | Action |
|---|---|
| Mouse | look (click the game to capture the mouse) |
| W A S D / arrows | move |
| Shift | sprint (uses stamina, bar at the bottom) |
| C (or Ctrl) | crouch, held: slower, almost silent, fits under desks and tables |
| E | use a task station (hiders) |
| Left click | catch (seeker) |
| Esc | free the mouse / close a task |
| Click, ← → | switch players while spectating |

Tip: use **C** to crouch. In most browsers Ctrl+W closes the tab, and a page can't block that.

### Things to know
- Hiders carry a dim light only they can see. The seeker's flashlight is a visible cone, so everyone can tell where the seeker is looking.
- Footsteps are positional (left/right panned and quieter with distance): loud when sprinting, nearly silent when crouching.
- A heartbeat plays when the seeker is within 8 m, faster the closer they are.
- The seeker can't see hiders' name tags.
- Hide under desks: a standing seeker can't catch you there because the table top blocks line of sight. They have to crouch.
- There's a crawl space under the high end of the staircase, plus closets, shelves and dark rooms (storage, server room, west loft).
- Code-lock tasks: the 4-digit code is painted on a sign in the world, a few metres from that station.

## Changing settings

**In the lobby (host):** round length, hiding time, tasks needed to escape, and seeker (random or a chosen player).

**In code:** every constant lives in [`shared/config.js`](shared/config.js): speeds, stamina, catch distance and
angle, task distance, exit distance, heartbeat range, lighting intensities, footstep volumes, network rates, anti-cheat
tolerances, default lobby settings and their allowed ranges. Restart the server and reload the page after editing.

**The map:** [`shared/map.js`](shared/map.js) builds the building from axis-aligned boxes with helpers
(`wallX`/`wallZ` with door gaps, `table`, `closet`, `box`). It also lists task stations (with the position of each
code-lock sign), the exit, spawn points and room lights.

## Adding trivia questions

Edit [`client/tasks/questions.json`](client/tasks/questions.json). Each entry looks like this:

```json
{ "q": "What is the capital of France?", "choices": ["Paris", "Lyon", "Marseille", "Nice"], "answer": 0 }
```

`answer` is the index of the correct choice (choices are shuffled when shown). The server loads this same file at startup, so restart it after editing.

## Adding a new task type

1. **Server:** add an entry to `TASKS` in [`server/tasks.js`](server/tasks.js):
   ```js
   mytask: {
     create(ctx)              { return { data: {/* sent to client */}, secret: {/* stays on server */} }; },
     check(task, answer, ctx) { return ok ? { result: 'complete' }
                                          : { result: 'wrong', data: task.data, message: 'Nope' }; },
   },
   ```
   Multi-step tasks can return `{ result: 'progress', data }`. Stations pick random types from `TASKS` automatically.
2. **Client:** create `client/tasks/mytask.js`:
   ```js
   export default {
     title: 'My task',
     open(container, data, submit) { /* render; `await submit(answer)` returns the server's result */ },
     close() { /* clean up timers / listeners */ },
   };
   ```
3. Register it in [`client/tasks/index.js`](client/tasks/index.js) under the same key.

## Tests

```bash
npm test
```

[`tests/bots.mjs`](tests/bots.mjs) starts its own server in test mode (`HS_TEST=1`, which enables a few `debug:*`
socket events used only by tests) and drives fake players with socket.io-client. It covers the lobby and host rules,
movement sync and anti-cheat (speed, walls, flying), stairs/crouch physics, catching (range, facing, line of sight,
under-desk), every win condition, every task type (wrong answer rejected, right answer accepted), exit gating,
disconnects and late joiners. You can run single phases with `node tests/bots.mjs 3 4`.

Browser checks (headless Chromium via Playwright, which must be installed): `node tests/screenshot.cjs`,
`node tests/screenshot-round.cjs` and `node tests/screenshot-tasks.cjs` fail on console errors and write screenshots to `screenshots/`.

## Project layout

```
server/index.js      Express + Socket.io bootstrap, static files, prints LAN address
server/game.js       lobby, rounds, movement validation, catching, tasks, win logic
server/tasks.js      task challenge generation + answer checking
shared/config.js     all game constants
shared/map.js        the building, stations, exit, spawns, lights
shared/collision.js  player-box collision, step-up, ground snap, line of sight
client/              index.html (import map), main.js, ui.js, world.js, players.js, controls.js, audio.js, tasks/
tests/               bot suite + headless browser checks
```

## Defaults I chose

- **One lobby per server**, max 8 players. Players who join mid-round spectate until the next round.
- **Seeker speed** is 5% faster than hiders. Walk 3.6 m/s, sprint 6 m/s, crouch 1.6 m/s, stamina for ~3.5 s of sprinting.
- **Catch** means seeker eye to the nearest point of the hider's body ≤ 1.5 m, hider within 60° of where the seeker faces,
  line of sight to the hider's body centre or head, with a 0.6 s cooldown between attempts.
- **Round length** is the seeking time after the hiding phase. Hiders may already do tasks (and escape) during hiding.
- **"At least half"** means `ceil(hiders / 2)`, counting only hiders still connected. If every hider leaves, the seeker wins.
- **Tasks:** 10 stations. Each round the six types are shuffled like a deck and dealt out, so every type appears.
  A wrong answer gives a fresh challenge (math and trivia restart from question 1). The code lock keeps its code.
  A station is done per player and dims only for that player.
- **Play again** starts the next round immediately with the seeker rotated to the next player in join order.
  If last round's seeker left, it goes to the first player. **Back to lobby** lets the host change settings.
- **Seeker leaves** ends the round as a hiders' win ("Seeker left").
- **No jumping** (the spec doesn't ask for it, and it would let players climb furniture).
- If you lose connection, you rejoin from the join screen (your round progress is not restored).

## Known limitations

- Anti-cheat uses tolerances: the server rejects too-fast, through-wall and flying moves and validates catches, tasks
  and escapes. But every client receives every player's position, so a modified client could still see through walls.
- Footsteps aren't blocked by walls (only distance and panning).
- After closing a task with Esc, you have to click once to recapture the mouse (browser pointer-lock rule).
- No touch/mobile controls.
- Tested in headless Chromium with software rendering. Performance on real GPUs wasn't measured, but the scene is small
  (merged geometry, ~10 lights, no shadows).

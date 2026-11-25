# Cotogloom — build plan

Multiplayer 3D first-person hide-and-seek in the browser.
Node + Express + Socket.io (authoritative server), Three.js client (served from node_modules via import map).

## File layout
```
package.json
server/index.js        express + socket.io bootstrap, static files, LAN address print
server/game.js         Game class: lobby, roles, phases, timers, movement validation, catching, win checks
server/tasks.js        server-side task registry: challenge generation + answer checking
shared/config.js       ALL game constants (speeds, distances, timers, heights, colors…)
shared/map.js          building as axis-aligned boxes + stations, signs, exit, spawns, lights
shared/collision.js    player AABB collision, per-axis movement, step-up, ground snap, line of sight
client/index.html      import map (three, three/addons/), UI overlays
client/style.css
client/main.js         bootstrap, networking, game loop, spectator camera
client/ui.js           join screen, lobby, HUD, end screen, task overlay
client/world.js        renders the map, lights, stations, signs, exit door
client/players.js      remote avatars, interpolation, name tags, seeker flashlight cone
client/controls.js     local player physics (WASD, sprint/stamina, crouch)
client/audio.js        procedural Web Audio footsteps / heartbeat / chimes
client/tasks/index.js  task registry (type -> module)
client/tasks/{wires,simon,key,math,trivia,codelock}.js
client/tasks/questions.json
tests/bots.mjs         socket.io-client bot test suite (spawns its own server)
tests/screenshot.cjs   Playwright headless check: console errors + screenshots
README.md
```

## Phases
- [x] 1. Server + lobby + players walking in a test room, synced (bots: join, ready, host start)
- [x] 2. Full map, collision, stairs, crouch-under-table, lighting (screenshots)
- [x] 3. Roles, hiding/seeking, catching, timer, win/results, play again (bots: catch LOS/range, win logic)
- [ ] 4. (IN PROGRESS: questions.json written; server tasks, client task UIs, exit door next) Task stations, 6 tasks, exit door (bots: every task rejects wrong / accepts right; escape gating)
- [ ] 5. Sound, HUD polish, spectator mode, disconnect handling
- [ ] Finish: README, full test run, cloudflared tunnel

Verification after every phase: `npm start` boots cleanly, `node tests/bots.mjs` passes,
`node tests/screenshot.cjs` shows no console errors + screenshot reviewed, then git commit.

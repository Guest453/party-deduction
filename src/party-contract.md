# Party deduction — 3D, frozen architecture

An AI-hosted **3D** social-deduction game. Players sit around a table in a 3D
room; the **host is a Pollinations text model and speaks every beat with TTS**;
the **rules are enforced in code** (roles, rounds, votes, winner). The host
narrates; code decides. Pass-and-play on one device.

Built on Three.js, bundled with esbuild — same stack as `whodunnit`. No external
assets: all geometry is procedural, all textures are drawn on a canvas.

```
src/
  engine.js    agent A   pure game logic (players, roles, rounds, votes, winner)
  host.js      agent B   the AI host: scenario + narration TEXT (injected ask())
  voice.js     agent C   the VOICE: TTS queue/player, casting, spoken votes
  scene.js     agent D   the 3D room: table, chairs, avatars, lighting, camera
  api.js       integrator  BYOP sign-in + model calls (ask / speak / transcribe)
  ui.js        integrator  thin HUD overlay (turn banners, timer, cards)
  main.js      integrator  wiring + the phase loop
index.html     integrator
```

Uniform rules: ES modules, `export function`, no DOM outside `ui.js`/`scene.js`
canvas, no network outside `api.js` (modules receive callbacks). Every file must
pass `node --check` and must construct headlessly in Node with a tiny DOM shim
(the integrator ships the shim in `test/`).

---

## engine.js (agent A) — pure, no DOM, no network

```js
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;
export const ROUNDS = 3;

export function traitorCountFor(playerCount)      // 4-6 -> 1, 7-10 -> 2
export function createGame({ players, seed })     // players: [{ id, name }]
export function setScenario(game, scenario)       // injects the host scenario
export function assignRoles(game)                 // CODE picks traitors
export function beginBriefing(game)
export function beginRound(game)                  // -> discussion; picks this round's twist
export function currentTwist(game)
export function openVote(game)
export function castVote(game, voterId, targetId) // validates; { ok, error? }
export function closeVote(game)
export function tally(game)                       // { counts:[{targetId,votes}], eliminatedId|null, tied }
export function resolve(game)                     // { crewWon, traitorIds, eliminatedId }
export function nextPhase(game)                   // advances the state machine
export function publicState(game)                 // safe snapshot (NO secrets)
export function secretFor(game, playerId)         // that player's secret
```

Phases: `lobby → briefing → roles → round → vote → result` looping to `ROUNDS`,
then `reveal → ended`. `game.phase` is the current name.

`scenario` = `{ title, premise, location, roles:[{name,blurb}], twists:[string,...] }`
(>= 5 roles, >= ROUNDS twists). `assignRoles` gives each player
`{ roleName, blurb, traitor:boolean, objective:string }`; traitors come from the
seeded RNG. Crew win if the eliminated player is a traitor; else traitors win
(tie on the final vote = traitors win). `publicState` never includes `traitor`
or `objective`.

## host.js (agent B) — the AI host (text)

```js
export function createHost({ ask, model = "openai/gpt-5.4-nano" })
// ask({ system, user }) -> Promise<string>
```
Returns `{ scenario({playerCount,seedHint}), narrate(beat, ctx), readVotes(tally, ctx), reveal(result, ctx) }`.
- `beat`: `"welcome" | "briefing" | "twist" | "discussion" | "vote" | "result"`.
- `ctx` = public facts only (phase, round, twist, player names, counts).
- `scenario` requests **JSON only**, then validates (roles>=5, twists>=ROUNDS,
  all strings); retry once, then a built-in fallback so the game never breaks.
- Lines: 1-2 sentences, plain text, no markdown, written to be spoken.
- Never reveal who is a traitor — the host only knows public facts.

## voice.js (agent C) — the VOICE layer

```js
export function createVoice({ speak, transcribe, onLine })
// speak(text, voice) -> Promise<objectUrl>;  transcribe(blob) -> Promise<string>
```
Returns `{ casting(playerCount), say(text, voice, {interrupt}), stop(), isSpeaking(), queue(), record()/stopRecording(), attach(el) }`.
- A queue that plays one line at a time, calling `onLine(text)` as each begins.
  `say(..., {interrupt:true})` cancels current + clears the queue.
- `casting` gives the host and every player a **distinct** voice from:
  `alloy, echo, fable, onyx, nova, shimmer, ash, ballad, coral, sage, verse,
  charlie, george, callum, daniel, fin`.
- Degrades gracefully if `speak` fails (skip the line, keep playing).
- `record()/stopRecording()` wraps MediaRecorder for optional spoken votes.

## scene.js (agent D) — the 3D room

```js
export function createScene(canvas, THREE) {
  return {
    setPlayers(players),          // [{ id, name, isTraitor }] -> avatars around the table
    setPhase(phase),              // mood/lighting/pose per phase
    highlight(playerId),          // the active speaker/ voter glows
    vote(voterId, targetId),      // an arrow/token flies from voter to target
    eliminate(playerId),          // the avatar is removed / slumps
    revealRoles(revealed),        // [{ id, roleName, traitor }] -> labels appear
    setCameraShot(name),          // "overview" | "focus:<playerId>" | "reveal" | "orbit"
    update(dt),
    dispose(),
  };
}
```
- A round table in a moody room (procedural primitives + canvas textures), one
  **seated avatar per player** (simple, readable, distinct colours), a chair
  each, warm lighting, subtle idle motion (breathing, head turns, cards on the
  table). An empty chair for the eliminated player.
- **Avatars must carry `userData.playerId`** so the integrator can raycast taps
  (click a player to vote for them).
- `setCameraShot` eases between shots with `dt`; `"orbit"` is a slow turn for
  the briefing/reveal. `setPhase` changes lighting/atmosphere per phase.
- Performance: a handful of shadow-casting lights max; reuse geometries.

## ui.js (integrator) — thin HUD

Small overlay only (the 3D scene is the game): turn banner, discussion timer,
the pass-and-play **secret card** (tap to reveal), vote prompt, host subtitle
line, toasts, and the reveal panel. Kept minimal because `scene.js` carries the
visuals.

## main.js (integrator)

Wires the phase loop: `engine` drives state → `host` produces lines → `voice`
speaks them → `scene` animates → `ui` shows HUD; raycast taps on avatars become
`castVote`. `api.js` provides `ask`/`speak`/`transcribe` (BYOP).

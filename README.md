# Party Deduction — an AI host, secret traitors, one table

A **3D** social-deduction party game with an AI host. Everyone gets a secret role;
one or two players are **traitors** lying to the group. The host narrates every
beat **out loud**, hands out the roles, and reads the votes. Pass one device
around the room. The host pays with your own Pollen.

**Play:** https://guest453.github.io/party/

## How a game runs

1. **Set the table** — add 4–10 players (pass-and-play, one device).
2. **Briefing** — the host invents a scenario (location, cast, twists) and reads it aloud.
3. **Roles** — the device passes around; each player holds to reveal their secret role and objective. Traitors see a red warning.
4. **Rounds (×3)** — the host reveals a twist and speaks it; a discussion timer runs.
5. **Vote** — the device passes around again; each player taps someone at the table (or a name on the card) to vote.
6. **Result** — the host reads the votes aloud and the group's choice is eliminated.
7. **Reveal** — every role is shown; the crew wins if they voted out a traitor, otherwise the traitors win. **Play again — new story.**

The **roles, rounds, votes and winner are decided in code** (`engine.js`), so the
game is always fair; the host only narrates public facts and never leaks a
traitor before the reveal.

## The 3D table

`scene.js` builds a moody room with a round table and a seated avatar per player
(procedural, no assets), name cards, idle motion, per-phase lighting, a camera
that eases between shots (overview / focus / reveal / orbit), a vote token that
flies from voter to target, and role labels at the reveal.

## Voices

Every line is spoken with Pollinations TTS. The **host and each player get a
distinct voice** (`voice.js`), queued one at a time so nothing overlaps. The
host's line also appears as a subtitle.

## Layout

```text
index.html        page + title screen
src/main.js       integrator (phase loop, raycast taps -> votes)
src/api.js        Pollinations calls (BYOP sign-in, chat, TTS, STT)
src/engine.js     pure rules: players, roles, rounds, votes, winner
src/host.js       the AI host: scenario + narration text (validated, with a fallback)
src/voice.js      TTS queue + per-player voice casting
src/scene.js      the 3D room, avatars, camera, reveal
src/ui.js         thin HUD (turn banner, secret card, timer, vote, reveal)
dist/bundle.js    built output (esbuild + three)
```

## Build & test

```bash
npm install
npm run build
node --test test/party.test.mjs     # engine, host fallback, voice casting, scene
```

## Sign-in

Connect User Wallets (BYOP): "Connect Pollen" runs OAuth PKCE with the game's
publishable App Key; the returned `sk_` token is the player's own scoped key.
Nothing is billed until a round starts.

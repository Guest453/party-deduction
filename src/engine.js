// engine.js — pure game logic for the party deduction game.
// No DOM, no network, no timers. Deterministic via a seeded mulberry32 RNG.
//
// Phases: lobby -> briefing -> roles -> round -> vote -> result
//         (round -> vote -> result repeats ROUNDS times) -> reveal -> ended

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;
export const ROUNDS = 3;

const PHASES = [
  "lobby",
  "briefing",
  "roles",
  "round",
  "vote",
  "result",
  "reveal",
  "ended",
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Deterministic PRNG. Returns a function producing floats in [0, 1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function byId(game, id) {
  return game.players.find((p) => p.id === id) || null;
}

function isString(v) {
  return typeof v === "string" && v.length > 0;
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

/** 4-6 players -> 1 traitor, 7-10 -> 2. */
export function traitorCountFor(playerCount) {
  return playerCount >= 7 ? 2 : 1;
}

/** Create a fresh game in the lobby phase. */
export function createGame({ players, seed } = {}) {
  if (!Array.isArray(players)) {
    throw new TypeError("createGame: players must be an array");
  }
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new RangeError(
      `createGame: need ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${players.length}`
    );
  }

  const seen = new Set();
  const normalized = players.map((p, i) => {
    if (!p || !isString(p.id)) {
      throw new TypeError("createGame: every player needs a string id");
    }
    if (seen.has(p.id)) {
      throw new TypeError(`createGame: duplicate player id ${p.id}`);
    }
    seen.add(p.id);
    return {
      id: p.id,
      name: isString(p.name) ? p.name : String(p.id),
      seat: i,
      eliminated: false,
      roleName: null,
      blurb: null,
      traitor: false,
      objective: null,
    };
  });

  const safeSeed = Number.isFinite(seed) ? seed >>> 0 : 1;

  return {
    phase: "lobby",
    seed: safeSeed,
    rng: mulberry32(safeSeed),
    players: normalized,
    scenario: null,
    assigned: false,
    round: 0,
    twist: null,
    votes: {}, // voterId -> targetId
    votedOrder: [],
    lastTally: null,
    eliminated: [],
    result: null,
  };
}

/** Inject the host-authored scenario. */
export function setScenario(game, scenario) {
  if (!game) throw new TypeError("setScenario: no game");
  if (!scenario || typeof scenario !== "object") {
    throw new TypeError("setScenario: scenario must be an object");
  }
  if (!Array.isArray(scenario.roles) || scenario.roles.length < 5) {
    throw new TypeError("setScenario: scenario needs >= 5 roles");
  }
  if (!Array.isArray(scenario.twists) || scenario.twists.length < ROUNDS) {
    throw new TypeError(`setScenario: scenario needs >= ${ROUNDS} twists`);
  }
  scenario.roles.forEach((r, i) => {
    if (!r || !isString(r.name) || !isString(r.blurb)) {
      throw new TypeError(`setScenario: role ${i} needs name + blurb`);
    }
  });
  scenario.twists.forEach((t, i) => {
    if (!isString(t)) throw new TypeError(`setScenario: twist ${i} must be a string`);
  });

  game.scenario = {
    title: isString(scenario.title) ? scenario.title : "Untitled",
    premise: isString(scenario.premise) ? scenario.premise : "",
    location: isString(scenario.location) ? scenario.location : "",
    roles: scenario.roles.map((r) => ({ name: r.name, blurb: r.blurb })),
    twists: scenario.twists.slice(),
  };
  return game.scenario;
}

/** CODE picks the traitors and hands every player a secret role. */
export function assignRoles(game) {
  if (!game) throw new TypeError("assignRoles: no game");
  if (!game.scenario) throw new Error("assignRoles: no scenario set");

  const roles = game.scenario.roles;
  const count = traitorCountFor(game.players.length);

  // Reset the RNG so role assignment is reproducible from the seed.
  game.rng = mulberry32(game.seed);

  const order = shuffle(
    game.players.map((p) => p.id),
    game.rng
  );
  const traitorIds = new Set(order.slice(0, count));

  const roleOrder = shuffle(roles, game.rng);

  game.players.forEach((p, i) => {
    const role = roleOrder[i % roleOrder.length];
    const traitor = traitorIds.has(p.id);
    p.roleName = role.name;
    p.blurb = role.blurb;
    p.traitor = traitor;
    p.objective = traitor
      ? "Stay hidden, deflect suspicion, and get a crew member voted out."
      : "Work with the crew to identify and vote out every traitor before the final round.";
  });

  game.assigned = true;
  return game.players.map((p) => ({
    id: p.id,
    roleName: p.roleName,
    traitor: p.traitor,
  }));
}

/** Move into the briefing phase (roles are guaranteed assigned). */
export function beginBriefing(game) {
  if (!game) throw new TypeError("beginBriefing: no game");
  if (!game.assigned) assignRoles(game);
  game.phase = "briefing";
  return game.phase;
}

/** Start the next discussion round and pick that round's twist. */
export function beginRound(game) {
  if (!game) throw new TypeError("beginRound: no game");
  if (!game.assigned) assignRoles(game);
  if (game.round >= ROUNDS) return game.phase;

  game.round += 1;
  const twists = game.scenario ? game.scenario.twists : [];
  game.twist = twists.length ? twists[(game.round - 1) % twists.length] : null;
  game.votes = {};
  game.votedOrder = [];
  game.phase = "round";
  return game.phase;
}

/** The twist chosen for the current round (or null). */
export function currentTwist(game) {
  return game ? game.twist : null;
}

/** Open voting for the current round. */
export function openVote(game) {
  if (!game) throw new TypeError("openVote: no game");
  game.votes = {};
  game.votedOrder = [];
  game.phase = "vote";
  return game.phase;
}

/** Validate and record one vote. */
export function castVote(game, voterId, targetId) {
  if (!game) return { ok: false, error: "no game" };
  if (game.phase !== "vote") return { ok: false, error: "not in vote phase" };

  const voter = byId(game, voterId);
  if (!voter) return { ok: false, error: "unknown voter" };
  if (voter.eliminated) return { ok: false, error: "voter is eliminated" };

  const target = byId(game, targetId);
  if (!target) return { ok: false, error: "unknown target" };
  if (target.eliminated) return { ok: false, error: "target is eliminated" };

  if (voterId === targetId) return { ok: false, error: "cannot vote for self" };
  if (Object.prototype.hasOwnProperty.call(game.votes, voterId)) {
    return { ok: false, error: "already voted" };
  }

  game.votes[voterId] = targetId;
  game.votedOrder.push(voterId);
  return { ok: true };
}

/** Close voting, record the tally, and eliminate the chosen player. */
export function closeVote(game) {
  if (!game) throw new TypeError("closeVote: no game");
  if (game.phase !== "vote") return game.lastTally;

  const result = tally(game);
  game.lastTally = result;
  if (result.eliminatedId) {
    const p = byId(game, result.eliminatedId);
    if (p && !p.eliminated) {
      p.eliminated = true;
      game.eliminated.push(p.id);
    }
  }
  game.phase = "result";
  return result;
}

/** Count the current votes. */
export function tally(game) {
  const counts = new Map();
  if (game) {
    for (const voterId of Object.keys(game.votes)) {
      const targetId = game.votes[voterId];
      if (!byId(game, targetId)) continue;
      counts.set(targetId, (counts.get(targetId) || 0) + 1);
    }
  }

  const list = Array.from(counts.entries())
    .map(([targetId, votes]) => ({ targetId, votes }))
    .sort((a, b) => b.votes - a.votes || String(a.targetId).localeCompare(String(b.targetId)));

  const max = list.length ? list[0].votes : 0;
  const top = list.filter((c) => c.votes === max);
  const tied = max > 0 && top.length > 1;
  const eliminatedId = max > 0 && !tied ? top[0].targetId : null;

  return { counts: list, eliminatedId, tied };
}

/** Decide the winner. Crew win only if the eliminated player is a traitor. */
export function resolve(game) {
  if (!game) throw new TypeError("resolve: no game");
  const t = game.lastTally || tally(game);
  const eliminated = t.eliminatedId ? byId(game, t.eliminatedId) : null;
  const crewWon = !!(eliminated && eliminated.traitor);

  const result = {
    crewWon,
    traitorIds: game.players.filter((p) => p.traitor).map((p) => p.id),
    eliminatedId: t.eliminatedId,
  };
  game.result = result;
  return result;
}

/** Advance the state machine by exactly one phase. */
export function nextPhase(game) {
  if (!game) throw new TypeError("nextPhase: no game");

  switch (game.phase) {
    case "lobby":
      return beginBriefing(game);
    case "briefing":
      if (!game.assigned) assignRoles(game);
      game.phase = "roles";
      return game.phase;
    case "roles":
      return beginRound(game);
    case "round":
      return openVote(game);
    case "vote":
      closeVote(game);
      return game.phase;
    case "result":
      if (game.round < ROUNDS) return beginRound(game);
      game.phase = "reveal";
      resolve(game);
      return game.phase;
    case "reveal":
      game.phase = "ended";
      return game.phase;
    case "ended":
    default:
      return game.phase;
  }
}

/** Safe public snapshot — never contains any secret. */
export function publicState(game) {
  if (!game) return null;
  const scenario = game.scenario
    ? {
        title: game.scenario.title,
        premise: game.scenario.premise,
        location: game.scenario.location,
      }
    : null;

  const counts = game.lastTally
    ? game.lastTally.counts.map((c) => ({ targetId: c.targetId, votes: c.votes }))
    : tally(game).counts;

  const revealed = game.phase === "reveal" || game.phase === "ended";

  return {
    phase: game.phase,
    round: game.round,
    totalRounds: ROUNDS,
    scenario,
    twist: game.twist,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      eliminated: p.eliminated,
    })),
    votes: Object.keys(game.votes).map((voterId) => ({
      voterId,
      targetId: game.votes[voterId],
    })),
    counts,
    eliminated: game.eliminated.slice(),
    eliminatedId: game.lastTally ? game.lastTally.eliminatedId : null,
    tied: game.lastTally ? game.lastTally.tied : false,
    winner: revealed && game.result ? (game.result.crewWon ? "crew" : "traitors") : null,
    revealed: revealed
      ? game.players.map((p) => ({ id: p.id, roleName: p.roleName }))
      : null,
  };
}

/** A single player's secret card. */
export function secretFor(game, playerId) {
  if (!game) return null;
  const p = byId(game, playerId);
  if (!p) return null;
  return {
    roleName: p.roleName,
    blurb: p.blurb,
    traitor: p.traitor,
    objective: p.objective,
  };
}

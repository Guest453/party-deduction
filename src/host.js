// host.js — the AI host (text only).
//
// The host owns the WORDS: it invents the scenario and narrates every beat.
// It never owns the RULES (engine.js does) and never learns a secret that the
// table has not been told. Every model call goes through the injected `ask`,
// so this module performs no network I/O of its own.

const DEFAULT_MODEL = "openai/gpt-5.4-nano";

const MIN_ROLES = 5; // engine requires >= 5 roles
const MIN_TWISTS = 3; // engine requires >= ROUNDS twists

// ---------------------------------------------------------------------------
// Text hygiene
// ---------------------------------------------------------------------------

// Strip code fences, markdown, stray quotes; collapse whitespace; keep at most
// `maxSentences` sentences so every spoken line stays short.
function sanitize(text, maxSentences = 2) {
  if (typeof text !== "string") return "";
  let t = text;
  t = t.replace(/```[a-zA-Z]*/g, " ").replace(/```/g, " ");
  t = t.replace(/^\s*["'`\u201c\u201d]+/, "").replace(/["'`\u201c\u201d]+\s*$/, "");
  t = t.replace(/[*_#>`~]/g, "");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const sentences = t.match(/[^.!?]+[.!?]*/g) || [t];
  return sentences.slice(0, maxSentences).join(" ").trim();
}

// ---------------------------------------------------------------------------
// Defensive JSON parsing
// ---------------------------------------------------------------------------

// Pull the first balanced {...} out of a model reply, tolerating code fences,
// prose around the object, and trailing commas.
function extractJson(text) {
  if (typeof text !== "string") return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const start = t.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = t.slice(start, i + 1);
        const parsed = tryParse(slice);
        if (parsed) return parsed;
        return null;
      }
    }
  }
  return tryParse(t.slice(start));
}

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(s.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Scenario validation
// ---------------------------------------------------------------------------

function asText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Returns a clean scenario object, or null if the shape is unusable.
function validateScenario(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;

  const title = asText(obj.title);
  const premise = asText(obj.premise);
  const location = asText(obj.location);
  if (!title || !premise || !location) return null;

  if (!Array.isArray(obj.roles) || obj.roles.length < MIN_ROLES) return null;
  const roles = [];
  for (const role of obj.roles) {
    if (!role || typeof role !== "object") return null;
    const name = asText(role.name);
    const blurb = asText(role.blurb ?? role.description ?? role.text);
    if (!name || !blurb) return null;
    roles.push({ name, blurb });
  }

  if (!Array.isArray(obj.twists) || obj.twists.length < MIN_TWISTS) return null;
  const twists = [];
  for (const twist of obj.twists) {
    const line = asText(twist);
    if (!line) return null;
    twists.push(line);
  }

  return { title, premise, location, roles, twists };
}

// ---------------------------------------------------------------------------
// Built-in fallback scenario — used only when the model output is unusable.
// ---------------------------------------------------------------------------

function fallbackScenario() {
  return {
    title: "The Gala at Ravenhollow",
    premise:
      "The annual masquerade at Ravenhollow Manor ends in horror when the host, " +
      "Lord Ashcombe, is found dead inside the locked conservatory. The doors were " +
      "barred from within, the storm has sealed the estate, and every guest at the " +
      "table had a reason to want him gone. Until the killers are unmasked, nobody " +
      "leaves Ravenhollow.",
    location: "Ravenhollow Manor, a storm-lashed estate on the cliffs",
    roles: [
      {
        name: "Mrs. Coyle",
        blurb:
          "The housekeeper who knows every key in the house, every locked door, " +
          "and every secret the family thought it had buried.",
      },
      {
        name: "Dr. Fenwick",
        blurb:
          "The family physician, steady and unreadable at the sight of blood — " +
          "perhaps a little too steady.",
      },
      {
        name: "Lady Ashcombe",
        blurb:
          "The widow, poised in black, whose grief never quite reaches her eyes.",
      },
      {
        name: "Teddy Vance",
        blurb:
          "The heir's charming, reckless best friend, a racing driver drowning in " +
          "debts he cannot repay.",
      },
      {
        name: "Inspector Hale",
        blurb:
          "A retired detective who arrived uninvited and has spent the whole night " +
          "watching everyone at the table.",
      },
      {
        name: "Miss Orla Quinn",
        blurb:
          "The young pianist who played straight through the scream and swears she " +
          "heard nothing at all.",
      },
    ],
    twists: [
      "The storm has torn down the telephone line and flooded the causeway: no one " +
        "is coming, and no one can leave.",
      "The lights fail for a full minute; when they come back, a second chair at the " +
        "table is empty.",
      "A torn letter is found beneath the table, and half the guests recognise the " +
        "handwriting.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Public-fact helpers
// ---------------------------------------------------------------------------

// Resolve an id to a display name using only public context. Tolerates
// `players` as an array of names or of { id, name } objects.
function nameOf(ctx, id) {
  if (id == null) return "someone";
  const players = ctx && ctx.players;
  if (Array.isArray(players)) {
    for (const p of players) {
      if (p && typeof p === "object") {
        if (String(p.id) === String(id)) return String(p.name ?? p.id);
      } else if (String(p) === String(id)) {
        return String(p);
      }
    }
  }
  if (ctx && ctx.names && typeof ctx.names === "object" && ctx.names[id] != null) {
    return String(ctx.names[id]);
  }
  return String(id);
}

// A compact, public-only summary we hand to the model.
function publicFacts(ctx) {
  const out = {};
  if (!ctx || typeof ctx !== "object") return out;
  for (const key of ["phase", "round", "twist", "counts", "playerCount", "eliminatedId"]) {
    if (ctx[key] !== undefined) out[key] = ctx[key];
  }
  if (Array.isArray(ctx.players)) {
    out.players = ctx.players.map((p) =>
      p && typeof p === "object" ? String(p.name ?? p.id) : String(p),
    );
  } else if (ctx.names && typeof ctx.names === "object") {
    out.players = Object.values(ctx.names).map(String);
  }
  return out;
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const SCENARIO_SYSTEM = [
  "You are the game master for a social-deduction party game played in one room.",
  "You invent a vivid, self-contained mystery scenario.",
  "Reply with STRICT JSON and nothing else: no prose, no markdown, no code fences.",
  "The JSON must have exactly this shape:",
  '{"title":string,"premise":string,"location":string,',
  '"roles":[{"name":string,"blurb":string}],"twists":[string]}',
  `Provide at least ${MIN_ROLES} roles and at least ${MIN_TWISTS} twists.`,
  "Every role is a distinct, memorable character a player can inhabit.",
  "Twists are escalating complications revealed across rounds; they must never",
  "name or hint at which character is a traitor.",
  "All values are plain strings. Output only the JSON object.",
].join(" ");

const HOST_SYSTEM = [
  "You are the host of a social-deduction party game, speaking aloud to the players.",
  "You know ONLY the public facts you are given: never invent secrets.",
  "You must NEVER reveal, hint at, or speculate about who the traitors are before the reveal.",
  "Never name a player as suspicious or trustworthy unless the given facts say so.",
  "Speak in character, warm and a little theatrical, but stay concise.",
  "Reply with 1 to 2 short sentences of plain text, written to be spoken aloud.",
  "No markdown, no lists, no stage directions, no quotation marks, no emoji.",
  "Output only the spoken line.",
].join(" ");

// ---------------------------------------------------------------------------
// Fallback narration (so a failed model call never breaks the game)
// ---------------------------------------------------------------------------

function fallbackLine(beat, ctx) {
  const round = ctx && ctx.round != null ? ctx.round : 1;
  switch (beat) {
    case "deal":
      return ctx && ctx.player
        ? `${ctx.player} takes a card, reads it, and looks away. Nobody sees another's role.`
        : "The roles are dealt, one by one.";
    case "vote-cast":
      return ctx && ctx.voter && ctx.target
        ? `${ctx.voter} votes for ${ctx.target}.`
        : "A vote is cast.";
    case "welcome":
      return "Welcome, everyone. Take your seats, the doors are shut, and the story begins now.";
    case "briefing":
      return "Listen closely: in this place every guest keeps a secret, and at least one of you is lying. Trust no one completely.";
    case "twist":
      return ctx && ctx.twist
        ? `Here is the twist: ${ctx.twist}`
        : "Something has changed, and the ground just shifted under us.";
    case "discussion":
      return `Round ${round}. Talk it over, and mind what people say as much as what they avoid.`;
    case "vote":
      return "The time has come. Cast your vote, and choose carefully.";
    case "result":
      return "The votes are counted. Let us see whom the table has chosen.";
    default:
      return "The story continues. Stay sharp.";
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHost({ ask, model = DEFAULT_MODEL } = {}) {
  const call = typeof ask === "function" ? ask : async () => "";

  async function askLine(system, user) {
    try {
      const raw = await call({ system, user, model });
      return sanitize(raw, 2);
    } catch {
      return "";
    }
  }

  // --- scenario -------------------------------------------------------------

  async function scenario({ playerCount, seedHint } = {}) {
    const count = Number(playerCount) || MIN_ROLES;
    const want = Math.max(MIN_ROLES, Math.min(10, count));
    const hint = seedHint == null ? "none" : String(seedHint);
    const base =
      `Invent a new mystery scenario for ${want} players. ` +
      `Use the seed hint for flavour: ${hint}. ` +
      `Return the JSON object only.`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const user =
        attempt === 0
          ? base
          : `${base} Your previous reply was not valid JSON. Reply with ONLY the JSON object and no other text.`;
      let raw = "";
      try {
        raw = await call({ system: SCENARIO_SYSTEM, user, model });
      } catch {
        raw = "";
      }
      const valid = validateScenario(extractJson(raw));
      if (valid) return valid;
    }

    return fallbackScenario();
  }

  // --- narration beats ------------------------------------------------------

  async function narrate(beat, ctx = {}) {
    const facts = publicFacts(ctx);
    const user =
      `Narrate the "${beat}" beat of the game. ` +
      `Public facts (the only things you know): ${JSON.stringify(facts)}. ` +
      `Write the host's spoken line.`;

    const line = await askLine(HOST_SYSTEM, user);
    if (line) return line;
    return fallbackLine(beat, ctx);
  }

  // --- reading the votes ----------------------------------------------------
  // Votes are public facts, so this is built deterministically: the spoken
  // result must match the tally exactly, with no chance of a model slip.

  async function readVotes(tally, ctx = {}) {
    const counts = tally && Array.isArray(tally.counts) ? tally.counts : [];
    const lines = [];

    if (counts.length) {
      const parts = counts.map((c) => {
        const votes = Number(c && c.votes) || 0;
        return `${nameOf(ctx, c && c.targetId)} receives ${votes} vote${votes === 1 ? "" : "s"}`;
      });
      lines.push(`The votes are in: ${parts.join(", ")}.`);
    } else {
      lines.push("No votes were cast.");
    }

    if (tally && tally.eliminatedId != null) {
      lines.push(`${nameOf(ctx, tally.eliminatedId)} is eliminated.`);
    } else if (tally && tally.tied) {
      lines.push("The vote is tied, so no one is eliminated.");
    } else {
      lines.push("With no clear majority, no one is eliminated.");
    }

    return lines.join(" ");
  }

  // --- the closing reveal ---------------------------------------------------

  async function reveal(result, ctx = {}) {
    const traitorIds = result && Array.isArray(result.traitorIds) ? result.traitorIds : [];
    const traitors = traitorIds.map((id) => nameOf(ctx, id));
    const crewWon = !!(result && result.crewWon);

    const traitorText = traitors.length
      ? traitors.join(" and ")
      : "no one at all";
    const outcome = crewWon
      ? "The crew has won: the traitors were caught and the table survives."
      : "The traitors have won: they slipped the noose and walked away unpunished.";
    const factual = `The traitors were ${traitorText}. ${outcome}`;

    const user =
      `Deliver the closing reveal of the game. ` +
      `Public facts (the only things you know): ${JSON.stringify(publicFacts(ctx))}. ` +
      `The traitors were: ${traitorText}. ` +
      `Winners: ${crewWon ? "the crew" : "the traitors"}. ` +
      `Name the traitors, say who won, and close the story.`;

    const line = await askLine(HOST_SYSTEM, user);
    return line || factual;
  }

  return { scenario, narrate, readVotes, reveal };
}

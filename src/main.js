// Party Deduction — integrator. Drives the phase loop: engine state -> host text
// -> voice -> scene + HUD. The engine owns the rules; the host owns the words.

import * as THREE from "three";
import { api } from "./api.js";
import * as engine from "./engine.js";
import { createHost } from "./host.js";
import { createVoice } from "./voice.js";
import { createScene } from "./scene.js";
import { createUI } from "./ui.js";
import { createDebug } from "./debug.js";
import { createBanter } from "./banter.js";
import { createAudio } from "./audio.js";

const $ = (id) => document.getElementById(id);
const banner = $("banner");
let bannerTimer = null;
function showError(message) {
    debug.log("ERR " + message);
    banner.textContent = message;
    banner.classList.remove("hidden");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.add("hidden"), 9000);
}

// ---------------------------------------------------------------- world

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
const scene3d = createScene(canvas, THREE);

const game = { g: null, roster: [], custom: { rounds: 3, traitorCount: 0, story: "", genre: "", pace: "normal", sides: {} }, seed: 0, voices: {}, revealIndex: 0, voteOrder: [], voteIndex: 0, entered: false, transcript: [], speakingId: null, banterIndex: 0, banterRunning: false, thinking: false };

let voiceFailedShown = false;
const voice = createVoice({
    onError: (err) => {
        if (voiceFailedShown) return;
        voiceFailedShown = true;
        showError(`Voice failed: ${err && err.message ? err.message : err}`);
    },
    speak: (text, v) => api.speak(text, v),
    transcribe: (blob) => api.transcribe(blob),
    onLine: (text) => ui.render({ ...view, subtitle: text, subtitleWho: game.voices.hostName ?? "Host" }),
});

const ui = createUI({ mount: document.body, on: handleEvent });
const debug = createDebug();
const audio = createAudio();
const banter = createBanter({ ask: (req) => api.ask(req), model: api.model });
const host = createHost({ ask: (req) => api.ask(req), model: api.model });

// ---------------------------------------------------------------- view

let view = {};

function alivePlayers() {
    return game.g ? game.g.players.filter((p) => !p.eliminated) : [];
}

function buildView() {
    const busy = { thinking: game.thinking, speaking: voice.isSpeaking(), queue: voice.queue() };
    if (!game.entered) {
        // Still on the title screen: render nothing over it.
        return { phase: "" };
    }
    if (!game.g) {
        return {
            phase: "lobby",
            card: {
                kind: "lobby",
                players: game.roster,
                minPlayers: engine.MIN_PLAYERS,
                maxPlayers: engine.MAX_PLAYERS,
                custom: game.custom,
                defaultRounds: engine.ROUNDS,
            },
        };
    }
    const pub = engine.publicState(game.g);
    const base = { phase: pub.phase, round: pub.round, totalRounds: pub.totalRounds, busy };

    if (pub.phase === "briefing") {
        return { ...base, subtitleWho: "Host", subtitle: game.briefLine ?? "The story begins…" };
    }
    if (pub.phase === "roles") {
        // The roles are dealt on screen and never shown — watch the cutscene.
        return { ...base, subtitleWho: "Host", subtitle: game.dealLine ?? "The roles are dealt, one by one. Nobody sees another's card." };
    }
    if (pub.phase === "round") {
        const last = game.transcript[game.transcript.length - 1];
        const speaking = game.speakingId ? game.g.players.find((p) => p.id === game.speakingId) : null;
        return {
            ...base,
            subtitleWho: speaking ? speaking.name : "Host",
            subtitle: last ? last.line : pub.twist,

        };
    }
    if (pub.phase === "vote") {
        const voter = game.voteOrder[game.voteIndex];
        const player = game.g.players.find((p) => p.id === voter);
        return {
            ...base,
            voteHint: `${Math.max(0, game.voteOrder.length - game.voteIndex)} vote(s) left`,
            subtitleWho: player ? player.name : "Host",
            subtitle: game.voteLine ?? `${player ? player.name : "Someone"} is voting…`,
        };
    }
    if (pub.phase === "result") {
        return { ...base, subtitleWho: "Host", subtitle: game.resultLine ?? "The votes are counted…" };
    }
    if (pub.phase === "reveal" || pub.phase === "ended") {
        const revealed = pub.revealed ?? [];
        const byId = new Map(revealed.map((r) => [r.id, r.roleName]));
        const traitors = new Set(game.g.players.filter((p) => p.traitor).map((p) => p.id));
        return {
            ...base,
            card: {
                kind: "reveal",
                crewWon: pub.winner === "crew",
                players: game.g.players.map((p) => ({ name: p.name, roleName: byId.get(p.id) ?? p.roleName, traitor: traitors.has(p.id) })),
            },
        };
    }
    return base;
}

function refresh() {
    audio.setPhase(game.g ? engine.publicState(game.g).phase : "lobby");
    view = buildView();
    ui.render(view);
    const pub = game.g ? engine.publicState(game.g) : null;
    debug.set({
        build: (new URL(import.meta.url).searchParams.get("v") || "dev"),
        entered: game.entered,
        phase: pub ? pub.phase : "(none)",
        round: pub ? pub.round : "-",
        players: game.g ? game.g.players.length : game.roster.length,
        seats: scene3d.avatarObjects ? scene3d.avatarObjects().length : "?",
        revealIndex: game.revealIndex,
        voteIndex: game.voteIndex,
        voteOrder: game.voteOrder.length,
        voter: game.voteOrder[game.voteIndex] ?? "-",
        voices: Object.keys(game.voices || {}).length,
        queue: voice.queue(),
        speaking: voice.isSpeaking(),
    });
}

// ---------------------------------------------------------------- flow

function startGame(seed) {
    game.seed = seed ?? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    game.g = engine.createGame({
        players: game.roster.map((p) => ({ id: p.id, name: p.name })),
        seed: game.seed,
        rounds: game.custom.rounds,
        traitorCount: game.custom.traitorCount || null,
        personalities: game.roster.map((p) => p.personality || ""),
        traitors: game.roster.map((p) => (p.side === "traitor" ? true : p.side === "innocent" ? false : null)),
    });
    game.revealIndex = 0;
    game.voteIndex = 0;
    game.voteOrder = [];
    game.voices = voice.casting(game.roster.length);
    scene3d.setPlayers(game.roster.map((p) => ({ id: p.id, name: p.name })));
    scene3d.setCameraShot("overview");
    refresh();

    (async () => {
        try {
            const scenario = await host.scenario({
                playerCount: game.roster.length,
                seedHint: String(game.seed),
                story: game.custom.story || "",
                genre: game.custom.genre || "",
            });
            engine.setScenario(game.g, scenario);
            engine.assignRoles(game.g);
            engine.beginBriefing(game.g);
            scene3d.setPhase("briefing");
            refresh();
            const line = await host.narrate("briefing", publicCtx());
            game.briefLine = line;
            voice.say(line, game.voices.host);
            await waitForVoice();
            playDealCutscene(); // auto: deal the roles, then round 1
        } catch (error) {
            showError(error.message);
        }
    })();
}

function publicCtx() {
    const pub = engine.publicState(game.g);
    return {
        phase: pub.phase,
        round: pub.round,
        twist: pub.twist,
        location: pub.scenario?.location,
        title: pub.scenario?.title,
        players: game.g.players.map((p) => ({ id: p.id, name: p.name })),
    };
}

function beginRound() {
    engine.beginRound(game.g);
    debug.log("beginRound -> round " + game.g.round);
    scene3d.setPhase("round");
    scene3d.setCameraShot("orbit");
    game.transcript = [];
    game.banterIndex = 0;
    refresh();
    const twist = engine.currentTwist(game.g);
    game.thinking = true;
    refresh();
    host
        .narrate("twist", { ...publicCtx(), twist })
        .then((line) => {
            game.thinking = false;
            voice.say(line, game.voices.host);
            return waitForVoice().then(() => runDiscussion());
        })
        .catch(() => {
            game.thinking = false;
            runDiscussion();
        });
}

// Each AI player takes a turn: they speak in character, accuse, or defend.
async function runDiscussion() {
    if (game.banterRunning) return;
    game.banterRunning = true;
    try {
        const order = alivePlayers();
        for (let i = 0; i < order.length; i++) {
            const p = order[i];
            game.banterIndex = i;
            game.speakingId = p.id;
            scene3d.highlight(p.id);
            scene3d.setCameraShot(`focus:${p.id}`);
            refresh();
            await sleep(PACE_MS[game.custom.pace] ?? 650); // paced beat before they speak
            const secret = engine.secretFor(game.g, p.id);
            const text = await banter.speak({
                name: p.name,
                roleName: secret.roleName,
                objective: secret.objective,
                traitor: secret.traitor,
                location: game.g.scenario?.location ?? "the table",
                twist: engine.currentTwist(game.g),
                round: game.g.round,
                transcript: game.transcript,
                personality: secret.personality || "",
            });
            game.transcript.push({ name: p.name, line: text });
            voice.say(text, game.voices.players[i] ?? game.voices.host);
            refresh();

            // Reaction shot: if they named someone, cut to that person's face.
            const accused = alivePlayers().find(
                (q) => q.id !== p.id && text.toLowerCase().includes(q.name.toLowerCase().split(" ")[0]),
            );
            if (accused) {
                await waitForVoice(text);
                scene3d.highlight(accused.id);
                scene3d.setCameraShot(`focus:${accused.id}`);
                refresh();
                await sleep(1100); // hold on the accused
            } else {
                await waitForVoice(text);
            }
        }
    } finally {
        game.banterRunning = false;
        game.speakingId = null;
        scene3d.setCameraShot("overview");
        scene3d.highlight(null);
        refresh();
    }
    // auto: the discussion ends and the table votes
    if (game.g && game.g.phase === "round") openVote();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until the queue has drained (and a small beat) so turns feel paced.
function waitForVoice() {
    return new Promise((resolve) => {
        const started = Date.now();
        const check = () => {
            const busy = voice.isSpeaking() || voice.queue() > 0;
            if (!busy && Date.now() - started > 400) resolve();
            else if (Date.now() - started > 20000) resolve(); // never hang
            else setTimeout(check, 220);
        };
        setTimeout(check, 400);
    });
}

// The host deals each player a card on screen; each looks at it and looks away.
async function playDealCutscene() {
    engine.nextPhase(game.g); // briefing -> roles (assign done)
    scene3d.setPhase("roles");
    scene3d.setCameraShot("orbit");
    refresh();
    try {
        const line = await host.narrate("roles", publicCtx());
        game.dealLine = line;
        voice.say(line, game.voices.host);
        await waitForVoice();
        for (let i = 0; i < game.g.players.length; i++) {
            const p = game.g.players[i];
            scene3d.setCameraShot(`focus:${p.id}`);
            scene3d.highlight(p.id);
            scene3d.dealCard(p.id);
            game.thinking = true;
            refresh();
            const beat = await host.narrate("deal", { ...publicCtx(), player: p.name });
            game.thinking = false;
            game.dealLine = beat;
            refresh();
            voice.say(beat, game.voices.host);
            await waitForVoice();
        }
        scene3d.highlight(null);
    } finally {
        engine.nextPhase(game.g); // roles -> round
        beginRound();
    }
}

function openVote() {
    engine.openVote(game.g);
    debug.log("openVote, voters=" + alivePlayers().length);
    game.voteOrder = alivePlayers().map((p) => p.id);
    game.voteIndex = 0;
    scene3d.setPhase("vote");
    refresh();
    host.narrate("vote", publicCtx()).then((line) => voice.say(line, game.voices.host)).catch(() => {});
    runAutoVote();
}

// Every alive player votes on their own: traitors pick an innocent, innocents
// pick the most suspicious. The host reads the result.
async function runAutoVote() {
    const alive = () => alivePlayers();
    while (game.g.phase === "vote") {
        const voterId = game.voteOrder[game.voteIndex];
        const voter = game.g.players.find((p) => p.id === voterId);
        if (!voter) break;
        scene3d.setCameraShot(`focus:${voterId}`);
        scene3d.highlight(voterId);
        const others = alive().filter((p) => p.id !== voterId);
        if (!others.length) break;
        // policy: a traitor avoids other traitors; everyone targets whoever most
        // recently named them in the transcript, else a neighbour.
        const traitorIds = new Set(game.g.players.filter((p) => p.traitor).map((p) => p.id));
        let pool = others;
        if (voter.traitor) pool = others.filter((p) => !traitorIds.has(p.id));
        if (!pool.length) pool = others;
        const named = game.transcript.slice().reverse().find((t) => t.line && t.line.includes(voter.name));
        const target =
            (named && pool.find((p) => p.name === named.name)) ||
            pool[Math.floor(Math.random() * pool.length)];
        engine.castVote(game.g, voterId, target.id);
        scene3d.vote(voterId, target.id);
        game.thinking = true;
        refresh();
        const line = await host.narrate("vote-cast", { ...publicCtx(), voter: voter.name, target: target.name });
        game.thinking = false;
        game.voteLine = line;
        refresh();
        voice.say(line, game.voices.host);
        game.voteIndex += 1;
        await waitForVoice();
        refresh();
    }
    scene3d.highlight(null);
    afterVote();
}

function afterVote() {
    const tally = engine.closeVote(game.g); // sets phase -> result, eliminates
    scene3d.setPhase("result");
    if (tally?.eliminatedId) {
        const out = game.g.players.find((p) => p.id === tally.eliminatedId);
        scene3d.setCameraShot(`focus:${tally.eliminatedId}`);
        scene3d.highlight(tally.eliminatedId);
        scene3d.setTimeScale(0.28); // slow motion on the reveal
        audio.sting();
        if (out) ui.flash(`${out.name} is out`); // the gasp
        scene3d.eliminate(tally.eliminatedId);
        setTimeout(() => scene3d.setTimeScale(1), 1600);
    } else {
        ui.flash("A tie — no one is out");
    }
    refresh();
    host
        .readVotes(tally, publicCtx())
        .then((line) => {
            game.resultLine = line;
            voice.say(line, game.voices.host);
            return waitForVoice();
        })
        .then(() => {
            if (game.g && game.g.phase === "result") nextPhase(); // auto: next round / reveal
        })
        .catch(() => {
            if (game.g && game.g.phase === "result") nextPhase();
        });
}

function nextPhase() {
    const g = game.g;
    if (g.phase === "result") {
        if (g.round >= engine.ROUNDS) {
            engine.nextPhase(g); // -> reveal
            scene3d.setPhase("reveal");
            scene3d.setCameraShot("reveal");
            scene3d.revealRoles(g.players.map((p) => ({ id: p.id, roleName: p.roleName, traitor: p.traitor })));
            refresh();
            host.reveal(engine.resolve(g), publicCtx()).then((line) => voice.say(line, game.voices.host)).catch(() => {});
        } else {
            beginRound();
        }
        return;
    }
}

function handleEvent(event, value) {
    const g = game.g;
    switch (event) {
        case "add-player":
            if (game.roster.length < engine.MAX_PLAYERS) {
                game.roster.push({ id: `p${Date.now()}${game.roster.length}`, name: String(value).slice(0, 16), personality: "" });
                refresh();
            }
            break;
        case "rename-player": {
            const r = game.roster.find((x) => x.id === value.id);
            if (r) r.name = String(value.name || r.name).slice(0, 16);
            refresh();
            break;
        }
        case "set-personality": {
            const r = game.roster.find((x) => x.id === value.id);
            if (r) r.personality = String(value.personality || "").slice(0, 120);
            refresh();
            break;
        }
        case "set-custom": {
            game.custom = { ...game.custom, ...value };
            refresh();
            break;
        }
        case "remove-player":
            game.roster = game.roster.filter((p) => p.id !== value);
            refresh();
            break;
        case "start":
            if (game.roster.length < engine.MIN_PLAYERS) return showError(`Need at least ${engine.MIN_PLAYERS} players.`);
            startGame();
            break;
        case "roles": {
            playDealCutscene();
            break;
        }
        case "begin-round":
            beginRound();
            break;
        case "start-vote":
            openVote();
            break;
        case "cast-vote": {
            const voter = game.voteOrder[game.voteIndex];
            if (value.voterId !== voter) return; // ignore stray/duplicate taps
            const res = engine.castVote(g, value.voterId, value.targetId);
            if (!res.ok) return showError(res.error ?? "Vote not counted.");
            scene3d.vote(value.voterId, value.targetId);
            game.voteIndex += 1;
            if (game.voteIndex >= game.voteOrder.length) {
                afterVote(); // everyone has voted -> close, tally, narrate
            } else {
                const next = game.voteOrder[game.voteIndex];
                scene3d.setCameraShot(`focus:${next}`);
                scene3d.highlight(next);
                refresh();
            }
            break;
        }
        case "next":
            nextPhase();
            break;
        case "replay":
            game.g = null;
            startGame();
            break;
        case "replay-same":
            startGame(game.seed);
            break;
        default:
            break;
    }
}

// ---------------------------------------------------------------- taps -> votes

const raycaster = new THREE.Raycaster();
canvas.addEventListener("click", (event) => {
    const g = game.g;
    if (!g || g.phase !== "vote") return;
    const targets = scene3d.avatarObjects?.() ?? [];
    if (!targets.length) return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, scene3d.camera());
    const hits = raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
        let node = hit.object;
        while (node && !node.userData.playerId) node = node.parent;
        if (node?.userData.playerId) {
            const voter = game.voteOrder[game.voteIndex];
            if (node.userData.playerId !== voter) handleEvent("cast-vote", { voterId: voter, targetId: node.userData.playerId });
            return;
        }
    }
});

// ---------------------------------------------------------------- custom screen

const PACE_MS = { brisk: 350, normal: 650, dramatic: 1100 };

function renderCast() {
    const wrap = document.getElementById("cast");
    if (!wrap) return;
    wrap.innerHTML = "";
    for (const p of game.roster) {
        const row = document.createElement("div");
        row.className = "row1";
        const name = document.createElement("input");
        name.type = "text";
        name.value = p.name;
        name.maxLength = 16;
        name.onchange = () => { p.name = name.value.trim() || p.name; };
        const pers = document.createElement("input");
        pers.type = "text";
        pers.value = p.personality || "";
        pers.placeholder = "personality — e.g. nervous and over-explains";
        pers.maxLength = 120;
        pers.onchange = () => { p.personality = pers.value.trim(); };
        const side = document.createElement("select");
        for (const [v, label] of [["auto", "Any side"], ["innocent", "Innocent"], ["traitor", "Traitor"]]) {
            const o = document.createElement("option");
            o.value = v;
            o.textContent = label;
            side.appendChild(o);
        }
        side.value = p.side || "auto";
        side.onchange = () => { p.side = side.value; };
        const del = document.createElement("button");
        del.className = "del";
        del.textContent = "×";
        del.onclick = () => { game.roster = game.roster.filter((x) => x.id !== p.id); renderCast(); };
        row.append(name, pers, side, del);
        wrap.appendChild(row);
    }
}

function openCustom() {
    const screen = document.getElementById("custom");
    if (!screen) return;
    if (game.roster.length === 0) {
        for (const n of ["Ada", "Bo", "Cy", "Dee"]) {
            game.roster.push({ id: `p${Date.now()}${game.roster.length}`, name: n, personality: "", side: "auto" });
        }
    }
    document.getElementById("c-story").value = game.custom.story || "";
    document.getElementById("c-genre").value = game.custom.genre || "";
    document.getElementById("c-rounds").value = String(game.custom.rounds || 3);
    document.getElementById("c-traitors").value = String(game.custom.traitorCount ?? 0);
    document.getElementById("c-pace").value = game.custom.pace || "normal";
    renderCast();
    screen.classList.remove("hidden");
}

function closeCustom() {
    document.getElementById("custom")?.classList.add("hidden");
}

function readCustom() {
    game.custom.story = document.getElementById("c-story").value.trim();
    game.custom.genre = document.getElementById("c-genre").value;
    game.custom.rounds = Math.max(1, Math.min(8, Number(document.getElementById("c-rounds").value) || 3));
    game.custom.traitorCount = Math.max(0, Math.min(5, Number(document.getElementById("c-traitors").value) || 0));
    game.custom.pace = document.getElementById("c-pace").value || "normal";
    // side -> forcedTraitor flag for the engine
    game.custom.sides = {};
    for (const p of game.roster) game.custom.sides[p.id] = p.side;
}

document.getElementById("splash-custom")?.addEventListener("click", openCustom);
document.getElementById("custom-back")?.addEventListener("click", closeCustom);
document.getElementById("cast-add")?.addEventListener("click", () => {
    if (game.roster.length >= engine.MAX_PLAYERS) return;
    game.roster.push({ id: `p${Date.now()}${game.roster.length}`, name: `Player ${game.roster.length + 1}`, personality: "", side: "auto" });
    renderCast();
});
document.getElementById("custom-start")?.addEventListener("click", () => {
    if (!api.signedIn()) return showError("Connect Pollen first — the host speaks with your own Pollen.");
    if (game.roster.length < engine.MIN_PLAYERS) return showError(`Need at least ${engine.MIN_PLAYERS} players.`);
    readCustom();
    closeCustom();
    game.customMode = true;
    startShow();
});

// ---------------------------------------------------------------- splash + auth

$("splash-connect").addEventListener("click", () => api.connect().catch((e) => showError(e.message)));
function startShow() {
    game.entered = true;
    audio.start(); // needs the user gesture
    voice.unlock(); // prime the audio element
    $("splash").classList.add("leaving");
    document.getElementById("custom")?.classList.add("hidden");
    setTimeout(() => {
        $("splash").classList.add("hidden");
        scene3d.setCameraShot("overview");
        startGame();
    }, 700);
}

$("splash-start").addEventListener("click", () => {
    if (!api.signedIn()) return showError("Connect Pollen first — the host speaks with your own Pollen.");
    game.customMode = false;
    // quick game: the default cast if none was set up
    if (game.roster.length === 0) {
        for (const n of ["Ada", "Bo", "Cy", "Dee", "Eli"]) {
            game.roster.push({ id: `p${Date.now()}${game.roster.length}`, name: n, personality: "", side: "auto" });
        }
    }
    startShow();
});

(async () => {
    try {
        await api.handleCallback();
    } catch (error) {
        showError(error.message);
    }
    $("splash-start").disabled = false;
    $("splash-hint").textContent = api.signedIn() ? "Connected. Set up the table when ready." : "Sign in to begin — you pay with your own Pollen.";
})();

// ---------------------------------------------------------------- resize + loop

function syncCanvas() {
    if (typeof scene3d.resize === "function") scene3d.resize(window.innerWidth, window.innerHeight);
}
addEventListener("resize", syncCanvas);
addEventListener("orientationchange", syncCanvas);
syncCanvas();
refresh();

let last = performance.now();
function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    scene3d.update(dt);
    requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

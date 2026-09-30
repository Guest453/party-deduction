// Party Deduction — integrator. Drives the phase loop: engine state -> host text
// -> voice -> scene + HUD. The engine owns the rules; the host owns the words.

import * as THREE from "three";
import { api } from "./api.js";
import * as engine from "./engine.js";
import { createHost } from "./host.js";
import { createVoice } from "./voice.js";
import { createScene } from "./scene.js";
import { createUI } from "./ui.js";

const $ = (id) => document.getElementById(id);
const banner = $("banner");
let bannerTimer = null;
function showError(message) {
    banner.textContent = message;
    banner.classList.remove("hidden");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.add("hidden"), 9000);
}

// ---------------------------------------------------------------- world

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
const scene3d = createScene(canvas, THREE);

const game = { g: null, roster: [], seed: 0, voices: {}, revealIndex: 0, voteOrder: [], voteIndex: 0 };

const voice = createVoice({
    speak: (text, v) => api.speak(text, v),
    transcribe: (blob) => api.transcribe(blob),
    onLine: (text) => ui.render({ ...view, subtitle: text, subtitleWho: game.voices.hostName ?? "Host" }),
});

const ui = createUI({ mount: document.body, on: handleEvent });
const host = createHost({ ask: (req) => api.ask(req), model: api.model });

// ---------------------------------------------------------------- view

let view = {};

function alivePlayers() {
    return game.g ? game.g.players.filter((p) => !p.eliminated) : [];
}

function buildView() {
    if (!game.g) {
        return { phase: "lobby", card: { kind: "lobby", players: game.roster, minPlayers: engine.MIN_PLAYERS } };
    }
    const pub = engine.publicState(game.g);
    const base = { phase: pub.phase, round: pub.round, totalRounds: pub.totalRounds };

    if (pub.phase === "briefing") {
        return { ...base, actions: [{ label: "Deal the roles", event: "roles", kind: "primary" }] };
    }
    if (pub.phase === "roles") {
        const id = alivePlayers()[game.revealIndex]?.id ?? game.g.players[game.revealIndex]?.id;
        const player = game.g.players.find((p) => p.id === id) ?? game.g.players[0];
        const secret = engine.secretFor(game.g, player.id);
        return { ...base, card: { kind: "secret", playerName: player.name, ...secret } };
    }
    if (pub.phase === "round") {
        return {
            ...base,
            subtitle: pub.twist,
            actions: [{ label: "Call the vote", event: "start-vote", kind: "primary" }],
        };
    }
    if (pub.phase === "vote") {
        const voter = game.voteOrder[game.voteIndex];
        const player = game.g.players.find((p) => p.id === voter);
        const targets = alivePlayers().filter((p) => p.id !== voter);
        return {
            ...base,
            voteHint: `${game.voteOrder.length - game.voteIndex} vote(s) left`,
            card: { kind: "vote", voterId: voter, voterName: player ? player.name : "", targets },
        };
    }
    if (pub.phase === "result") {
        return { ...base, actions: [{ label: "Continue", event: "next", kind: "primary" }] };
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
    view = buildView();
    ui.render(view);
}

// ---------------------------------------------------------------- flow

function startGame(seed) {
    game.seed = seed ?? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    game.g = engine.createGame({ players: game.roster.map((p) => ({ id: p.id, name: p.name })), seed: game.seed });
    game.revealIndex = 0;
    game.voteIndex = 0;
    game.voteOrder = [];
    game.voices = voice.casting(game.roster.length);
    scene3d.setPlayers(game.roster.map((p) => ({ id: p.id, name: p.name })));
    scene3d.setCameraShot("overview");
    refresh();

    (async () => {
        try {
            const scenario = await host.scenario({ playerCount: game.roster.length, seedHint: String(game.seed) });
            engine.setScenario(game.g, scenario);
            engine.assignRoles(game.g);
            engine.beginBriefing(game.g);
            scene3d.setPhase("briefing");
            refresh();
            const line = await host.narrate("briefing", publicCtx());
            voice.say(line, game.voices.host);
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
        players: alivePlayers().map((p) => p.name),
    };
}

function beginRound() {
    engine.beginRound(game.g);
    scene3d.setPhase("round");
    scene3d.setCameraShot("orbit");
    refresh();
    const twist = engine.currentTwist(game.g);
    voice.say("Round " + game.g.round + ". " + (twist ?? ""), game.voices.host);
    host.narrate("twist", { ...publicCtx(), twist }).then((line) => voice.say(line, game.voices.host)).catch(() => {});
}

function openVote() {
    engine.openVote(game.g);
    game.voteOrder = alivePlayers().map((p) => p.id);
    game.voteIndex = 0;
    scene3d.setPhase("vote");
    scene3d.setCameraShot(`focus:${game.voteOrder[0] ?? "overview"}`);
    refresh();
    host.narrate("vote", publicCtx()).then((line) => voice.say(line, game.voices.host)).catch(() => {});
}

function afterVote() {
    const tally = engine.closeVote(game.g); // sets phase -> result, eliminates
    scene3d.setPhase("result");
    if (tally?.eliminatedId) scene3d.eliminate(tally.eliminatedId);
    refresh();
    host.readVotes(tally, publicCtx()).then((line) => voice.say(line, game.voices.host)).catch(() => {});
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
                game.roster.push({ id: `p${Date.now()}${game.roster.length}`, name: String(value).slice(0, 16) });
                refresh();
            }
            break;
        case "remove-player":
            game.roster = game.roster.filter((p) => p.id !== value);
            refresh();
            break;
        case "start":
            if (game.roster.length < engine.MIN_PLAYERS) return showError(`Need at least ${engine.MIN_PLAYERS} players.`);
            startGame();
            break;
        case "roles": {
            engine.nextPhase(g); // briefing -> roles
            game.revealIndex = 0;
            scene3d.setPhase("roles");
            const player = g.players[game.revealIndex];
            voice.say(`Now: ${player.name}, take the device. Your secret is for your eyes only.`, game.voices.players[game.revealIndex] ?? game.voices.host);
            refresh();
            break;
        }
        case "role-seen-done": {
            game.revealIndex += 1;
            if (game.revealIndex >= g.players.length) {
                beginRound(); // beginRound moves roles -> round itself
            } else {
                refresh();
            }
            break;
        }
        case "start-vote":
            openVote();
            break;
        case "cast-vote": {
            const res = engine.castVote(g, value.voterId, value.targetId);
            if (!res.ok) return showError(res.error ?? "Vote not counted.");
            scene3d.vote(value.voterId, value.targetId);
            game.voteIndex += 1;
            if (g.phase !== "vote") {
                afterVote();
            } else {
                scene3d.setCameraShot(`focus:${game.voteOrder[game.voteIndex] ?? "overview"}`);
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

// ---------------------------------------------------------------- splash + auth

$("splash-connect").addEventListener("click", () => api.connect().catch((e) => showError(e.message)));
$("splash-start").addEventListener("click", () => {
    if (!api.signedIn()) return showError("Connect Pollen first — the host speaks with your own Pollen.");
    $("splash").classList.add("leaving");
    setTimeout(() => {
        $("splash").classList.add("hidden");
        scene3d.setCameraShot("overview");
        refresh();
    }, 700);
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

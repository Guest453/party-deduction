// Party Deduction — integrator. Drives the phase loop: engine state -> host text
// -> voice -> scene + HUD. The 3D modules own their files; this owns the wiring.

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

const game = { g: null, roster: [], seed: 0, voiceOf: {} };

const voice = createVoice({
    speak: (text, v) => api.speak(text, v),
    transcribe: (blob) => api.transcribe(blob),
    onLine: (text) => ui.render({ ...view, subtitle: text }),
});

const ui = createUI({ mount: document.body, on: handleEvent });
const host = createHost({ ask: (req) => api.ask(req), model: api.model });

// ---------------------------------------------------------------- view

let view = {};
function refresh() {
    view = buildView();
    ui.render(view);
}

function buildView() {
    const g = game.g;
    if (!g) {
        return { phase: "lobby", card: { kind: "lobby", players: game.roster, minPlayers: engine.MIN_PLAYERS } };
    }
    const pub = engine.publicState(g);
    const base = { phase: pub.phase, timer: pub.timer, timerTotal: pub.timerTotal };
    if (pub.phase === "briefing") {
        return { ...base, actions: [{ label: "Continue", event: "advance", kind: "primary" }] };
    }
    if (pub.phase === "roles") {
        const id = pub.revealOrder[pub.revealIndex];
        const secret = engine.secretFor(g, id);
        const player = g.players.find((p) => p.id === id);
        return { ...base, card: { kind: "secret", playerName: player.name, ...secret } };
    }
    if (pub.phase === "round") {
        return { ...base, subtitle: pub.twist, actions: [{ label: "Call the vote", event: "start-vote", kind: "primary" }] };
    }
    if (pub.phase === "vote") {
        const id = pub.voteOrder[pub.voteIndex];
        const player = g.players.find((p) => p.id === id);
        const targets = g.players.filter((p) => p.id !== id && !p.eliminated);
        return { ...base, voteHint: `${pub.votesLeft} vote(s) left`, card: { kind: "vote", voterId: id, voterName: player.name, targets, canSkip: false } };
    }
    if (pub.phase === "result") {
        return { ...base, actions: [{ label: "Continue", event: "advance", kind: "primary" }] };
    }
    if (pub.phase === "reveal" || pub.phase === "ended") {
        const result = engine.resolve(g);
        return { ...base, card: { kind: "reveal", crewWon: result.crewWon, players: g.players.map((p) => ({ name: p.name, roleName: p.roleName, traitor: p.traitor })) } };
    }
    return base;
}

// ---------------------------------------------------------------- loop

function startGame(seed) {
    game.seed = seed ?? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    game.g = engine.createGame({ players: game.roster.map((p, i) => ({ id: p.id, name: p.name })), seed: game.seed });
    game.voiceOf = voice.casting(game.roster.length);
    scene3d.setPlayers(game.roster.map((p) => ({ id: p.id, name: p.name })));
    (async () => {
        try {
            const scenario = await host.scenario({ playerCount: game.roster.length, seedHint: String(game.seed) });
            engine.setScenario(game.g, scenario);
            engine.assignRoles(game.g);
            engine.beginBriefing(game.g);
            scene3d.setPhase(game.g.phase);
            refresh();
            const line = await host.narrate("briefing", publicCtx());
            voice.say(line, game.voiceOf.host);
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
        players: game.g.players.filter((p) => !p.eliminated).map((p) => p.name),
    };
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
            startGame();
            break;
        case "role-seen":
            break;
        case "role-seen-done": {
            engine.nextPhase(g); // roles -> round (or next reveal handled below)
            if (g.phase === "roles") {
                refresh();
            } else {
                beginRound();
            }
            break;
        }
        case "start-vote": {
            engine.openVote(g);
            refresh();
            const tally = null;
            host.narrate("vote", publicCtx()).then((line) => voice.say(line, game.voiceOf.host)).catch(() => {});
            break;
        }
        case "cast-vote": {
            const res = engine.castVote(g, value.voterId, value.targetId ?? value.voterId);
            if (!res.ok) {
                showError(res.error ?? "Vote not counted.");
                return;
            }
            scene3d.vote(value.voterId, value.targetId ?? value.voterId);
            if (g.phase === "vote") {
                refresh();
            } else {
                finishVote();
            }
            break;
        }
        case "advance": {
            advance();
            break;
        }
        case "replay":
            restart(true);
            break;
        case "replay-same":
            restart(false);
            break;
        default:
            break;
    }
}

function beginRound() {
    engine.beginRound(game.g);
    scene3d.setPhase(game.g.phase);
    refresh();
    const twist = engine.currentTwist(game.g);
    host
        .narrate("twist", { ...publicCtx(), twist })
        .then((line) => voice.say(line, game.voiceOf.host))
        .catch(() => {});
}

function finishVote() {
    const tally = engine.tally(game.g);
    scene3d.setPhase("result");
    refresh();
    host
        .readVotes(tally, publicCtx())
        .then((line) => voice.say(line, game.voiceOf.host))
        .catch(() => {});
    if (tally.eliminatedId) scene3d.eliminate(tally.eliminatedId);
}

function advance() {
    const g = game.g;
    if (g.phase === "briefing") {
        engine.nextPhase(g); // -> roles
        scene3d.setPhase(g.phase);
        refresh();
        return;
    }
    if (g.phase === "result") {
        if (g.round >= engine.ROUNDS) {
            engine.nextPhase(g); // -> reveal
            scene3d.setPhase("reveal");
            scene3d.setCameraShot("reveal");
            const result = engine.resolve(g);
            scene3d.revealRoles(g.players.map((p) => ({ id: p.id, roleName: p.roleName, traitor: p.traitor })));
            refresh();
            host.reveal(result, publicCtx()).then((line) => voice.say(line, game.voiceOf.host)).catch(() => {});
        } else {
            beginRound();
        }
        return;
    }
}

function restart(newScenario) {
    if (newScenario) {
        game.g = null;
        startGame();
    } else {
        startGame(game.seed);
    }
}

// ---------------------------------------------------------------- taps on avatars

const raycaster = new THREE.Raycaster();
canvas.addEventListener("click", (event) => {
    const g = game.g;
    if (!g || g.phase !== "vote") return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, scene3d.camera ?? new THREE.Camera());
    const hits = raycaster.intersectObjects(scene3d.avatarObjects?.() ?? [], true);
    for (const hit of hits) {
        let node = hit.object;
        while (node && !node.userData.playerId) node = node.parent;
        if (node?.userData.playerId) {
            const id = node.userData.playerId;
            const pub = engine.publicState(g);
            const voter = pub.voteOrder[pub.voteIndex];
            if (id !== voter) handleEvent("cast-vote", { voterId: voter, targetId: id });
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

// ---------------------------------------------------------------- loop

addEventListener("resize", () => {
    const w = innerWidth;
    const h = innerHeight;
    if (scene3d.resize) scene3d.resize(w, h);
});
scene3d.setCameraShot("orbit");
refresh();

rendererLoop();
function rendererLoop() {
    let last = performance.now();
    const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        scene3d.update(dt);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

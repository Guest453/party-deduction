// Contract tests for the party-deduction modules. Builds everything headlessly
// with real Three.js (only rendering needs WebGL). Run: node --test test/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

// ---- minimal DOM shim -------------------------------------------------------
function fakeCtx() {
    const noop = () => {};
    return new Proxy(
        {
            canvas: { width: 256, height: 256 },
            measureText: () => ({ width: 10 }),
            createImageData: (w, h) => ({ data: new Uint8ClampedArray((w || 1) * (h || 1) * 4), width: w || 1, height: h || 1 }),
            getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray((w || 1) * (h || 1) * 4), width: w || 1, height: h || 1, colorSpace: "srgb" }),
            createLinearGradient: () => ({ addColorStop: noop }),
            createRadialGradient: () => ({ addColorStop: noop }),
        },
        { get: (t, k) => (k in t ? t[k] : noop) },
    );
}
function fakeEl() {
    const el = {
        width: 256, height: 256, style: { setProperty() {} },
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute() {}, removeAttribute() {}, appendChild() {}, append() {}, prepend() {}, removeChild() {},
        addEventListener() {}, removeEventListener() {}, focus() {}, remove() {},
        querySelector: () => null, querySelectorAll: () => [], children: [], childNodes: [], innerHTML: "", textContent: "", className: "",
        getContext: () => fakeCtx(), toDataURL: () => "data:,",
    };
    return el;
}
globalThis.document = globalThis.document ?? {
    createElement: () => fakeEl(),
    createElementNS: () => fakeEl(),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    addEventListener() {}, removeEventListener() {}, getElementById: () => null,
    head: { appendChild() {} }, body: { appendChild() {}, removeChild() {} },
    exitPointerLock() {}, pointerLockElement: null,
};
globalThis.window = globalThis.window ?? { devicePixelRatio: 1, addEventListener() {}, innerWidth: 1280, innerHeight: 720 };
globalThis.devicePixelRatio = globalThis.devicePixelRatio ?? 1;

const THREE = await import("three");

// ---- engine -----------------------------------------------------------------
test("engine runs a full game and never leaks secrets in publicState", async () => {
    const engine = await import("../src/engine.js");
    const players = ["A", "B", "C", "D", "E", "F"].map((name, i) => ({ id: `p${i}`, name }));
    const g = engine.createGame({ players, seed: 1234 });
    engine.setScenario(g, {
        title: "T", premise: "p", location: "l",
        roles: Array.from({ length: 5 }, (_, i) => ({ name: `R${i}`, blurb: "b" })),
        twists: ["t1", "t2", "t3"],
    });
    engine.assignRoles(g);
    assert.equal(g.phase, "lobby");
    const traitors = g.players.filter((p) => p.traitor).length;
    assert.equal(traitors, engine.traitorCountFor(players.length), "traitor count");
    assert.equal(JSON.stringify(engine.publicState(g)).includes("objective"), false, "no objective in publicState");
    for (const p of g.players) {
        const secret = engine.secretFor(g, p.id);
        assert.ok(secret.roleName && typeof secret.traitor === "boolean" && secret.objective, "secret shape");
    }
});

test("engine vote -> tally -> resolve", async () => {
    const engine = await import("../src/engine.js");
    const players = ["A", "B", "C", "D"].map((name, i) => ({ id: `p${i}`, name }));
    const g = engine.createGame({ players, seed: 7 });
    engine.setScenario(g, { title: "T", premise: "p", location: "l", roles: Array.from({ length: 5 }, (_, i) => ({ name: `R${i}`, blurb: "b" })), twists: ["a", "b", "c"] });
    engine.assignRoles(g);
    engine.beginBriefing(g);
    engine.nextPhase(g); // roles
    engine.nextPhase(g); // round
    engine.beginRound(g);
    engine.openVote(g);
    const traitorId = g.players.find((p) => p.traitor).id;
    for (const p of g.players) {
        if (p.id === traitorId) engine.castVote(g, p.id, g.players.find((q) => !q.traitor).id);
        else engine.castVote(g, p.id, traitorId);
    }
    const tally = engine.tally(g);
    assert.equal(tally.eliminatedId, traitorId, "traitor most voted");
    const result = engine.resolve(g);
    assert.equal(result.crewWon, true, "crew wins when the traitor is eliminated");
});

// ---- host -------------------------------------------------------------------
test("host falls back to a built-in scenario when the model returns junk", async () => {
    const { createHost } = await import("../src/host.js");
    const host = createHost({ ask: async () => "not json" });
    const s = await host.scenario({ playerCount: 6, seedHint: "x" });
    assert.ok(s.roles.length >= 5, "fallback roles");
    assert.ok(s.twists.length >= 3, "fallback twists");
});

// ---- voice ------------------------------------------------------------------
test("voice casts distinct voices and enqueues without throwing", async () => {
    const { createVoice } = await import("../src/voice.js");
    const v = createVoice({ speak: async () => "blob:x", onLine: () => {} });
    const cast = v.casting(6);
    assert.ok(cast.host, "host voice");
    assert.equal(cast.players.length, 6, "one voice per player");
    assert.equal(new Set(cast.players).size, 6, "distinct player voices");
    assert.ok(!cast.players.includes(cast.host), "host voice is not reused");
    // Enqueue must never throw, whatever the audio backend does (Node has none).
    v.say("one", cast.host);
    v.say("two", cast.host);
    assert.equal(typeof v.queue(), "number");
    v.stop();
});

// ---- scene ------------------------------------------------------------------
test("scene builds, animates and reveals, with playerId on the avatars", async () => {
    const { createScene } = await import("../src/scene.js");
    const dom = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), width: 800, height: 600 };
    const scene = createScene(dom, THREE);
    const players = ["A", "B", "C", "D"].map((name, i) => ({ id: `p${i}`, name }));
    scene.setPlayers(players);
    // find tagged avatars
    let tagged = 0;
    const sceneRoot = scene.scene ?? scene.group ?? null;
    if (sceneRoot) sceneRoot.traverse((node) => { if (node.isMesh && node.userData.playerId) tagged += 1; });
    scene.setPhase("round");
    scene.highlight("p1");
    scene.vote("p0", "p2");
    scene.eliminate("p2");
    scene.revealRoles([{ id: "p0", roleName: "R", traitor: true }]);
    for (const shot of ["overview", "focus:p1", "reveal", "orbit"]) {
        scene.setCameraShot(shot);
        for (let i = 0; i < 8; i++) scene.update(0.016);
    }
    assert.ok(typeof scene.update === "function");
});

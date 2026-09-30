// Which TTS models work with QUEST pollen (the key has 0 paid balance)?
const key = process.env.POLLINATIONS_TEST_KEY;
const BASE = "https://gen.pollinations.ai";

const models = await (await fetch(`${BASE}/audio/models`)).json();
const list = Array.isArray(models) ? models : models.data ?? [];
const tts = list.filter((m) => (m.voices ?? m.supported_voices ?? []).length || /tts|speech|kokoro|csm/i.test(m.name || ""));

console.log("candidate TTS models (name | price fields | voices):");
for (const m of tts.slice(0, 30)) {
    const v = m.voices ?? m.supported_voices ?? [];
    console.log(`  ${(m.name || m.id).padEnd(38)} ${JSON.stringify(m.pricing ?? m.price ?? {}).slice(0, 70)} voices=${Array.isArray(v) ? v.slice(0, 4).join(",") : v}`);
}

console.log("\ntrying each with a real request:");
for (const m of tts.slice(0, 30)) {
    const name = m.name || m.id;
    const voice = (m.voices ?? m.supported_voices ?? [])[0] || "nova";
    try {
        const res = await fetch(`${BASE}/v1/audio/speech`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: name, input: "test", voice, response_format: "mp3" }),
        });
        const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
        let note = "";
        if (!res.ok) { const t = await res.text(); note = t.includes("INSUFFICIENT_BALANCE") ? "PAID ONLY" : t.slice(0, 60); }
        console.log(`  ${res.status} ${bytes ? bytes + "B" : note}  ${name} / ${voice}`);
    } catch (e) {
        console.log(`  ERR ${e.message.slice(0, 50)}  ${name}`);
    }
}

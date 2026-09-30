// Real, synthesized tension audio — no AI model, no external files. Built from
// the Web Audio API: an ambient drone bed, a rising vote tension, and a low
// sting when someone is voted out. Starts on the first user gesture (browsers
// require one), and degrades silently if Web Audio is unavailable.
export function createAudio() {
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return { start() {}, setPhase() {}, sting() {}, stop() {}, enabled: false };

    let ctx = null;
    let master = null;
    const nodes = { drone: [], tension: null, tensionGain: null };
    let started = false;

    function ensure() {
        if (ctx) return true;
        try {
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = 0.0;
            master.connect(ctx.destination);
            return true;
        } catch {
            ctx = null;
            return false;
        }
    }

    // A slow, low drone: two detuned saw/triangle voices through a lowpass, with
    // a slow LFO on the filter so it breathes. The bed under every scene.
    function buildDrone() {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 220;
        filter.Q.value = 0.8;
        filter.connect(master);

        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.06;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 90;
        lfo.connect(lfoGain).connect(filter.frequency);
        lfo.start();

        for (const [freq, type, detune] of [[55, "sine", 0], [82.5, "triangle", 4], [110, "sine", -6]]) {
            const osc = ctx.createOscillator();
            osc.type = type;
            osc.frequency.value = freq;
            osc.detune.value = detune;
            const g = ctx.createGain();
            g.gain.value = 0.16;
            osc.connect(g).connect(filter);
            osc.start();
            nodes.drone.push(osc, g);
        }
        nodes.drone.push(filter, lfo, lfoGain);
    }

    // The tension riser played while the table votes: a slowly rising tone.
    function buildTension() {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = 110;
        const g = ctx.createGain();
        g.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 900;
        osc.connect(filter).connect(g).connect(master);
        osc.start();
        nodes.tension = osc;
        nodes.tensionGain = g;
    }

    function ramp(param, value, seconds) {
        try {
            param.cancelScheduledValues(ctx.currentTime);
            param.linearRampToValueAtTime(value, ctx.currentTime + seconds);
        } catch {
            param.value = value;
        }
    }

    return {
        enabled: true,
        /** Call from a click handler: resumes the context and fades the bed in. */
        start() {
            if (!ensure()) return;
            if (ctx.state === "suspended") ctx.resume().catch(() => {});
            if (!started) {
                buildDrone();
                buildTension();
                started = true;
            }
            ramp(master.gain, 0.5, 1.6);
        },
        /** Mood per phase: the drone brightens for tension, softens for reveals. */
        setPhase(phase) {
            if (!ctx || !started) return;
            const tension = phase === "vote" ? 0.22 : phase === "result" ? 0.16 : phase === "reveal" ? 0.1 : 0.0;
            ramp(nodes.tensionGain.gain, tension, 0.9);
            if (nodes.tension) ramp(nodes.tension.frequency, phase === "vote" ? 190 : 130, 1.2);
        },
        /** A low thump when someone is eliminated. */
        sting() {
            if (!ctx || !started) return;
            const osc = ctx.createOscillator();
            osc.type = "sine";
            const g = ctx.createGain();
            const now = ctx.currentTime;
            osc.frequency.setValueAtTime(160, now);
            osc.frequency.exponentialRampToValueAtTime(42, now + 0.5);
            g.gain.setValueAtTime(0.0001, now);
            g.gain.exponentialRampToValueAtTime(0.6, now + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
            osc.connect(g).connect(master);
            osc.start(now);
            osc.stop(now + 1.0);
        },
        stop() {
            if (!ctx) return;
            ramp(master.gain, 0, 0.4);
        },
    };
}

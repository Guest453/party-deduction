// Real, synthesized tension audio — no AI model, no external files. Built from
// the Web Audio API: an ambient drone bed, a rising vote tension, and a low
// sting when someone is voted out. Starts on the first user gesture (browsers
// require one), and degrades silently if Web Audio is unavailable.
// Real, copyright-free tension audio: "Suspicious Loop" by Hazmat Harry
// (CC0 / public domain, OpenGameArt.org). No AI model, no external files at
// runtime beyond this one track. The bed loops quietly; a synthesized sting
// (Web Audio) lands when someone is eliminated. Starts on the first gesture.
const TRACK_URL = "audio/suspicious-loop.mp3";

export function createAudio() {
    let bed = null;       // the looping <audio> element
    let ctx = null;       // Web Audio context for the sting
    let master = null;
    let started = false;
    let volume = 0.5;

    function ensureBed() {
        if (bed) return bed;
        const Ctor = globalThis.Audio;
        if (typeof Ctor !== "function") return null;
        bed = new Ctor();
        bed.src = TRACK_URL;
        bed.loop = true;
        bed.volume = 0;
        bed.preload = "auto";
        return bed;
    }

    function ensureCtx() {
        if (ctx) return true;
        const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return false;
        try {
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = 0.5;
            master.connect(ctx.destination);
            return true;
        } catch {
            ctx = null;
            return false;
        }
    }

    return {
        enabled: true,
        /** Call from a click handler: starts the looping bed. */
        start() {
            const el = ensureBed();
            if (!el) return;
            try {
                el.play().catch(() => {});
            } catch {
                /* ignore */
            }
            started = true;
            ensureCtx(); // so the elimination sting has a context
            // fade the bed in
            let v = 0;
            const id = setInterval(() => {
                v = Math.min(volume, v + 0.03);
                try {
                    el.volume = v;
                } catch {
                    /* ignore */
                }
                if (v >= volume) clearInterval(id);
            }, 120);
        },
        /** Mood per phase: louder and slightly pitched-up for the vote. */
        setPhase(phase) {
            if (!bed) return;
            const target = phase === "vote" ? 0.62 : phase === "result" ? 0.55 : phase === "reveal" ? 0.4 : 0.45;
            volume = target;
            if (started) {
                try {
                    bed.playbackRate = phase === "vote" ? 1.12 : 1.0;
                } catch {
                    /* ignore */
                }
            }
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
            if (!bed) return;
            try {
                bed.volume = 0;
                bed.pause();
            } catch {
                /* ignore */
            }
            started = false;
        },
    };
}

// A tiny on-screen debug panel, enabled with ?debug=1. Shows the numbers that
// are otherwise invisible: avatar count + positions, phase, voter, vote progress,
// voice queue state, and the last error. Purely for diagnosis; costs nothing when
// the query flag is absent.
export function createDebug() {
    const enabled = new URLSearchParams(location.search).get("debug") === "1";
    if (!enabled) {
        return { set() {}, log() {}, enabled: false };
    }
    const el = document.createElement("pre");
    el.style.cssText = [
        "position:fixed", "left:8px", "bottom:8px", "z-index:60", "margin:0",
        "max-width:46vw", "max-height:40vh", "overflow:auto",
        "background:rgba(0,0,0,.82)", "color:#8ef", "font:11px/1.35 ui-monospace,monospace",
        "padding:8px 10px", "border-radius:10px", "border:1px solid rgba(140,238,255,.4)",
        "white-space:pre-wrap", "pointer-events:none",
    ].join(";");
    document.body.appendChild(el);

    let state = {};
    const lines = [];
    function render() {
        const rows = Object.entries(state).map(([k, v]) => `${k.padEnd(14)} ${typeof v === "object" ? JSON.stringify(v) : v}`);
        el.textContent = [...rows, "--- log ---", ...lines.slice(-8)].join("\n");
    }
    return {
        enabled: true,
        set(next) {
            state = next;
            render();
        },
        log(message) {
            lines.push(`${new Date().toISOString().slice(11, 19)} ${message}`);
            render();
        },
    };
}

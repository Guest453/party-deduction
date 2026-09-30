// Thin HUD over the 3D scene: turn banner, host subtitle, discussion timer,
// the pass-and-play secret card, the vote prompt, toasts, and the reveal panel.
// The 3D scene carries the visuals; this is only what needs to be crisp text.

export function createUI({ mount, on = () => {} }) {
    const el = (tag, cls, html) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (html != null) node.innerHTML = html;
        return node;
    };

    // one stylesheet, injected once
    if (!document.getElementById("party-ui-style")) {
        const style = document.createElement("style");
        style.id = "party-ui-style";
        style.textContent = `
            .pz { position: fixed; z-index: 10; color: #f6ecdd;
                  font: 16px/1.5 "Iowan Old Style", "Palatino Linotype", Georgia, serif; }
            .pz-btn { font: inherit; color: #f6ecdd; cursor: pointer; border-radius: 12px; padding: .7rem 1.15rem;
                      background: linear-gradient(180deg, rgba(58,45,34,.96), rgba(38,29,22,.96));
                      border: 1px solid rgba(150,116,78,.38); transition: transform .18s cubic-bezier(.22,1,.36,1), border-color .2s, box-shadow .25s; }
            .pz-btn:hover:not(:disabled) { transform: translateY(-2px); border-color: #e6b96a; box-shadow: 0 10px 26px rgba(0,0,0,.45); }
            .pz-btn:disabled { opacity: .45; cursor: not-allowed; }
            .pz-btn.primary { background: linear-gradient(180deg, #f0d39a, #e6b96a); color: #2a1c10; border-color: #f0cf95; font-weight: 700; }
            .pz-btn.ghost { background: transparent; box-shadow: none; }
            .pz-top { top: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .8rem 1.15rem;
                      background: linear-gradient(rgba(9,7,5,.9), transparent); pointer-events: none; }
            .pz-top > * { pointer-events: auto; }
            .pz-phase { letter-spacing: .28em; text-transform: uppercase; font-size: .72rem; color: #e6b96a; }
            .pz-sub { position: fixed; left: 50%; bottom: 3.2rem; transform: translateX(-50%); max-width: min(46rem, 92vw); text-align: center;
                      background: rgba(18,13,10,.82); border: 1px solid rgba(150,116,78,.3); border-radius: 14px; padding: .7rem 1.1rem; backdrop-filter: blur(8px); }
            .pz-sub b { color: #e6b96a; }
            .pz-timer { display: flex; align-items: center; gap: .5rem; font-variant-numeric: tabular-nums; }
            .pz-bar { width: 120px; height: 8px; border-radius: 999px; background: rgba(255,255,255,.12); overflow: hidden; }
            .pz-bar > i { display: block; height: 100%; width: 100%; background: linear-gradient(90deg, #e6b96a, #f0d39a); }
            .pz-center { inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(8,6,4,.62); backdrop-filter: blur(4px); }
            .pz-card { width: min(30rem, 92vw); background: rgba(24,18,13,.96); border: 1px solid rgba(150,116,78,.4); border-radius: 20px; padding: 1.6rem; text-align: center; box-shadow: 0 24px 70px rgba(0,0,0,.6); }
            .pz-card h2 { margin: 0 0 .2rem; font-size: 1.5rem; }
            .pz-card .role { color: #e6b96a; font-size: 1.25rem; margin: .6rem 0 .2rem; }
            .pz-card .blurb { color: #c9b39a; }
            .pz-card .obj { margin-top: .8rem; padding: .7rem; border-radius: 12px; background: rgba(230,185,106,.1); border: 1px solid rgba(230,185,106,.3); }
            .pz-card .traitor { color: #e06a62; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
            .pz-card .hold { cursor: pointer; user-select: none; padding: 2.4rem 1rem; border-radius: 16px; border: 1px dashed rgba(150,116,78,.5); }
            .pz-players { display: flex; flex-wrap: wrap; gap: .5rem; justify-content: center; margin: 1rem 0; }
            .pz-chip { display: flex; gap: .4rem; align-items: center; background: rgba(255,255,255,.06); border: 1px solid rgba(150,116,78,.3); border-radius: 999px; padding: .35rem .5rem .35rem .8rem; }
            .pz-chip button { border: 0; background: none; color: #c9b39a; cursor: pointer; font-size: 1rem; }
            .pz-row { display: flex; gap: .5rem; justify-content: center; margin-top: 1rem; flex-wrap: wrap; }
            .pz-input { font: inherit; color: #f6ecdd; background: rgba(16,12,9,.9); border: 1px solid rgba(150,116,78,.35); border-radius: 10px; padding: .6rem .7rem; }
            .pz-toast { left: 50%; top: 5rem; transform: translateX(-50%); background: rgba(62,22,20,.95); border: 1px solid #e06a62; border-radius: 12px; padding: .6rem 1rem; max-width: 40rem; }
            .pz-flash { inset: 0; display: flex; align-items: center; justify-content: center; font-size: clamp(2rem, 8vw, 5rem); font-weight: 700; letter-spacing: .08em; color: #f6ecdd; text-shadow: 0 6px 30px rgba(0,0,0,.7); pointer-events: none; opacity: 0; transition: opacity .3s; }
            .pz-flash.on { opacity: 1; }
            .pz-votebadge { top: 4.6rem; right: 1.15rem; background: rgba(18,13,10,.85); border: 1px solid rgba(150,116,78,.4); border-radius: 14px; padding: .7rem 1rem; text-align: right; }
        `;
        document.head.appendChild(style);
    }

    const layer = el("div");
    layer.id = "party-ui";
    mount.appendChild(layer);

    const top = el("div", "pz pz-top");
    const phaseLabel = el("div", "pz-phase", "");
    const timerWrap = el("div", "pz pz-timer");
    const bar = el("div", "pz-bar");
    const fill = el("i");
    bar.appendChild(fill);
    const timerText = el("span", "", "0:00");
    timerWrap.append(el("span", "", "Discussion"), bar, timerText);
    const topRight = el("div", "", "");
    top.append(phaseLabel, timerWrap, topRight);

    const sub = el("div", "pz pz-sub");
    const badge = el("div", "pz pz-votebadge");
    const toast = el("div", "pz pz-toast");
    toast.style.display = "none";
    const flash = el("div", "pz pz-flash");
    const center = el("div", "pz pz-center");
    center.style.display = "none";
    const card = el("div", "pz-card");
    center.appendChild(card);

    layer.append(top, sub, badge, toast, flash, center);

    const show = (node, on2) => {
        node.style.display = on2 ? "" : "none";
    };
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;

    let toastTimer = null;
    let flashTimer = null;

    return {
        render(view) {
            phaseLabel.textContent = view.phase ?? "";
            badge.textContent = view.voteHint ?? "";
            show(badge, Boolean(view.voteHint));
            const t = view.timer;
            if (typeof t === "number") {
                show(timerWrap, true);
                timerText.textContent = fmt(t);
                fill.style.width = `${view.timerTotal ? (t / view.timerTotal) * 100 : 0}%`;
            } else {
                show(timerWrap, false);
            }
            sub.innerHTML = view.subtitle ? `<b>${escapeHtml(view.subtitleWho ?? "Host")}:</b> ${escapeHtml(view.subtitle)}` : "";
            show(sub, Boolean(view.subtitle));

            topRight.innerHTML = "";
            for (const btn of view.actions ?? []) {
                const b = el("button", `pz-btn ${btn.kind ?? ""}`, btn.label);
                b.disabled = Boolean(btn.disabled);
                b.onclick = () => on(btn.event, btn.value);
                topRight.appendChild(b);
            }

            // modal card
            if (!view.card) {
                center.style.display = "none";
                card.innerHTML = "";
            } else {
                center.style.display = "";
                card.innerHTML = "";
                const c = view.card;
                if (c.kind === "lobby") {
                    card.append(el("h2", "", "Party deduction"));
                    card.append(el("p", "blurb", "Secret roles, a lying minority, and a host who never stops talking. 4–10 players, one device."));
                    const list = el("div", "pz-players");
                    for (const p of c.players) {
                        const chip = el("span", "pz-chip", `${escapeHtml(p.name)}`);
                        const x = el("button", "", "×");
                        x.onclick = () => on("remove-player", p.id);
                        chip.appendChild(x);
                        list.appendChild(chip);
                    }
                    card.appendChild(list);
                    const row = el("div", "pz-row");
                    const input = el("input", "pz-input");
                    input.placeholder = "Player name";
                    input.maxLength = 16;
                    const add = el("button", "pz-btn", "Add player");
                    add.onclick = () => {
                        if (input.value.trim()) {
                            on("add-player", input.value.trim());
                            input.value = "";
                        }
                    };
                    input.onkeydown = (event) => {
                        if (event.key === "Enter") add.click();
                    };
                    row.append(input, add);
                    card.appendChild(row);
                    const start = el("button", `pz-btn primary`, `Start game`);
                    start.disabled = (c.players?.length ?? 0) < c.minPlayers;
                    start.onclick = () => on("start");
                    const row2 = el("div", "pz-row");
                    row2.appendChild(start);
                    card.appendChild(row2);
                } else if (c.kind === "secret") {
                    card.append(el("h2", "", `Pass to ${escapeHtml(c.playerName)}`));
                    card.append(el("p", "blurb", "Make sure only they can see. Hold to reveal."));
                    const hold = el("div", "hold", "Hold to reveal your role");
                    let shown = false;
                    const reveal = () => {
                        if (shown) return;
                        shown = true;
                        hold.className = "";
                        hold.innerHTML = "";
                        hold.append(el("div", "role", escapeHtml(c.roleName)));
                        hold.append(el("div", "blurb", escapeHtml(c.blurb)));
                        hold.append(el("div", "obj", escapeHtml(c.objective)));
                        if (c.traitor) hold.append(el("div", "traitor", "You are a traitor"));
                        on("role-seen");
                    };
                    hold.onpointerdown = reveal;
                    hold.onclick = reveal;
                    card.appendChild(hold);
                    const cont = el("button", "pz-btn primary", "Got it — pass on");
                    cont.disabled = true;
                    // enable once revealed
                    const check = setInterval(() => {
                        if (shown) {
                            cont.disabled = false;
                            clearInterval(check);
                        }
                    }, 120);
                    cont.onclick = () => on("role-seen-done");
                    const row = el("div", "pz-row");
                    row.appendChild(cont);
                    card.appendChild(row);
                } else if (c.kind === "vote") {
                    card.append(el("h2", "", `${escapeHtml(c.voterName)} votes`));
                    card.append(el("p", "blurb", "Tap a player at the table to vote for them."));
                    const row = el("div", "pz-row");
                    for (const p of c.targets) {
                        const b = el("button", "pz-btn", escapeHtml(p.name));
                        b.onclick = () => on("cast-vote", { voterId: c.voterId, targetId: p.id });
                        row.appendChild(b);
                    }
                    card.appendChild(row);
                    if (c.canSkip) {
                        const skip = el("button", "pz-btn ghost", "Skip vote");
                        skip.onclick = () => on("cast-vote", { voterId: c.voterId, targetId: null });
                        const row2 = el("div", "pz-row");
                        row2.appendChild(skip);
                        card.appendChild(row2);
                    }
                } else if (c.kind === "reveal") {
                    card.append(el("h2", "", c.crewWon ? "The crew wins" : "The traitors win"));
                    const list = el("div", "pz-players");
                    for (const p of c.players) {
                        const chip = el("span", "pz-chip", `${escapeHtml(p.name)} — ${escapeHtml(p.roleName)}${p.traitor ? " (traitor)" : ""}`);
                        list.appendChild(chip);
                    }
                    card.appendChild(list);
                    const row = el("div", "pz-row");
                    const again = el("button", "pz-btn primary", "Play again — new story");
                    again.onclick = () => on("replay");
                    const same = el("button", "pz-btn ghost", "Same players");
                    same.onclick = () => on("replay-same");
                    row.append(again, same);
                    card.appendChild(row);
                }
            }
        },
        toast(message) {
            toast.textContent = message;
            show(toast, true);
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => show(toast, false), 7000);
        },
        flash(text) {
            flash.textContent = text;
            flash.classList.add("on");
            clearTimeout(flashTimer);
            flashTimer = setTimeout(() => flash.classList.remove("on"), 1400);
        },
        destroy() {
            layer.remove();
        },
    };
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

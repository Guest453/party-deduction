// Party Deduction — distinct UI: a neon game-show, not the murder-mystery skin.
// Injects its own stylesheet and builds the HUD with a different look and layout
// from whodunnit (neon cyan/magenta on deep indigo, rounded, playful, big taps).

export function createUI({ mount, on = () => {} }) {
    const el = (tag, cls, html) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (html != null) node.innerHTML = html;
        return node;
    };

    if (!document.getElementById("party-ui-style")) {
        const style = document.createElement("style");
        style.id = "party-ui-style";
        style.textContent = `
            :root { --pz-cyan:#22e6ff; --pz-magenta:#ff3ea5; --pz-lime:#b6ff3c; --pz-indigo:#141033; --pz-ink:#f3f0ff; --pz-dim:#a99fd6; }
            .pz { position: fixed; z-index: 10; color: var(--pz-ink);
                  font: 16px/1.5 "Trebuchet MS","Segoe UI",system-ui,sans-serif; }
            .pz-btn { font: inherit; font-weight: 700; letter-spacing:.02em; color: var(--pz-ink); cursor: pointer;
                      border-radius: 999px; padding: .75rem 1.3rem; border: 2px solid transparent;
                      background: linear-gradient(135deg, rgba(34,230,255,.22), rgba(255,62,165,.22));
                      box-shadow: 0 0 0 2px rgba(255,255,255,.08) inset, 0 8px 24px rgba(0,0,0,.4);
                      transition: transform .16s cubic-bezier(.2,1.4,.4,1), box-shadow .25s, background .25s; }
            .pz-btn:hover:not(:disabled) { transform: translateY(-3px) scale(1.02); box-shadow: 0 0 22px rgba(34,230,255,.5), 0 0 40px rgba(255,62,165,.3); }
            .pz-btn:disabled { opacity:.4; cursor:not-allowed; }
            .pz-btn.primary { background: linear-gradient(135deg, var(--pz-cyan), var(--pz-magenta)); color:#0a0720; border-color:#fff6; }
            .pz-btn.ghost { background: transparent; box-shadow: 0 0 0 2px rgba(255,255,255,.14) inset; }
            .pz-top { top:0; left:0; right:0; display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.8rem 1.2rem;
                      background: linear-gradient(180deg, rgba(10,7,32,.86), transparent); pointer-events:none; }
            .pz-top > * { pointer-events:auto; }
            .pz-phase { letter-spacing:.34em; text-transform:uppercase; font-size:.7rem; font-weight:800;
                        color:#0a0720; background:linear-gradient(135deg,var(--pz-cyan),var(--pz-magenta)); padding:.28rem .7rem; border-radius:999px; }
            .pz-sub { left:50%; bottom:2.4rem; transform:translateX(-50%); max-width:min(48rem,92vw); text-align:center;
                      background: rgba(20,16,51,.86); border:1px solid rgba(34,230,255,.4); border-radius:18px; padding:.8rem 1.2rem; backdrop-filter:blur(10px);
                      box-shadow:0 0 30px rgba(34,230,255,.18); }
            .pz-sub b { color: var(--pz-cyan); }
            .pz-timer { display:flex; align-items:center; gap:.5rem; font-variant-numeric:tabular-nums; font-weight:700; }
            .pz-bar { width:130px; height:9px; border-radius:999px; background:rgba(255,255,255,.12); overflow:hidden; }
            .pz-bar > i { display:block; height:100%; width:100%; background:linear-gradient(90deg,var(--pz-cyan),var(--pz-magenta)); }
            .pz-center { inset:0; display:flex; align-items:center; justify-content:center; background:rgba(6,4,20,.66); backdrop-filter:blur(5px); }
            .pz-card { width:min(32rem,93vw); background:linear-gradient(180deg, rgba(24,18,58,.98), rgba(16,12,42,.98));
                       border:1px solid rgba(34,230,255,.35); border-radius:26px; padding:1.8rem; text-align:center;
                       box-shadow:0 0 60px rgba(255,62,165,.25), 0 30px 80px rgba(0,0,0,.6); }
            .pz-card h2 { margin:0 0 .3rem; font-size:1.7rem; }
            .pz-card .role { color:var(--pz-lime); font-size:1.5rem; font-weight:800; margin:.6rem 0 .2rem; }
            .pz-card .blurb { color:var(--pz-dim); }
            .pz-card .obj { margin-top:.9rem; padding:.8rem; border-radius:16px; background:rgba(34,230,255,.1); border:1px solid rgba(34,230,255,.35); }
            .pz-card .traitor { margin-top:.7rem; color:var(--pz-magenta); font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
            .pz-card .hold { cursor:pointer; user-select:none; padding:2.6rem 1rem; border-radius:20px; border:2px dashed rgba(34,230,255,.5); }
            .pz-players { display:flex; flex-wrap:wrap; gap:.5rem; justify-content:center; margin:1.1rem 0; }
            .pz-chip { display:flex; gap:.4rem; align-items:center; background:rgba(34,230,255,.1); border:1px solid rgba(34,230,255,.3); border-radius:999px; padding:.4rem .55rem .4rem .85rem; font-weight:700; }
            .pz-chip button { border:0; background:none; color:var(--pz-dim); cursor:pointer; font-size:1.1rem; }
            .pz-row { display:flex; gap:.6rem; justify-content:center; margin-top:1rem; flex-wrap:wrap; }
            .pz-input { font:inherit; color:var(--pz-ink); background:rgba(10,7,32,.9); border:2px solid rgba(34,230,255,.3); border-radius:999px; padding:.65rem 1rem; }
            .pz-input:focus { outline:none; border-color:var(--pz-cyan); }
            .pz-custom { margin: 1rem 0; text-align: left; border-top: 1px solid rgba(34,230,255,.2); padding-top: .9rem; }
            .pz-custom summary { cursor: pointer; color: var(--pz-cyan); font-weight: 800; letter-spacing: .04em; }
            .pz-custom label { display: flex; align-items: center; justify-content: space-between; gap: .8rem; margin: .5rem 0; font-size: .92rem; }
            .pz-custom input[type=text], .pz-custom input[type=number], .pz-custom textarea {
                font: inherit; color: var(--pz-ink); background: rgba(10,7,32,.9); border: 2px solid rgba(34,230,255,.3); border-radius: 10px; padding: .45rem .6rem; width: 60%;
            }
            .pz-custom textarea { width: 100%; min-height: 4.5rem; resize: vertical; }
            .pz-custom .who { display: flex; flex-direction: column; gap: .3rem; margin: .6rem 0; padding: .6rem; border-radius: 12px; background: rgba(255,255,255,.04); }
            .pz-custom .who input { width: 100%; }
            .pz-toast { left:50%; top:5rem; transform:translateX(-50%); background:rgba(60,10,50,.95); border:1px solid var(--pz-magenta); border-radius:14px; padding:.6rem 1.1rem; max-width:42rem; box-shadow:0 0 30px rgba(255,62,165,.4); }
            .pz-flash { inset:0; display:flex; align-items:center; justify-content:center; font-size:clamp(2rem,9vw,5.5rem); font-weight:900; letter-spacing:.06em; color:#fff; text-shadow:0 0 30px rgba(34,230,255,.8),0 0 60px rgba(255,62,165,.6); pointer-events:none; opacity:0; transition:opacity .3s; }
            .pz-flash.on { opacity:1; }
            .pz-busy { left: 50%; bottom: 6.4rem; transform: translateX(-50%); display: flex; align-items: center; gap: .5rem;
                       background: rgba(20,16,51,.86); border: 1px solid rgba(34,230,255,.4); border-radius: 999px; padding: .45rem .95rem; font-weight: 700; color: var(--pz-cyan); }
            .pz-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--pz-cyan); animation: pzPulse 1s infinite ease-in-out; }
            .pz-dot:nth-child(2) { animation-delay: .15s; background: var(--pz-magenta); }
            .pz-dot:nth-child(3) { animation-delay: .3s; background: var(--pz-lime); }
            @keyframes pzPulse { 0%,100% { transform: scale(.6); opacity: .5; } 50% { transform: scale(1.2); opacity: 1; } }
            .pz-votebadge { top:4.6rem; right:1.2rem; background:rgba(20,16,51,.9); border:1px solid rgba(182,255,60,.5); border-radius:16px; padding:.7rem 1rem; text-align:right; font-weight:800; color:var(--pz-lime); }
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
    timerWrap.append(el("span", "", "Talk"), bar, timerText);
    const topRight = el("div", "", "");
    top.append(phaseLabel, timerWrap, topRight);

    const sub = el("div", "pz pz-sub");
    const busy = el("div", "pz pz-busy");
    busy.style.display = "none";
    const badge = el("div", "pz pz-votebadge");
    const toast = el("div", "pz pz-toast");
    toast.style.display = "none";
    const flash = el("div", "pz pz-flash");
    const center = el("div", "pz pz-center");
    center.style.display = "none";
    const card = el("div", "pz-card");
    center.appendChild(card);
    layer.append(top, sub, badge, busy, toast, flash, center);

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
            if (typeof view.timer === "number") {
                show(timerWrap, true);
                timerText.textContent = fmt(view.timer);
                fill.style.width = `${view.timerTotal ? (view.timer / view.timerTotal) * 100 : 0}%`;
            } else {
                show(timerWrap, false);
            }
            if (view.busy && (view.busy.thinking || view.busy.speaking || view.busy.queue > 0)) {
                const label = view.busy.thinking ? "thinking" : view.busy.speaking ? "speaking" : "queued";
                busy.innerHTML = `<span class="pz-dot"></span><span class="pz-dot"></span><span class="pz-dot"></span> ${label}…`;
                busy.style.display = "";
            } else {
                busy.style.display = "none";
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

            if (!view.card) {
                center.style.display = "none";
                card.innerHTML = "";
            } else {
                center.style.display = "";
                card.innerHTML = "";
                const c = view.card;
                if (c.kind === "lobby") {
                    card.append(el("h2", "", "Who's playing?"));
                    card.append(el("p", "blurb", "4–10 players, one device. Secret roles, one or two traitors, and an MC host."));
                    const list = el("div", "pz-players");
                    for (const p of c.players) {
                        const chip = el("span", "pz-chip", escapeHtml(p.name));
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
                    const add = el("button", "pz-btn", "Add");
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

                    // ---- Custom Mode ----
                    const custom = el("details", "pz-custom");
                    custom.appendChild(el("summary", "", "Custom mode — write the cast, the story and the rules"));
                    const cfg = c.custom || {};
                    const rounds = el("label", "", "Rounds");
                    const roundsIn = el("input");
                    roundsIn.type = "number";
                    roundsIn.min = "1";
                    roundsIn.max = "6";
                    roundsIn.value = String(cfg.rounds ?? c.defaultRounds ?? 3);
                    roundsIn.onchange = () => on("set-custom", { rounds: Math.max(1, Math.min(6, Number(roundsIn.value) || 3)) });
                    rounds.appendChild(roundsIn);
                    custom.appendChild(rounds);

                    const traitors = el("label", "", "Traitors");
                    const traitorsIn = el("input");
                    traitorsIn.type = "number";
                    traitorsIn.min = "1";
                    traitorsIn.max = "4";
                    traitorsIn.value = String(cfg.traitorCount ?? 1);
                    traitorsIn.onchange = () => on("set-custom", { traitorCount: Math.max(1, Math.min(4, Number(traitorsIn.value) || 1)) });
                    traitors.appendChild(traitorsIn);
                    custom.appendChild(traitors);

                    custom.appendChild(el("p", "blurb", "Personalities — how each player argues (optional):"));
                    for (const p of c.players) {
                        const who = el("div", "who");
                        const nameIn = el("input");
                        nameIn.type = "text";
                        nameIn.value = p.name;
                        nameIn.maxLength = 16;
                        nameIn.onchange = () => on("rename-player", { id: p.id, name: nameIn.value.trim() || p.name });
                        const persIn = el("input");
                        persIn.type = "text";
                        persIn.placeholder = "e.g. nervous and over-explains";
                        persIn.value = p.personality || "";
                        persIn.maxLength = 120;
                        persIn.onchange = () => on("set-personality", { id: p.id, personality: persIn.value });
                        who.append(nameIn, persIn);
                        custom.appendChild(who);
                    }

                    const scen = el("textarea");
                    scen.placeholder = 'Optional: your own scenario as JSON — {"title":"…","premise":"…","location":"…","roles":[{"name":"…","blurb":"…"}],"twists":["…","…"]}';
                    scen.value = cfg.scenario ? JSON.stringify(cfg.scenario) : "";
                    scen.onchange = () => {
                        const text = scen.value.trim();
                        if (!text) return on("set-custom", { scenario: null });
                        try {
                            const parsed = JSON.parse(text);
                            on("set-custom", { scenario: parsed });
                        } catch {
                            on("set-custom", { scenario: null });
                        }
                    };
                    custom.appendChild(scen);
                    card.appendChild(custom);

                    const start = el("button", "pz-btn primary", "Start the show");
                    start.disabled = (c.players?.length ?? 0) < c.minPlayers;
                    start.onclick = () => on("start");
                    const row2 = el("div", "pz-row");
                    row2.appendChild(start);
                    card.appendChild(row2);
                } else if (c.kind === "roles") {
                    card.append(el("h2", "", "Everyone's secret role"));
                    card.append(el("p", "blurb", "This screen is for the whole room — then play begins."));
                    const list = el("div", "pz-players");
                    for (const r of c.roles) {
                        const chip = el("span", "pz-chip", `${escapeHtml(r.name)} — ${escapeHtml(r.roleName)}${r.traitor ? " · traitor" : ""}`);
                        list.appendChild(chip);
                    }
                    card.appendChild(list);
                    const row = el("div", "pz-row");
                    const go = el("button", "pz-btn primary", "Begin round 1");
                    go.onclick = () => on("begin-round");
                    row.appendChild(go);
                    card.appendChild(row);
                } else if (c.kind === "secret") {
                    card.append(el("h2", "", `Pass to ${escapeHtml(c.playerName)}`));
                    card.append(el("p", "blurb", "Only they should see this. Tap to reveal."));
                    const hold = el("div", "hold", "Tap to reveal your role");
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
                    hold.onclick = reveal;
                    card.appendChild(hold);
                    const cont = el("button", "pz-btn primary", "Got it — pass on");
                    cont.disabled = true;
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
                    card.append(el("h2", "", `${escapeHtml(c.voterName)}, who is it?`));
                    card.append(el("p", "blurb", "Tap a player at the table, or a name here."));
                    const row = el("div", "pz-row");
                    for (const p of c.targets) {
                        const b = el("button", "pz-btn", escapeHtml(p.name));
                        b.onclick = () => on("cast-vote", { voterId: c.voterId, targetId: p.id });
                        row.appendChild(b);
                    }
                    card.appendChild(row);
                } else if (c.kind === "reveal") {
                    card.append(el("h2", "", c.crewWon ? "The crew wins!" : "The traitors win!"));
                    const list = el("div", "pz-players");
                    for (const p of c.players) {
                        const chip = el("span", "pz-chip", `${escapeHtml(p.name)} — ${escapeHtml(p.roleName)}${p.traitor ? " · traitor" : ""}`);
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

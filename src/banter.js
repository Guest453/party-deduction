// AI players who actually play: each speaks in character, accuses, and defends.
// The host narrates; these are the players talking to each other.

/**
 * @param {object} deps
 * @param {(req:{system:string,user:string})=>Promise<string>} deps.ask
 * @param {string} [deps.model]
 */
export function createBanter({ ask, model = "openai/gpt-5.4-nano" }) {
    const call = typeof ask === "function" ? ask : async () => "";

    function line(text) {
        return String(text || "")
            .replace(/```[\s\S]*?```/g, " ")
            .replace(/[*_#>`~]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 220);
    }

    /**
     * One AI player speaks.
     * @param {object} p
     * @param {string} p.name
     * @param {string} p.roleName
     * @param {string} p.objective
     * @param {boolean} p.traitor
     * @param {string} p.location
     * @param {string} [p.twist]
     * @param {number} p.round
     * @param {Array<{name:string,line:string}>} p.transcript  what has been said
     */
    async function speak({ name, roleName, objective, traitor, location, twist, round, transcript = [], personality = "" }) {
        const prior = transcript.slice(-6).map((t) => `${t.name}: ${t.line}`).join("\n") || "(nothing yet)";
        const system =
            `You are ${name}, a guest in a social-deduction party game at ${location}. ` +
            `Your secret role is "${roleName}". Your objective: ${objective}. ` +
            (traitor
                ? `You ARE a traitor: you must lie convincingly, deflect suspicion onto others, and never admit it. `
                : `You are innocent and want to find the traitors. `) +
            `Speak in first person, in character.` +
            (personality ? ` Your personality: ${personality}. Let that colour how you speak.` : ``);
        const user =
            `It is round ${round} of the discussion.${twist ? ` The twist: ${twist}.` : ""}\n` +
            `What has been said so far:\n${prior}\n\n` +
            `Say ONE short line (max 2 sentences) as ${name}: react to the last speaker, ` +
            (traitor ? `deflect suspicion onto someone else` : `ask a pointed question or make an accusation`) +
            `. No stage directions, no markdown, no quotes around it.`;
        try {
            const raw = await call({ system, user, model });
            const out = line(raw);
            if (out) return out;
        } catch {
            /* fall through */
        }
        // graceful fallback so the table never goes silent
        return traitor
            ? `${name} glances around. "I was nowhere near it — but I'm not the one acting nervous."`
            : `${name} folds their arms. "Someone here is lying, and I intend to find out who."`;
    }

    return { speak };
}

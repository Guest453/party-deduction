// voice.js — agent C: the VOICE layer.
// TTS queue/player, casting, and optional spoken-vote recording.
// Dependency-free; all browser objects are created lazily so the module can be
// imported (and constructed) headlessly in Node.

// Voices the host and players are cast from. Never repeated within one game
// unless playerCount is larger than the pool (then we cycle).
const VOICE_POOL = ["alloy","echo","fable","onyx","nova","shimmer"];

/**
 * Create the voice layer.
 *
 * @param {object} deps
 * @param {(text:string, voice?:string) => Promise<string>} deps.speak
 *        Injected TTS. Resolves to an audio object URL.
 * @param {(blob:Blob) => Promise<string>} [deps.transcribe]
 *        Optional speech-to-text for recorded votes.
 * @param {(text:string) => void} [deps.onLine]
 *        Called as each queued line BEGINS playing.
 * @returns {{
 *   casting:(playerCount:number)=>{host:string, players:string[]},
 *   say:(text:string, voice?:string, opts?:{interrupt?:boolean})=>Promise<void>,
 *   stop:()=>void,
 *   isSpeaking:()=>boolean,
 *   queue:()=>number,
 *   record:()=>Promise<any>,
 *   stopRecording:()=>Promise<any>,
 *   attach:(el:any)=>void,
 * }}
 */
export function createVoice({ speak, transcribe, onLine } = {}) {
  // ---- the queue ---------------------------------------------------------
  // `lines` holds waiting { text, voice, resolve, settled } records.
  // `current` is the one line being fetched/played right now (null when idle).
  // The invariant: at most ONE line is ever in flight, so audio never overlaps.
  const lines = [];
  let current = null;

  // A single shared Audio element, created on first use.
  let audio = null;
  let progressEl = null;

  // ---- small helpers -----------------------------------------------------

  function getAudio() {
    if (audio) return audio;
    const Ctor = globalThis.Audio || globalThis.HTMLAudioElement;
    if (typeof Ctor !== "function") return null;
    try {
      audio = new Ctor();
    } catch {
      audio = null;
      return null;
    }
    if (typeof audio.addEventListener === "function") {
      // Progress reporting for an attached <progress> element.
      const sync = () => {
        if (current) setProgress(audio.currentTime || 0, audio.duration || 0);
      };
      audio.addEventListener("timeupdate", sync);
      audio.addEventListener("loadedmetadata", sync);
      audio.addEventListener("ended", () => {
        if (current) settle(current);
      });
      audio.addEventListener("error", () => {
        if (current) settle(current);
      });
    }
    return audio;
  }

  function setProgress(cur, dur) {
    if (!progressEl) return;
    try {
      if (Number.isFinite(dur) && dur > 0) progressEl.max = dur;
      progressEl.value = Number.isFinite(cur) ? cur : 0;
    } catch {
      /* the element may be a stub — never break playback for it */
    }
  }

  function resetProgress() {
    setProgress(0, progressEl ? progressEl.max || 0 : 0);
  }

  function revoke(url) {
    if (typeof url !== "string" || url.indexOf("blob:") !== 0) return;
    try {
      if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(url);
      }
    } catch {
      /* ignore */
    }
  }

  function resolveItem(item, value) {
    if (!item || item.settled) return;
    item.settled = true;
    if (typeof item.resolve === "function") {
      try {
        item.resolve(value);
      } catch {
        /* a listener must never break the queue */
      }
    }
  }

  // ---- the queue pump ----------------------------------------------------

  // Start the next waiting line if the player is idle. Called whenever a line
  // is enqueued, finishes, fails, or is interrupted.
  // Browsers only allow audio after a user gesture. Call this from the click
  // that starts the game; a 1-sample silent WAV primes the element.
  function unlock() {
    const el = getAudio();
    if (!el) return;
    try {
      el.src =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";
      const played = el.play();
      if (played && played.catch) played.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  function pump() {
    if (current || lines.length === 0) return;

    const item = lines.shift();
    item.cancelled = false;
    current = item;

    const el = getAudio();
    if (!el) {
      // No audio available (e.g. headless): drop the line and move on.
      settle(item);
      return;
    }

    let urlPromise;
    try {
      urlPromise = typeof speak === "function"
        ? speak(item.text, item.voice)
        : Promise.reject(new Error("voice: no speak() provided"));
    } catch (err) {
      urlPromise = Promise.reject(err);
    }

    Promise.resolve(urlPromise).then(
      (url) => playItem(item, url),
      (err) => {
        if (typeof onError === "function") {
          try { onError(err, item.text); } catch { /* ignore */ }
        }
        settle(item); // speak failed -> skip the line, keep going
      },
    );
  }

  // Play one resolved line on the shared Audio element. Any failure (bad URL,
  // autoplay rejection, decode error) skips the line instead of throwing.
  function playItem(item, url) {
    // Interrupted/stopped while speak() was still running? Drop it.
    if (current !== item || item.settled) return;

    const el = getAudio();
    if (!el || !url) {
      settle(item);
      return;
    }

    item.url = url;
    setProgress(0, 0);

    // The line begins now — announce it to the UI.
    if (typeof onLine === "function") {
      try {
        onLine(item.text);
      } catch {
        /* ignore UI errors */
      }
    }

    // Fallback for shims without addEventListener.
    el.onended = () => settle(item);
    el.onerror = () => settle(item);

    let played;
    try {
      el.src = url;
      played = el.play();
    } catch {
      settle(item);
      return;
    }
    if (played && typeof played.catch === "function") {
      // Autoplay policy rejection (or any play error) -> skip, never throw.
      played.catch((err) => {
        if (typeof onError === "function") {
          try { onError(err, item.text); } catch { /* ignore */ }
        }
        settle(item);
      });
    }
  }

  // Finish/skip a line, free its URL, resolve its promise, and pump the next.
  function settle(item) {
    if (!item || item.settled) return;
    item.settled = true;
    if (item.url) revoke(item.url);

    const wasCurrent = current === item;
    if (wasCurrent) {
      current = null;
      const el = audio;
      if (el) {
        try {
          el.onended = null;
          el.onerror = null;
        } catch {
          /* ignore */
        }
      }
      resetProgress();
    }

    if (typeof item.resolve === "function") {
      try {
        item.resolve();
      } catch {
        /* ignore */
      }
    }

    // Safe even if this item was cancelled: pump() no-ops while busy.
    pump();
  }

  function clearQueue() {
    while (lines.length) {
      const item = lines.shift();
      item.cancelled = true;
      resolveItem(item);
    }
  }

  // ---- public API --------------------------------------------------------

  // Distinct voices for the host and every player, cycling if the table is
  // larger than the pool.
  function casting(playerCount) {
    const n = Math.max(0, Math.floor(Number(playerCount)) || 0);
    let cursor = 0;
    const nextVoice = () => VOICE_POOL[cursor++ % VOICE_POOL.length];
    const host = nextVoice();
    const players = [];
    for (let i = 0; i < n; i++) players.push(nextVoice());
    return { host, players };
  }

  // Enqueue a line. With { interrupt: true } the current audio is stopped and
  // the pending queue cleared before this line is added.
  function say(text, voice, options) {
    const opts = options || {};
    const line = text == null ? "" : String(text);

    if (opts.interrupt) {
      stop();
    }

    if (!line.trim()) return Promise.resolve();

    return new Promise((resolve) => {
      lines.push({ text: line, voice, resolve, settled: false, cancelled: false });
      pump();
    });
  }

  // Stop playback and clear the queue.
  function stop() {
    clearQueue();

    const item = current;
    current = null;
    const el = audio;
    if (el) {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
      try {
        if (typeof el.removeAttribute === "function") el.removeAttribute("src");
      } catch {
        /* ignore */
      }
    }
    if (item) {
      item.cancelled = true;
      if (item.url) revoke(item.url);
      resolveItem(item);
    }
    resetProgress();
  }

  function isSpeaking() {
    if (!current) return false;
    if (audio && typeof audio.paused === "boolean" && audio.currentSrc) {
      return !audio.paused;
    }
    return true;
  }

  function queue() {
    return lines.length;
  }

  // Attach (or detach with null) a <progress>-like element updated as audio
  // plays.
  function attach(el) {
    progressEl = el || null;
    if (progressEl) {
      try {
        progressEl.value = 0;
      } catch {
        /* ignore */
      }
    }
  }

  // ---- recording (optional spoken votes) ---------------------------------

  // `rec` holds the in-progress capture:
  // { recorder, stream, chunks, stopRequested, promise, resolve, reject }.
  let rec = null;

  function releaseStream(stream) {
    try {
      if (stream && typeof stream.getTracks === "function") {
        const tracks = stream.getTracks();
        for (let i = 0; i < tracks.length; i++) {
          if (tracks[i] && typeof tracks[i].stop === "function") tracks[i].stop();
        }
      }
    } catch {
      /* ignore */
    }
  }

  function failRec(state, err) {
    if (rec === state) rec = null;
    releaseStream(state.stream);
    state.reject(err);
  }

  function finishRec(state) {
    if (rec === state) rec = null;
    releaseStream(state.stream);

    let blob;
    try {
      const Ctor = globalThis.Blob;
      blob = typeof Ctor === "function"
        ? new Ctor(state.chunks, { type: (state.recorder && state.recorder.mimeType) || "audio/webm" })
        : null;
    } catch {
      blob = null;
    }

    if (typeof transcribe !== "function" || !blob) {
      state.resolve(blob);
      return;
    }
    Promise.resolve()
      .then(() => transcribe(blob))
      .then(
        (text) => state.resolve(text),
        () => state.resolve(blob), // transcription failed -> hand back the blob
      );
  }

  async function startRec(state) {
    const MR = globalThis.MediaRecorder;
    const nav = globalThis.navigator;
    try {
      if (typeof MR !== "function" || !nav || !nav.mediaDevices ||
          typeof nav.mediaDevices.getUserMedia !== "function") {
        throw new Error("voice: MediaRecorder unavailable");
      }
      state.stream = await nav.mediaDevices.getUserMedia({ audio: true });
      if (rec !== state) {
        releaseStream(state.stream);
        return;
      }
      state.recorder = new MR(state.stream);
      state.recorder.ondataavailable = (e) => {
        if (e && e.data) state.chunks.push(e.data);
      };
      state.recorder.onerror = (e) => {
        failRec(state, (e && e.error) || e || new Error("voice: recorder error"));
      };
      state.recorder.onstop = () => finishRec(state);
      state.recorder.start();
      if (state.stopRequested) {
        try {
          if (state.recorder.state !== "inactive") state.recorder.stop();
        } catch (err) {
          failRec(state, err);
        }
      }
    } catch (err) {
      failRec(state, err);
    }
  }

  // Begin capturing. Resolves (at stopRecording) to the transcript when a
  // transcribe() is supplied, otherwise to the recorded Blob.
  function record() {
    if (rec) return rec.promise;

    const state = {
      recorder: null,
      stream: null,
      chunks: [],
      stopRequested: false,
      promise: null,
      resolve: null,
      reject: null,
    };
    state.promise = new Promise((resolve, reject) => {
      state.resolve = resolve;
      state.reject = reject;
    });
    rec = state;
    startRec(state);
    return state.promise;
  }

  function stopRecording() {
    const state = rec;
    if (!state) return Promise.resolve(null);
    state.stopRequested = true;
    if (state.recorder && state.recorder.state !== "inactive") {
      try {
        state.recorder.stop();
      } catch (err) {
        failRec(state, err);
      }
    }
    return state.promise;
  }

  return {
    casting,
    say,
    stop,
    isSpeaking,
    queue,
    unlock,
    record,
    stopRecording,
    attach,
  };
}

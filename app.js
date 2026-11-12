import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.1.0/+esm";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- settings ----------
function showSetup(show) { $("setup").hidden = !show; }
$("key").value = store.get("apiKey", "");
$("model").value = store.get("asrModel", "onnx-community/whisper-base");
$("settingsBtn").onclick = () => showSetup($("setup").hidden);
$("save").onclick = () => {
  store.set("apiKey", $("key").value.trim());
  store.set("asrModel", $("model").value);
  showSetup(false);
  if (pendingFile) { const f = pendingFile; pendingFile = null; handleFile(f); }
};
if (!store.get("apiKey")) showSetup(true);

// ---------- history ----------
function loadHistory() { try { return JSON.parse(store.get("history", "[]")); } catch { return []; } }
function saveHistory(item) {
  const h = [item, ...loadHistory()].slice(0, 20);
  store.set("history", JSON.stringify(h));
  renderHistory();
}
function renderSummary(el, text) {
  el.textContent = "";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let ul = null;
  for (const line of lines) {
    if (/^[-•*]\s+/.test(line)) {
      if (!ul) { ul = document.createElement("ul"); el.append(ul); }
      const li = document.createElement("li");
      li.textContent = line.replace(/^[-•*]\s+/, "");
      ul.append(li);
    } else {
      ul = null;
      const p = document.createElement("div");
      p.textContent = line;
      el.append(p);
    }
  }
}
function renderHistory() {
  const h = loadHistory();
  $("historyWrap").hidden = h.length === 0;
  const box = $("history");
  box.textContent = "";
  for (const item of h) {
    const c = document.createElement("div");
    c.className = "card";
    const w = document.createElement("div");
    w.className = "when";
    w.textContent = new Date(item.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) + (item.name ? " · " + item.name : "");
    const s = document.createElement("div");
    renderSummary(s, item.summary);
    const d = document.createElement("details");
    const sm = document.createElement("summary");
    sm.textContent = "Full transcript";
    const p = document.createElement("p");
    p.textContent = item.transcript;
    d.append(sm, p);
    c.append(w, s, d);
    box.append(c);
  }
}
renderHistory();

// ---------- UI state ----------
function status(text, isErr = false) {
  $("current").hidden = false;
  $("result").hidden = true;
  $("status").hidden = false;
  $("statusText").textContent = text;
  $("statusText").className = isErr ? "err" : "";
  $("status").querySelector(".spin").hidden = isErr;
}

// ---------- audio decode (16 kHz mono) ----------
async function decodeTo16k(arrayBuffer) {
  const ctx = new AudioContext();
  let decoded;
  try { decoded = await ctx.decodeAudioData(arrayBuffer); } finally { ctx.close(); }
  const length = Math.ceil(decoded.duration * 16000);
  const off = new OfflineAudioContext(1, length, 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return { samples: rendered.getChannelData(0), seconds: decoded.duration };
}

// ---------- transcription (in a worker) ----------
let worker;
function transcribe(samples, model) {
  worker ??= new Worker(new URL("./asr-worker.js", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") status(data.text);
      else if (data.type === "done") resolve(data.text);
      else if (data.type === "error") reject(new Error(data.message));
    };
    worker.onerror = (e) => reject(new Error(e.message || "Speech recognition failed to start"));
    const copy = new Float32Array(samples);
    worker.postMessage({ samples: copy, model }, [copy.buffer]);
  });
}

// ---------- summary ----------
const SYSTEM = `You summarise WhatsApp voice notes so the listener doesn't have to play them.
The input is an automatic transcript and may contain recognition errors; infer the intended meaning.
Write in English, whatever language the note is in.
Format, plain text only:
- First line: one or two sentences saying what the note is about and the main point.
- Then, only if there are any, short bullet lines starting with "- " for things that need the listener's attention: questions asked of them, requests, plans, times, dates, places, names, numbers.
Keep the whole thing under 80 words. No preamble, no headings, no markdown other than the "- " bullets.
If the transcript is empty or meaningless, say so in one line.`;

async function summarise(transcript, apiKey) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const msg = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 2000,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: `<transcript>\n${transcript}\n</transcript>` }],
  });
  if (msg.stop_reason === "refusal") throw new Error("Claude declined to summarise this note.");
  return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return "Your Claude API key was rejected. Check it in Settings.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is rate limiting right now. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check your internet connection.";
  if (e instanceof Anthropic.APIError) return `Claude API error (${e.status ?? "?"}): ${e.message}`;
  if (e?.name === "EncodingError") return "Couldn't read that audio file.";
  return e?.message || String(e);
}

// ---------- main flow ----------
let pendingFile = null;
let busy = false;
async function handleFile(file) {
  if (busy) return;
  const apiKey = store.get("apiKey");
  if (!apiKey) { pendingFile = file; showSetup(true); status("Add your Claude API key to continue."); return; }
  busy = true;
  $("empty").hidden = true;
  try {
    status("Reading voice note…");
    const { samples, seconds } = await decodeTo16k(await file.arrayBuffer());
    status(`Transcribing ${Math.round(seconds)}s of audio…`);
    const transcript = (await transcribe(samples, store.get("asrModel", "onnx-community/whisper-base"))).trim();
    status("Summarising…");
    const summary = transcript ? await summarise(transcript, apiKey) : "No speech detected in this voice note.";
    $("status").hidden = true;
    $("result").hidden = false;
    renderSummary($("summary"), summary);
    $("transcript").textContent = transcript || "(empty)";
    saveHistory({ at: Date.now(), name: file.name && !/^(audio|share)/i.test(file.name) ? file.name : "", summary, transcript });
  } catch (e) {
    console.error(e);
    status(friendlyError(e), true);
  } finally {
    busy = false;
    $("empty").hidden = false;
  }
}

$("file").onchange = (e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; };

// ---------- share target + offline ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

async function takeSharedFile() {
  const cache = await caches.open("shared-files");
  const res = await cache.match("shared-audio");
  if (!res) return null;
  await cache.delete("shared-audio");
  const blob = await res.blob();
  const name = decodeURIComponent(res.headers.get("x-file-name") || "voice-note");
  return new File([blob], name, { type: blob.type });
}
const params = new URLSearchParams(location.search);
if (params.has("shared")) {
  history.replaceState(null, "", location.pathname);
  if (params.get("shared") === "none") status("Nothing came through from the share. Try sharing the voice note again.", true);
  else takeSharedFile().then((f) => f ? handleFile(f) : status("The shared voice note was not found. Try sharing it again.", true));
}

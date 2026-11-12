import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.1.0/+esm";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const DEFAULT_MODEL = "onnx-community/whisper-base";

// ---------- navigation ----------
const VIEWS = ["home", "processing", "result", "history", "settings"];
let current = "home";
function show(view) {
  for (const v of VIEWS) $("v-" + v).hidden = v !== view;
  current = view;
  window.scrollTo(0, 0);
  if (view === "home") $("keyNotice").hidden = !!store.get("apiKey");
  if (view === "history") renderHistory();
  if (view === "settings") { $("key").value = store.get("apiKey", ""); $("model").value = store.get("asrModel", DEFAULT_MODEL); }
}
// Android back button: every view except home sits on top of home in browser history.
function go(view) {
  if (view === "home") { if (history.state?.view) history.back(); else show("home"); return; }
  // Processing and settings are transient: replace them so Back skips over them.
  if (history.state?.view && (current === "processing" || current === "settings")) history.replaceState({ view }, "");
  else history.pushState({ view }, "");
  show(view);
}
addEventListener("popstate", () => { if (busy && current === "processing") history.pushState({ view: "processing" }, ""); else show(history.state?.view || "home"); });
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]"); if (g) go(g.dataset.go);
  if (e.target.closest("[data-back]")) history.state?.view ? history.back() : show("home");
});

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 1800);
}

// ---------- settings ----------
$("save").onclick = () => {
  store.set("apiKey", $("key").value.trim());
  store.set("asrModel", $("model").value);
  toast("Settings saved");
  if (pendingFile && store.get("apiKey")) { const f = pendingFile; pendingFile = null; handleFile(f); }
  else history.state?.view ? history.back() : show("home");
};
$("clearHist").onclick = () => {
  if (!confirm("Delete all saved summaries from this phone?")) return;
  store.set("history", "[]"); toast("History cleared");
};

// ---------- history ----------
function loadHistory() { try { return JSON.parse(store.get("history", "[]")); } catch { return []; } }
function saveHistory(item) { store.set("history", JSON.stringify([item, ...loadHistory()].slice(0, 50))); }
// Older entries stored the summary as one string with "- " bullet lines.
function normalise(item) {
  if (item.points) return item;
  const lines = (item.summary || "").split("\n").map((l) => l.trim()).filter(Boolean);
  return { ...item, title: "", summary: lines.filter((l) => !/^[-•*]\s/.test(l)).join(" "), points: lines.filter((l) => /^[-•*]\s/.test(l)).map((l) => l.replace(/^[-•*]\s+/, "")) };
}
const fmtWhen = (ts) => {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return "Today, " + time;
  if (new Date(now - 864e5).toDateString() === d.toDateString()) return "Yesterday, " + time;
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) + ", " + time;
};
const fmtDur = (s) => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "";

function renderHistory() {
  const items = loadHistory().map(normalise);
  $("hEmpty").hidden = items.length > 0;
  const list = $("hList"); list.textContent = "";
  items.forEach((item) => {
    const b = document.createElement("button");
    b.className = "card h-item";
    const t = document.createElement("div"); t.className = "t";
    const name = document.createElement("span"); name.textContent = item.title || "Voice note";
    const when = document.createElement("time"); when.textContent = fmtWhen(item.at);
    t.append(name, when);
    const s = document.createElement("div"); s.className = "s"; s.textContent = item.summary;
    b.append(t, s);
    b.onclick = () => { renderResult(item); go("result"); };
    list.append(b);
  });
}

// ---------- result ----------
let shown = null;
const ICON_CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
function chip(text, icon) {
  const c = document.createElement("span"); c.className = "chip";
  if (icon) c.insertAdjacentHTML("afterbegin", icon);
  c.append(text); return c;
}
function renderResult(item) {
  shown = item;
  const meta = $("rMeta"); meta.textContent = "";
  meta.append(chip(fmtWhen(item.at), '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'));
  if (item.seconds) meta.append(chip(fmtDur(item.seconds), '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>'));
  $("rTitle").textContent = item.title || "Voice note";
  $("rSummary").textContent = item.summary;
  const ul = $("rPoints"); ul.textContent = "";
  for (const p of item.points || []) {
    const li = document.createElement("li");
    li.insertAdjacentHTML("afterbegin", `<span class="dot">${ICON_CHECK}</span>`);
    const span = document.createElement("span"); span.textContent = p; li.append(span);
    ul.append(li);
  }
  $("rPointsWrap").hidden = !(item.points || []).length;
  $("rTranscript").textContent = item.transcript || "(empty)";
  document.querySelector(".transcript").open = false;
}
const asText = (i) => [i.title, i.summary, ...(i.points || []).map((p) => "• " + p)].filter(Boolean).join("\n");
$("copyBtn").onclick = async () => {
  try { await navigator.clipboard.writeText(asText(shown)); toast("Summary copied"); } catch { toast("Couldn't copy"); }
};
$("shareBtn").onclick = async () => {
  if (navigator.share) { try { await navigator.share({ text: asText(shown) }); } catch {} }
  else $("copyBtn").click();
};

// ---------- processing UI ----------
function setStep(step, detail = "") {
  const order = ["read", "transcribe", "summarise"];
  const idx = order.indexOf(step);
  for (const li of $("stepper").children) {
    const i = order.indexOf(li.dataset.step);
    li.className = i < idx ? "done" : i === idx ? "active" : "pending";
    if (i === idx) li.querySelector(".detail").textContent = detail;
    else if (i < idx) li.querySelector(".detail").textContent = li.dataset.doneDetail || "";
    else li.querySelector(".detail").textContent = "";
  }
}
function setDownload(pct) {
  const li = $("stepper").querySelector('[data-step="transcribe"]');
  li.querySelector(".detail").textContent = `Downloading speech model, first time only (${pct}%)`;
  li.querySelector(".bar-track").hidden = false;
  li.querySelector(".bar-fill").style.width = pct + "%";
}
function startProcessing() {
  $("procBody").hidden = false; $("procError").hidden = true;
  for (const li of $("stepper").children) { delete li.dataset.doneDetail; li.querySelector(".bar-track")?.setAttribute("hidden", ""); }
  go("processing");
}
function showError(msg) {
  $("procBody").hidden = true; $("procError").hidden = false;
  $("errText").textContent = msg;
}

// ---------- audio decode (16 kHz mono) ----------
async function decodeTo16k(arrayBuffer) {
  const ctx = new AudioContext();
  let decoded;
  try { decoded = await ctx.decodeAudioData(arrayBuffer); } finally { ctx.close(); }
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded; src.connect(off.destination); src.start();
  const rendered = await off.startRendering();
  return { samples: rendered.getChannelData(0), seconds: decoded.duration };
}

// ---------- transcription (in a worker) ----------
let worker;
function transcribe(samples, model) {
  worker ??= new Worker(new URL("./asr-worker.js", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === "download") setDownload(data.pct);
      else if (data.type === "transcribing") { $("stepper").querySelector(".bar-track").hidden = true; setStep("transcribe", "Listening to the audio on your phone"); }
      else if (data.type === "done") resolve(data.text);
      else if (data.type === "error") reject(new Error(data.message));
    };
    worker.onerror = (e) => reject(new Error(e.message || "Speech recognition failed to start."));
    const copy = new Float32Array(samples);
    worker.postMessage({ samples: copy, model }, [copy.buffer]);
  });
}

// ---------- summary ----------
const SYSTEM = `You summarise WhatsApp voice notes so the listener doesn't have to play them.
The input is an automatic transcript and may contain recognition errors; infer the intended meaning.
Write in English, whatever language the note is in. Address the listener as "you" and refer to the speaker as "they" unless they name themselves.
Return:
- title: 2 to 6 words naming the topic, sentence case, no full stop.
- summary: one or two plain sentences with the main point. Under 45 words.
- points: only things that need the listener's attention or are worth remembering: questions asked of them, requests, plans, times, dates, places, names, numbers. Each under 12 words. Use an empty list when there are none; don't repeat the summary.
If the transcript is empty or meaningless, say so in the summary and leave points empty.`;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    points: { type: "array", items: { type: "string" } },
  },
  required: ["title", "summary", "points"],
  additionalProperties: false,
};

async function summarise(transcript, apiKey) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const msg = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: `<transcript>\n${transcript}\n</transcript>` }],
  });
  if (msg.stop_reason === "refusal") throw new Error("Claude declined to summarise this note.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const out = JSON.parse(text);
  return { title: out.title.trim(), summary: out.summary.trim(), points: out.points.map((p) => p.trim()).filter(Boolean) };
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return "Your Claude API key was rejected. Check it in Settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "Your Claude API key isn't allowed to do this. Check your account in the Claude Console.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is busy right now. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check your internet connection and try again.";
  if (e instanceof Anthropic.APIError) {
    if (/credit balance/i.test(e.message)) return "Your Claude account is out of credit. Add some under Billing in the Claude Console.";
    return `Claude returned an error (${e.status ?? "unknown"}). Try again shortly.`;
  }
  if (e?.name === "EncodingError") return "This file couldn't be read as audio.";
  return e?.message || String(e);
}

// ---------- main flow ----------
let pendingFile = null;
let busy = false;
async function handleFile(file) {
  if (busy) return;
  const apiKey = store.get("apiKey");
  if (!apiKey) { pendingFile = file; go("settings"); toast("Add your API key to continue"); return; }
  busy = true;
  startProcessing();
  try {
    setStep("read");
    const { samples, seconds } = await decodeTo16k(await file.arrayBuffer());
    $("stepper").children[0].dataset.doneDetail = fmtDur(seconds) + " of audio";
    setStep("transcribe", "Preparing…");
    const transcript = (await transcribe(samples, store.get("asrModel", DEFAULT_MODEL))).trim();
    setStep("summarise");
    const s = transcript
      ? await summarise(transcript, apiKey)
      : { title: "No speech found", summary: "This voice note doesn't seem to contain any speech.", points: [] };
    const item = { at: Date.now(), seconds, transcript, ...s };
    saveHistory(item);
    renderResult(item);
    busy = false;
    go("result");
  } catch (e) {
    console.error(e);
    showError(friendlyError(e));
  } finally {
    busy = false;
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
  return new File([blob], decodeURIComponent(res.headers.get("x-file-name") || "voice-note"), { type: blob.type });
}

const shared = new URLSearchParams(location.search).get("shared");
history.replaceState(null, "", location.pathname);
show("home");
if (shared === "none") { startProcessing(); showError("Nothing came through from WhatsApp. Try sharing the voice note again."); }
else if (shared) takeSharedFile().then((f) => {
  if (f) handleFile(f);
  else { startProcessing(); showError("The shared voice note wasn't found. Try sharing it again."); }
});

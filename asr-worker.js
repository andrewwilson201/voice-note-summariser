import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";
import { createModelStore, isModelSaved } from "./model-store.js";

env.allowLocalModels = false;
// Keep the model in our own store (see model-store.js) so it downloads once and is reused.
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = createModelStore((r) => postMessage({ type: "store", ...r }));

const SR = 16000;
let asr = null;
let loaded = null; // { model, engine }

async function hasWebGPU() {
  try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; }
}

// Progress events fire both for real downloads and for reading the saved copy, so
// check the store first to tell the user which one is happening.
async function load(model, device, dtype) {
  const cached = await isModelSaved(model, device === "webgpu" ? "encoder_model.onnx" : "encoder_model_quantized.onnx");
  const files = {};
  return pipeline("automatic-speech-recognition", model, {
    device,
    dtype,
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files[p.file] = [p.loaded, p.total];
        let l = 0, t = 0;
        for (const [a, b] of Object.values(files)) { l += a; t += b; }
        postMessage({ type: "download", pct: Math.round((l / t) * 100), cached });
      }
    },
  });
}

// Default: several CPU cores, then one core. Both use the same saved model files.
// The graphics chip is opt-in: it needs a separate, larger download and is slow to
// start on many phones.
async function getPipeline(model, mode, skip = []) {
  if (asr && loaded.model === model && loaded.mode === mode && !skip.includes(loaded.engine)) return asr;
  const attempts = [];
  if (mode === "gpu" && !skip.includes("gpu") && (await hasWebGPU())) {
    attempts.push(["gpu", () => load(model, "webgpu", { encoder_model: "fp32", decoder_model_merged: "q4" })]);
  }
  if (!skip.includes("multicore") && self.crossOriginIsolated && navigator.hardwareConcurrency > 1) {
    attempts.push(["multicore", () => {
      env.backends.onnx.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency);
      return load(model, "wasm", "q8");
    }]);
  }
  attempts.push(["single", () => {
    env.backends.onnx.wasm.numThreads = 1;
    return load(model, "wasm", "q8");
  }]);

  let lastErr;
  for (const [engine, start] of attempts) {
    try {
      asr = await start();
      loaded = { model, engine, mode };
      return asr;
    } catch (e) {
      lastErr = e;
      console.warn(`Speech engine "${engine}" failed to start`, e);
    }
  }
  throw lastErr;
}

// Split long audio into pieces of at most 29s, cutting at the quietest moment in the
// last few seconds of each piece so words are rarely cut in half. No overlap, so no
// audio is processed twice.
function splitAudio(samples) {
  const MAX = 29 * SR, SEARCH = 4 * SR, FRAME = SR / 10;
  const parts = [];
  let start = 0;
  while (samples.length - start > MAX) {
    let best = start + MAX, bestEnergy = Infinity;
    for (let f = start + MAX - SEARCH; f + FRAME <= start + MAX; f += FRAME) {
      let e = 0;
      for (let i = f; i < f + FRAME; i += 4) e += samples[i] * samples[i];
      if (e < bestEnergy) { bestEnergy = e; best = f + FRAME / 2; }
    }
    parts.push(samples.subarray(start, best));
    start = best;
  }
  if (samples.length - start > SR / 4 || parts.length === 0) parts.push(samples.subarray(start));
  return parts;
}

async function run(model, samples, mode, skip = []) {
  const transcriber = await getPipeline(model, mode, skip);
  const engine = loaded.engine;
  const parts = splitAudio(samples);
  const texts = [];
  try {
    for (let i = 0; i < parts.length; i++) {
      postMessage({ type: "transcribing", pct: Math.round((i / parts.length) * 100), engine });
      const out = await transcriber(parts[i], { task: "transcribe" });
      texts.push((out.text ?? "").trim());
    }
  } catch (e) {
    // A faster engine can load fine and still fail when used; retry on the next one down.
    if (engine !== "single") {
      console.warn(`Speech engine "${engine}" failed while transcribing`, e);
      return run(model, samples, mode, [...skip, engine]);
    }
    throw e;
  }
  return { text: texts.join(" "), engine };
}

onmessage = async ({ data }) => {
  try {
    const { text, engine } = await run(data.model, data.samples, data.mode, data.mode === "safe" ? ["gpu", "multicore"] : []);
    postMessage({ type: "done", text, engine });
  } catch (e) {
    postMessage({ type: "error", message: "Speech recognition failed: " + (e?.message || e) });
  }
};

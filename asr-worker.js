import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";

env.allowLocalModels = false;
env.useBrowserCache = true; // the model downloads once and is reused

let asr = null;
let loadedModel = null;

async function getPipeline(model) {
  if (asr && loadedModel === model) return asr;
  const files = {};
  asr = await pipeline("automatic-speech-recognition", model, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files[p.file] = [p.loaded, p.total];
        let l = 0, t = 0;
        for (const [a, b] of Object.values(files)) { l += a; t += b; }
        postMessage({ type: "download", pct: Math.round((l / t) * 100) });
      }
    },
  });
  loadedModel = model;
  return asr;
}

onmessage = async ({ data }) => {
  try {
    const run = await getPipeline(data.model);
    postMessage({ type: "transcribing" });
    const out = await run(data.samples, { chunk_length_s: 30, stride_length_s: 5, task: "transcribe" });
    postMessage({ type: "done", text: out.text ?? "" });
  } catch (e) {
    postMessage({ type: "error", message: "Speech recognition failed: " + (e?.message || e) });
  }
};

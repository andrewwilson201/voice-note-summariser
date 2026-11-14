// Where the speech model is kept on the phone.
//
// The speech library's built-in cache wasn't keeping the model between uses, and it
// hides the reason when saving fails. This store replaces it: it saves each model file
// in the browser's Cache Storage with clean headers, falls back to the private file
// system (OPFS) if that fails, and records what happened so Settings can show it.

const CACHE = "speech-models-v1";
const OLD_CACHE = "transformers-cache"; // the library's own cache, read for files saved earlier
const OPFS_DIR = "speech-models";

const urlOf = (key) => (typeof key === "string" ? key : key.url);
const isRemote = (url) => /^https?:\/\//.test(url);

async function fileNameFor(url) {
  const hash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(url));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function opfsDir(create) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create });
}
async function opfsGet(url) {
  try {
    const handle = await (await opfsDir(false)).getFileHandle(await fileNameFor(url));
    const file = await handle.getFile();
    return file.size ? file : null;
  } catch { return null; }
}
async function opfsPut(url, buffer) {
  const handle = await (await opfsDir(true)).getFileHandle(await fileNameFor(url), { create: true });
  const w = await handle.createWritable();
  await w.write(buffer);
  await w.close();
}

export function createModelStore(report = () => {}) {
  return {
    async match(key) {
      const url = urlOf(key);
      if (!isRemote(url)) return undefined;
      for (const name of [CACHE, OLD_CACHE]) {
        try {
          const hit = await (await caches.open(name)).match(url, { ignoreVary: true, ignoreSearch: false });
          if (hit) return hit;
        } catch {}
      }
      const file = await opfsGet(url);
      if (file) return new Response(file, { headers: { "content-length": String(file.size), "content-type": "application/octet-stream" } });
      return undefined;
    },

    async put(key, response) {
      const url = urlOf(key);
      if (!isRemote(url)) return;
      const buffer = await response.arrayBuffer();
      const headers = { "content-length": String(buffer.byteLength), "content-type": response.headers.get("content-type") || "application/octet-stream" };
      let cacheError;
      try {
        const cache = await caches.open(CACHE);
        await cache.put(url, new Response(buffer, { headers }));
        // Confirm it is really there before trusting it.
        if (!(await cache.match(url, { ignoreVary: true }))) throw new Error("saved file could not be read back");
        report({ url, ok: true, where: "cache", bytes: buffer.byteLength });
        return;
      } catch (e) {
        cacheError = e;
      }
      try {
        await opfsPut(url, buffer);
        report({ url, ok: true, where: "files", bytes: buffer.byteLength, note: String(cacheError?.message || cacheError) });
      } catch (e) {
        report({ url, ok: false, bytes: buffer.byteLength, error: `${cacheError?.name || "Error"}: ${cacheError?.message || cacheError}; ${e?.name || "Error"}: ${e?.message || e}` });
      }
    },
  };
}

// Is this model's main file saved on the phone? Used for the progress label and Settings.
export async function isModelSaved(model, encoderFile = "encoder_model_quantized.onnx") {
  const url = `https://huggingface.co/${model}/resolve/main/onnx/${encoderFile}`;
  return !!(await createModelStore().match(url));
}

// Storage facts for the Settings screen.
export async function storageStatus() {
  const out = { persisted: null, usedMB: null, quotaMB: null };
  try { out.persisted = await navigator.storage.persisted(); } catch {}
  try {
    const e = await navigator.storage.estimate();
    out.usedMB = Math.round((e.usage || 0) / 1048576);
    out.quotaMB = Math.round((e.quota || 0) / 1048576);
  } catch {}
  return out;
}

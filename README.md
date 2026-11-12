# Voice Summary

Share a WhatsApp voice note to this app on Android and get a two or three line summary, so you don't have to listen to it.

## How it works

1. **Speech to text, on the phone.** The voice note is transcribed in the browser with an open-source Whisper model ([Transformers.js](https://github.com/huggingface/transformers.js)). The model downloads once (about 80 MB for the default setting) and is cached. The audio never leaves the phone.
2. **Summary, by Claude.** Only the transcript text is sent to the Claude API, using your own API key, which is stored in the browser on your phone.

It's a static web app (no server), hosted on GitHub Pages.

## Install on Android

1. Open the GitHub Pages address in **Chrome** on your phone.
2. Tap Settings in the app, paste your Claude API key, and save.
3. Chrome menu (⋮) → **Add to Home screen** → **Install**. Installing is what makes it show up in the Share menu.

## Use

In WhatsApp, long-press a voice note → **Share** → **Voice Summary**. The summary appears in a few seconds. You can also open the app and pick an audio file. The last 20 summaries are kept on the phone under "Recent".

## Settings

- **Speech recognition**: Fastest (whisper-tiny), Balanced (whisper-base, default), Most accurate (whisper-small).

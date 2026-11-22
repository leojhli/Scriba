# Pause & Effect — CLAUDE.md

**Pitch:** "You just watch. It builds your study program."

Making study material from media is work learners do by hand today: pausing, looking things up, making flashcards, finding practice. Pause & Effect is a coworker that does all of it while you watch YouTube.

**Goal:** A Chrome extension that overlays real YouTube and turns whatever you watch into a study program, backed by a Wasp app. Built and demoed live in the 11:00–3:00 window (ElevenLabs hackathon).

This file is the implementation plan (v3), updated to match what's built. The **Interfaces** section is a contract between four people: don't change it without telling the team. **To run the demo, see [DEMO.md](DEMO.md).**

## Status (2026-11-22, ~12:10)

All tasks are built. **Verified end to end in real Chrome on a real Spanish video** (`aUGOFL0Ygsw`):
- ingest: 62 s, 11 segments, dialogue isolated
- pause: explanation + translations in ~5.5 s, and the mascot voice plays
- Hear it clearly: mutes YouTube, plays the isolated clip at 0.75×, then unmutes
- the deck lists the paused line

Not verified: shadowing with a real microphone (needs a human), and the /practice page in a browser.

| Task | State |
|---|---|
| 0 Skeletons | ✅ |
| 1 Ingest + session | ✅ verified live |
| 2 Struggle detection | ❌ removed by decision: pause is the only signal (see below) |
| 3 Overlay + pause flow | ✅ verified live |
| 4 Explanation + voice | ✅ verified live (Claude ~4 s + TTS ~1 s; explain timeout 15 s, last 3 lines only) |
| 5 Hear it clearly | ✅ verified live |
| 6 Shadowing | ✅ built; scoring unit-tested; mic flow untested |
| 7 Deck + practice | ✅ built; getDeck verified |
| 8 Unbreakable demo | ✅ caches + offline chip; `demo-cache/aUGOFL0Ygsw` exported. Still to do: a 2nd demo video |
| 9 Submission | README done; video + screenshots still to do |

**Demo Chrome window:** Chrome 157 ignores `--load-extension`, so the demo profile (`.chrome-demo-profile/`, gitignored) is launched with `--enable-unsafe-extension-debugging --remote-debugging-port=9333`, and the extension is loaded via the CDP call `Extensions.loadUnpacked`. Or just use "Load unpacked" in normal Chrome.

## Any language (decided 2026-11-22)

The user demos Mandarin as well as Spanish, so there is **no fixed `LANGUAGE`** any more.
- **Detection:** Scribe auto-detects the language per video. It is saved as `language` in `data/{id}/video.json` and reused when transcribing shadowing attempts.
- **Chinese and Japanese text:** `src/shared/text.ts` joins words without spaces between Han/Kana characters. `src/shared/segments.ts` splits lines at 。！？ as well as .?!, at pauses over 0.8 s, and at a comma once a line is already 6 s long (lyrics).
- **Scoring:** `normalize()` tokenizes Han/Kana per character, so Chinese and Japanese are scored per character.
- **Tutor prompt:** language-neutral. It writes English translations, adds pinyin or romaji for Chinese and Japanese, and gives the spoken summary in English.
- **Verified end to end:** Spanish (`aUGOFL0Ygsw`) and Mandarin (`YCIFNPMu0hs`; the explanation came back in 7 s with pinyin notes).

## Scope decision: pause is the only signal

The team decided to drop rewind/replay/captions-on/slowdown tracking. **Pausing is the whole interaction: pause → explanation + voice, and the line goes into the deck.** The deck ranks lines by how many times you paused on them. There is no `/ext/struggle`, no `struggle.ts` and no "flagged" chips. The extension still *reads* on-screen captions, but only as the transcript fallback while Scribe is processing.

---

## Repo layout and dev setup (as built in Task 0)

```
extension/   Chrome MV3 extension (TypeScript + esbuild, no framework)
wasp-app/    Wasp 0.22 app (React + Node + Prisma/SQLite)
demo-cache/  pre-processed data for the 2 demo videos (Task 8, not created yet)
```

- **Toolchain on the demo laptop (Intel Mac):** Homebrew can't build here (the Command Line Tools are too old), so everything lives in `~/.local`, and `~/.zshrc` puts `~/.local/node/bin` and `~/.local/bin` on PATH:
  - Node 22 in `~/.local/node`. npm is v11, because npm 10 crashes with "edgesOut" during `wasp compile`.
  - Wasp 0.22 via `npm i -g @wasp.sh/wasp-cli`, not the old installer script.
  - Static ffmpeg 6.0 at `~/.local/bin/ffmpeg`.
  - yt-dlp 2026.10.26 at `~/.local/bin/yt-dlp`. The old `/usr/local/bin/yt-dlp` (2025.06) fails on YouTube with "The page needs to be reloaded". YouTube now needs a JS runtime, so ingest passes `--js-runtimes node:<server's node>`.
  - The server auto-detects both binaries; override with `FFMPEG_PATH` / `YTDLP_PATH`.
- **Run the backend:** `cd wasp-app && cp .env.server.example .env.server` (fill in the keys), then `wasp db migrate-dev`, then `wasp start`. The server runs on `localhost:3001` and the client on `localhost:3000`.
- **Build the extension:** `cd extension && npm i && npm run build` (or `npm run watch`). Load it unpacked from `extension/` at `chrome://extensions`, and reload it after each build.
- **Tests:** run `npm test` (vitest) in either package.
- **Deviations from the plan:**
  - `Video.segments` is `String?` (holding `JSON.stringify(Segment[])`), not `Json?`, because Prisma 5 + SQLite has no Json type. Parse it on read.
  - The content script matches `https://www.youtube.com/*` (not only `/watch*`) so it survives YouTube's SPA navigation into a video. Check `location.pathname === "/watch"` in code.
  - Pause/play are caught with document-level **capture** listeners, so swapping the `<video>` element doesn't break them. A pause only triggers an explanation if it lasts 250 ms (YouTube pauses briefly while scrubbing). Ads are ignored.
  - `Video.status` can also be `"failed"`. The extension stops polling, and a page reload retries the ingest (e.g. after adding keys).
  - `Explanation` has an optional `offline: true` when it came from a cache.
  - `/ext/shadow` also accepts `text` and `origDur`, so captions-only lines (`segmentId: -1`) can be scored before Scribe is ready. Those attempts aren't saved.
  - **No innerHTML in the extension:** YouTube enforces Trusted Types, so the overlay builds its DOM with a small `h()` helper and styles via `adoptedStyleSheets`. Clicks inside the bubble call `stopPropagation()` so they don't toggle YouTube's play/pause.
  - Media goes from the background worker to the content script as base64, and the content script turns it into a `blob:` URL. Service workers can't create blob URLs.
  - Claude call: `claude-sonnet-5-5` on the beta endpoint, with structured JSON output, `thinking: between_tools` (off, for latency), `effort: low`, server-side refusal `fallbacks: "default"`, and a 5.5 s timeout. TTS uses the stock voice `JBFqnCBsd6RMkjVDRZzb` with `eleven_flash_v2_5`. Scribe uses `scribe_v2`. All can be overridden with env vars (`CLAUDE_MODEL`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_SCRIBE_MODEL`).
  - **Titles come from yt-dlp** (`--print after_move:title`), because the YouTube page title is stale right after in-app navigation. Before this fix, titles were off by one video.
  - **Re-ingest:** clears the old line data (`segments` set to null, `explain-*`, `translations.json`), because line ids change.
  - **Status chip:** the extension shows "Listening to the first 3 minutes…", then "Ready · pause anytime", then "Couldn't process…" or "Can't reach the server". Past 3:00, explain falls back to captions and says so if CC is off.
  - **Git:** commit as the user's identity, with no `Co-Authored-By: Claude` trailer.
- **Extension ↔ background messaging:** the content script calls `chrome.runtime.sendMessage({ type: "api", path, body })` and gets back `{ ok: true, data } | { ok: false, error }`. The background worker adds `x-demo-key` and the 8 s timeout (`extension/src/shared/config.ts`).
- **Server auth for /ext/\*:** call `checkDemoKey(req, res)` from `wasp-app/src/server/demoKey.ts` at the top of every ext handler.
- **Shared code:** `src/shared/types.ts` and `config.ts` are duplicated in both packages and must stay identical (the extension's config also holds SERVER_URL, DEMO_KEY and REQUEST_TIMEOUT_MS).

---

## The pipeline (this is the product)

1. **Watches alongside you.** When a video opens, the backend transcribes it with ElevenLabs Scribe, and the extension also reads the on-screen captions live. It always knows what was just said.
2. ~~Notices what you struggle with (rewinds, captions, slowdown).~~ **Removed: pause is the only signal.**
3. **Explains on pause.** The mascot bubble appears over the paused video and explains the last few lines and the scene out loud.
4. **Builds your deck.** Every line you paused on becomes a card in the Wasp web app, ranked by how many times you paused there.
5. **Turns it into practice.** Each card has "Hear it clearly" (dialogue with the music removed, slowed down) and shadowing (say the line and get scored word by word).

## Architecture

**Chrome extension (Manifest V3):**
- A content script on youtube.com/watch records player events and caption lines and draws the overlay inside a shadow DOM on top of `#movie_player`.
- A background service worker makes every call to the backend, so there's no CORS setup.

**Wasp app:**
- Custom api endpoints for the extension: ingest, explain (which also logs the pause) and shadow.
- Prisma storage.
- Two pages for the study program, `/deck` and `/practice`.
- Server work per video: download the first 3 minutes with yt-dlp, then run ElevenLabs Scribe for the transcript and Voice Isolator for the dialogue track. Claude writes the explanations.

**Tech stack:**
- Extension: TypeScript bundled with esbuild, no framework.
- Backend: Wasp (React + Node + Prisma, SQLite), `@elevenlabs/elevenlabs-js`, `@anthropic-ai/sdk` (`claude-sonnet-5-5`), yt-dlp, ffmpeg.
- Tests: vitest for the pure logic.

Spec: idea 3 in the ElevenLabs hackathon ideation doc (Tab 3), the "study program" reframe, and the hacker package rules.

## Global constraints

- No project code before 11:00. Fresh repo after 11:00. Installing tools and making accounts before then is fine.
- Submit by 3:00 PM (target 2:55): project link, a 2-minute demo video anyone can open, and every partner tool used (ElevenLabs, Wasp, plus Codevisor if used).
- Judging: 3 min demo + 2 min Q&A, twice. Lead with the demo. Scoring: technical 25 / partner tools 25 / usefulness 25 / demo 15 / creativity 10.
- One demo laptop runs everything: Chrome with the unpacked extension, plus the Wasp server on `localhost:3001`. (Wasp go/no-go passed: Wasp 0.22.0 is installed.)
- YouTube only. Netflix goes on the roadmap slide (DRM blocks its audio and video).
- Real input: the demo runs on a real YouTube video in Spanish. A judge can pick a different one. The first 3 minutes are processed, and two pre-processed videos are the fallback.
- Language: any. Auto-detected per video by Scribe (originally Spanish only; see "Any language").
- Keys live **only** in the Wasp server's `.env.server`: `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY` and `DEMO_KEY`. The extension holds only `DEMO_KEY`, which maps every request to the demo user.
- Never a blank overlay: it shows "thinking…" immediately, and every call has an 8 s timeout with a cached fallback.
- Mascot voice: a stock ElevenLabs voice, never a cloned actor.

## Review focus (edge cases)

1. **A pause before any line has been said, or mid-sentence.** The window includes overlapping lines. With none, the bubble says "Nothing's been said yet." (Task 3 test)
2. **Captions are off, or the video has none.** Lines come from the server's Scribe transcript. While that's still processing, the overlay says "Still listening…" instead of failing. (Task 1 check)
3. **Ads and scrubbing:** pauses during ads are ignored, and a pause must last 250 ms before it explains anything (YouTube pauses briefly while scrubbing).
4. **A silent or mumbled shadowing attempt** gives accuracy 0 with every word missed, never an error. Accents and punctuation still match (`"¿Qué?"` = `"que"`). (Task 6 test)
5. **Slow Wi-Fi or an API outage mid-demo.** The overlay falls back to cached results within 8 s and shows an "offline mode" chip. (Task 8 check)

## Timeline

| Time | What |
|---|---|
| 9:30–10:00 | Check in, assign roles. Install tools, get keys. |
| 10:00–11:00 | Challenge reveal and idea re-check. Ask 1–2 judges what would impress them. Pick 2 Spanish YouTube videos with real (not auto) captions, at least one with music under the dialogue. Read the Interfaces section aloud. Wasp go/no-go at 10:45. |
| 11:00–11:25 | Task 0: A builds the Wasp skeleton, B the extension skeleton. C and D write the pure modules and their tests (Tasks 2a, 6a). |
| 11:25–12:30 | **V0** end to end: open a video → ingest → pause → overlay shows the explanation text (Tasks 1, 3, 4 text-only) |
| 12:30–12:45 | Lunch at your desk |
| 12:45–1:50 | **V1**: mascot voice, "Hear it clearly", shadowing, deck + practice pages (Tasks 4, 5, 6, 7) |
| 1:50–2:10 | Fallbacks + polish (Task 8). **Feature freeze at 2:10.** |
| 2:10–2:45 | Demo video, screenshots, architecture diagram, submission (Task 9) |
| 2:45–2:55 | Submit |
| 3:00–4:30 | Expo: run the demo script, twice |

**Roles:**
- **A:** Wasp backend and ingest (Tasks 0, 1), then Task 8
- **B:** extension: captions, signals, overlay (Tasks 0, 2b, 3)
- **C:** explanation, voice, "Hear it clearly" (Tasks 2a, 4, 5), then Task 8
- **D:** shadowing and the study program pages (Tasks 6, 7), then the submission from 2:10 (Task 9)

## Interfaces (contract)

`shared/types.ts` is copied into both the extension and the Wasp app (`src/shared/`):

```ts
export type Segment = { id: number; start: number; end: number; text: string }
export type Explanation = { summary: string; audioUrl: string | null;
  lines: { segmentId: number; original: string; translation: string; notes: string[] }[];
  offline?: boolean }
export type ShadowResult = { diff: { word: string; status: "ok" | "missed" | "wrong" | "extra" }[]; accuracy: number; paceRatio: number }
```

**Extension → Wasp endpoints.** All are POST with JSON, carry the header `x-demo-key`, and are called only from the background worker:

| Route | Request | Response |
|---|---|---|
| `/ext/ping` | `{}` | `{ ok: true }` (Task 0 smoke test) |
| `/ext/session` | `{ videoId, title }` | `{ status: "processing" \| "ready" \| "failed", segments: Segment[] \| null, hasDialogue: boolean }`. Starts ingest on the first call; the extension polls every 5 s. |
| `/ext/explain` | `{ videoId, t, captionLines: { text, start, end }[] }` | `Explanation`. Also records a pause Moment. |
| `/ext/shadow` | `{ videoId, segmentId, audioBase64, durationSec, text?, origDur? }` | `ShadowResult & { heard }` |

Wasp operations for the pages: `getDeck` (query) → `DeckCard[]`, and `submitShadow` (action), which uses the same scoring as `/ext/shadow`.

**Media** (`/media/{videoId}/dialogue.mp3`, `explain-{t}.mp3`) is fetched by the background worker and handed to the content script as a `blob:` URL. That avoids mixed-content and CORS issues on youtube.com.

**Prisma entities** (see `wasp-app/schema.prisma`; `segments` is a JSON string, see the deviations above):

```prisma
model User          { id Int @id @default(autoincrement()) moments Moment[] attempts ShadowAttempt[] }
model Video         { id String @id  title String  status String  hasDialogue Boolean  segments String?  createdAt DateTime @default(now()) }
model Moment        { id Int @id @default(autoincrement()) user User @relation(fields: [userId], references: [id]) userId Int
                      videoId String  segmentId Int  kind String  weight Int  createdAt DateTime @default(now()) }
model ShadowAttempt { id Int @id @default(autoincrement()) user User @relation(fields: [userId], references: [id]) userId Int
                      videoId String  segmentId Int  accuracy Float  paceRatio Float  createdAt DateTime @default(now()) }
```

## Files

```
extension/
  manifest.json          MV3; content_scripts on youtube.com; background service worker;
                         host_permissions http://localhost:3001/*
  src/content.ts         wires the modules below to the page
  src/captions.ts        MutationObserver on .ytp-caption-window-container → CaptionLine buffer
  src/signals.ts         pause/play listeners (ads ignored)
  src/messages.ts        content ↔ background protocol, api() + mediaUrl() → blob: URL
  src/recorder.ts        hold-to-record MediaRecorder (webm → base64)
  src/overlay.ts         shadow-DOM bubble, mascot, chips, buttons over #movie_player
  src/background.ts      all fetches to the Wasp server; returns JSON or blob URLs
  src/shared/            types.ts, config.ts, window.ts (+ window.test.ts)
  build: npm run build   (esbuild src/content.ts src/background.ts --bundle --outdir=dist)
wasp-app/
  main.wasp              auth (usernameAndPassword), /deck + /practice pages, api ext* routes (auth: false), server.setupFn
  schema.prisma          entities above
  src/server/demoKey.ts  checkDemoKey(req, res) for every /ext/* handler
  src/server/ping.ts     /ext/ping                              (Task 0)
  src/server/eleven.ts   transcribe(), isolate(), speak()
  src/server/ingest.ts   /ext/session + background ingest       (Task 1)
  src/server/moments.ts  recordPause() → Moment rows
  src/server/videos.ts   getVideo(), translations.json per video
  src/server/paths.ts    DATA_DIR (wasp-app/data), demo-cache path
  src/server/deck.ts     getDeck query + submitShadow action      (Task 7)
  src/server/seed.ts     wasp db seed: demo-cache/ → data/ + Video rows (Task 8)
  scripts/export-demo-cache.mjs   npm run cache:export -- <ids>   (Task 8)
  src/server/explain.ts  /ext/explain                           (Task 4)
  src/server/shadow.ts   /ext/shadow                            (Task 6)
  src/server/setup.ts    /media static route
  src/shared/score.ts    normalize(), score() + score.test.ts   (Task 6a)
  src/client/DeckPage.tsx, PracticePage.tsx                     (Task 7)
demo-cache/              pre-processed data for the 2 demo videos (Task 8)
```

---

## Tasks

### Task 0: Skeletons (A + B, 11:00–11:25) ✅ done

- **A:** `wasp new wasp-app` (minimal template), push to GitHub, and gitignore `.env.server`, `data/` and `node_modules`. Add usernameAndPassword auth and the `/deck` and `/practice` pages. Add `api extPing { httpRoute: (POST, "/ext/ping"), auth: false }`, which checks `x-demo-key` and returns `{ ok: true }`. Run `npm i @elevenlabs/elevenlabs-js @anthropic-ai/sdk && npm i -D vitest`.
- **B:** create `extension/` with `manifest.json`, `background.ts` and `content.ts`. On the `<video>` pause event, the content script asks the background worker to call `/ext/ping`, then draws a bubble saying "ping ok" over `#movie_player`.
- **Verify:** load the unpacked extension, open any YouTube video and pause it, and "ping ok" appears over the video.

### Task 1: Ingest and session (A)

Produces `/ext/session`, `transcribe(path, lang): Promise<Segment[]>` and `isolate(path): Promise<string | null>`.

- `/ext/session`: if the Video row exists, return it. Otherwise create it with `status: "processing"`, start ingest **without awaiting it**, and return immediately.
- Ingest: run yt-dlp via `execFile` with `--download-sections "*0:00-3:00" -f "mp4[height<=360]"`, then run `transcribe` and `isolate` in parallel with `Promise.all`, then set `status: "ready"`.
- `transcribe`: Scribe with word timestamps. Group the words into segments, splitting at `.?!` or any gap over 0.8 s, with ids from 0. `isolate` writes `dialogue.mp3` and returns null on error.
- Extension side: on page load and on YouTube's `yt-navigate-finish` event, call `/ext/session` and poll every 5 s until it's ready. Keep the segments in memory.
- **Verify:** open the music-heavy demo video. Within ~60 s the background console logs ready with more than 5 segments whose times match the video. Reload the page and it's ready at once with no new ElevenLabs calls. With captions off, pausing still shows lines once it's ready (Review Focus 2).

### Task 2: Struggle detection: REMOVED

Dropped by team decision: pause is the only signal. See "Scope decision" at the top.

### Task 3: Overlay and pause flow (B)

Consumes `window(segments, t, span = 15): Segment[]` from `src/shared/window.ts`, plus the caption buffer.

`window.test.ts` with `[{id:0,start:2,end:4},{id:1,start:6,end:9},{id:2,start:18,end:23}]`:
- `window(segs, 20)` → ids `[1, 2]`
- `window(segs, 7)` → `[0, 1]`
- `window(segs, 1)` → `[]`

Watch it fail, implement, watch it pass. Commit.

- `captions.ts`: when a new caption line appears, record `{ text, start: currentTime }` and close the previous line's end. Keep the last 3 minutes.
- `overlay.ts`: on pause, draw the bubble over the bottom-right of the player in a shadow root (so YouTube's CSS can't break it), showing "thinking…". Call `/ext/explain` with the current caption lines. Render the lines with their translations, notes on hover, and the "Hear it clearly" and "Shadow this line" buttons. Remove the bubble on play.
- **Verify:** pause at 3 spots on the demo video and the bubble shows the right lines each time, then disappears on play.

### Task 4: Explanation and voice (C)

Produces `/ext/explain`.

- Lines come from `window()` over the Scribe segments, or from `captionLines` while the video is still processing. With no lines, return `{ summary: "Nothing's been said yet. Play a bit more!", audioUrl: null, lines: [] }` (Review Focus 1). Record a pause Moment.
- Call Claude (language-neutral now; see "Any language") with a system prompt like: *"You are a friendly language tutor watching a video with a learner. For each line, give a natural English translation and 1–2 short notes on idioms, slang, grammar or what is happening in the scene. Then write a spoken summary of at most 2 sentences. Reply only with JSON matching the Explanation type."* Retry once on invalid JSON, then fall back to the lines with no notes.
- `speak(summary)` → `explain-{Math.round(t)}.mp3`. The overlay plays it through a blob URL and the mascot bounces while it plays.
- **Verify:** pause, and the voice starts within 5 s on venue Wi-Fi.

### Task 5: "Hear it clearly" (C)

The button fetches `dialogue.mp3` through the background worker and plays it from `line.start` to `line.end` at `playbackRate = 0.75`, with the YouTube video muted. It's hidden when `hasDialogue` is false.
**Verify:** on the music-heavy video, you hear just the voice.

### Task 6: Shadowing (D)

Produces `normalize(s): string[]` and `score(expected, heard, heardDur, origDur): ShadowResult` in `src/shared/score.ts`, plus `/ext/shadow`.

**6a.** `score.test.ts`:
- `score("¿Qué haces aquí?", "que haces aqui", 1, 1).accuracy === 1`, all ok
- `score("vamos a la playa", "vamos la playa", 1, 1)` → "a" is missed, accuracy 0.75
- `score("vamos a la playa", "", 1, 1)` → accuracy 0, all four missed
- `score("hola", "hola", 1.5, 1).paceRatio === 1.5`

Watch it fail, then implement: `normalize` lowercases, applies NFD and strips the combining marks, strips punctuation, and splits on whitespace. `score` is a word-level LCS where a match is ok and a substitution is wrong. Watch it pass. Commit.

**6b.** "Shadow this line": hold to record with MediaRecorder (webm) in the content script. On release, send the base64 audio and duration to `/ext/shadow`. The server transcribes it with Scribe, scores it and saves a ShadowAttempt. The bubble shows coloured words (green ok, red missed, amber wrong) and the pace.
**Verify:** say the line well, then badly, and the scores go the right way.

### Task 7: Study program pages (D, with A)

- `getDeck` (Wasp query): group the demo user's Moments by `(videoId, segmentId)` and sum the weights. Join the segment text, the video title and the best ShadowAttempt accuracy. Sort by total weight, highest first.
- `/deck`: one card per line, showing the line, the video title, chips for why it was flagged ("rewound 2×, paused"), and the best score or "not practised". Clicking a card opens `youtube.com/watch?v={id}&t={start-1}`.
- `/practice`: steps through the top 5 cards. For each, play the dialogue clip, show the translation, record a shadowing attempt in the page (same score logic through a Wasp action) and move to the next card.
- **Verify:** after the demo flow, `/deck` lists the lines you paused on, most-paused first, and practising one updates its score.

### Task 8: Make the demo unbreakable (A + C, 1:50–2:10)

- At 11:45, process both demo videos and copy their `data/` folders and Video rows into `demo-cache/`, with a `wasp db seed` script to reload them.
- The background worker gives every call an 8 s timeout. On a timeout or error it returns the cached explanation for the nearest cached t, and the overlay shows an "offline mode" chip (Review Focus 5).
- **Verify:** with Wi-Fi off, the whole demo script runs on a cached video.

### Stretch (only if Tasks 0–8 are done by 1:30)

- **S1, role-play:** an ElevenLabs Agent on `/practice` that plays the other character in a flagged scene.

### Task 9: Submission (D leads, 2:10–2:45)

- A 2-minute recording of the demo script, uploaded unlisted to YouTube.
- README / submission: the 5-step pipeline; an architecture diagram (YouTube tab → content script (captions, signals, overlay) → background worker → Wasp `/ext/*` → yt-dlp, Scribe, Isolator, Claude, TTS → Prisma → `/deck`, `/practice`); 6 screenshots, including the overlay over a paused video and the deck page.
- Partner sections:
  - **ElevenLabs:** Scribe (transcript + shadow scoring), Voice Isolator, text-to-speech (+ Agents if S1 was built).
  - **Wasp:** the API endpoints the extension talks to, auth, Prisma, and the study program pages.
  - **Codevisor:** only if it was used.
- Submit by 2:55 and list every partner tool.

---

## 3-minute demo script

See [DEMO.md](DEMO.md) for the pause-only script, per-step checks, offline rehearsal and troubleshooting.

## Likely Q&A

- **"Isn't this just GPT?"** The model writes one explanation. The product is watching your behaviour, the audio pipeline, the pronunciation scoring and the deck.
- **"Why not Language Reactor?"** It shows you two sets of subtitles. We notice what you didn't get and turn it into practice without you doing anything.
- **"Privacy?"** It only sends the video ID and your player events from YouTube tabs, never your browsing history.

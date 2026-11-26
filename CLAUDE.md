# Scriba (formerly Pause & Effect) — CLAUDE.md

**Renamed 2026-11-22:** the extension is now **Scriba**, and its mascot is **Scriba Inu** (`scriba inu.PNG`, a shiba with a scroll in its mouth; cropped to `extension/assets/scriba-inu.png` plus 16/32/48/128 icons). Internal ids (`DEMO_KEY`, `dataset.pauseEffect`, the Wasp app name) are unchanged.

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

## Ingest speed (measured 2026-11-22)

Opening a new video to "Ready" went from ~60–70 s to **~14 s on the server, ~16 s in the browser**. Despacito as a sample: download 10.9 s, audio 0.1 s, Scribe 2.7 s; the dialogue track arrives ~3 s later.
- **Download:** yt-dlp zipapp instead of the one-file build (saves ~17 s).
- **Audio:** the AAC track is copied out of the mp4 into `audio.m4a` (0.1 s, instead of 3.8 s re-encoding to mp3). Scribe and Voice Isolator both accept m4a. Older videos still have `audio.mp3`; `DeckCard.audioFile` picks the right one.
- **Ready after the transcript:** the video is marked ready as soon as Scribe finishes. Voice Isolator runs in parallel and flips `hasDialogue` when done. The extension polls every 2 s while processing, then every 3 s until `hasDialogue`.
- Measured: Scribe takes 1.8 s for 3 min of audio, and Voice Isolator 1.5 s for 45 s. The remaining time is mostly YouTube download and extraction.
- **Not done (alternatives):**
  - Use YouTube's own captions for an instant transcript of the whole video (4.4 s). This weakens the ElevenLabs story.
  - Process longer than 3 minutes. Voice isolation costs ~1k ElevenLabs characters per minute.

## Explain latency (measured 2026-11-22)

The measurements below are from before voice-first (see the next section).

| Step | Time | Share |
|---|---|---|
| Claude (Sonnet 5.5, structured JSON) | 3.6–5.8 s | ~87% |
| ElevenLabs TTS (flash v2.5) | 0.55–0.65 s | ~12% |
| Extension (250 ms pause debounce + messaging) | ~0.5 s | rest |

Benchmark, median of 3: Sonnet 5.5 takes 4.3 s in total, but the `summary` (written first) is complete after 1.6 s when streamed. Haiku 5.5 takes 2.9 s in total, with the summary ready at 1.3 s.

Speed-up options 1 and 2 are now built (next section). Still open:
3. Use Haiku 5.5, saving ~1.4 s at some cost in quality.
4. Pre-generate explanations for every line right after ingest. Pauses then feel instant, at the cost of Claude + TTS credits for every line.

## Voice first (built 2026-11-23, branch `feat/faster-pauses`)

A pause now speaks once the summary is done, without waiting for the translations. Expected ~2.5 s from pause to voice (summary ~1.6 s + TTS ~0.6 s), down from ~5.5–7 s. **Not measured live yet:** it was built on a machine without API keys.
- **Server (`explain.ts`):** Claude is streamed (`beta.messages.stream`). `completedStrings()` (`src/shared/partialJson.ts`, unit-tested) reads the top-level string fields that have finished streaming; when `summary` is complete, TTS starts while Claude keeps writing the lines. `/ext/explain` answers as soon as the voice is ready, with `partial: true`: the summary and audio are final, and the lines carry only translations an earlier pause saved. The full explanation stays in memory for 2 minutes and is saved to `explain-cache.json` / `translations.json` as before.
- **`/ext/explain-rest` `{ videoId, t }`** returns the full explanation: it waits for the in-flight one, or reads the cache. 404 if neither exists.
- **Extension:** on a `partial` answer it starts the voice and calls `/ext/explain-rest` at the same time. The overlay shows a sketch placeholder where the translation goes and fills in the translation, notes and previous line in place (`overlay.details()`), without re-rendering the buttons, so a shadowing take in progress isn't interrupted. If the rest fails, the placeholder is removed. Only full explanations go into the extension's offline cache.
- **Failures:** if Claude fails before the summary, the answer is the offline one, as before (not partial). If it fails after the voice, the rest returns the voice's summary with any known translations.
- **Log:** `[explain] <id>@<t>s voice ready at …ms (summary …ms), details to follow`, then `[explain] <id>@<t>s summary=…ms voice=…ms claude=…ms total=…ms`.

## Study tools in the scroll + on/off switch (built 2026-11-24, branch `feat/faster-pauses`)

- **On/off switch:** the toolbar icon opens a popup (`popup.html` + `src/popup.ts`) with a sketched switch and Deck / Practice links (it used to open the deck directly). Saved as `enabled` in `chrome.storage.local` (`src/enabled.ts`); every tab follows it. Off: no session call (so no download or transcription), pauses ignored, overlay and chips cleared; the icon shows an "off" badge. Turning it on mid-pause explains right away.
- **Tap a word:** every word of the "Just said" line is tappable (`splitWords()` in `src/words.ts`, `Intl.Segmenter`, so Chinese/Japanese split into words). A word card under the translation shows the meaning in this line, dictionary form, romanization and a note, from **`/ext/word`** (`src/server/word.ts`, same Claude settings as explain, cached in `data/{id}/words.json`). Its speaker button plays the word cut from the voice-only dialogue track; when the video has no dialogue track or no word timings, the server also TTSes the word in the video's language.
- **Words light up as they're heard:** during Hear it clearly (and the compare buttons), each word of the line is highlighted. Ingest now keeps Scribe's word timings (`Segment.words`, optional); older transcripts (including the demo-cache video) spread the line's time by length instead (`charTimes()`). Scriba's spoken note is also highlighted word by word, paced by length over the clip (TTS gives no timings).
- **Compare your take:** after "Hold to shadow", Original / You / Back to back buttons play the line and your recording (kept as a blob in the content script) even if scoring fails.
- **Not verified live:** `/ext/word` and the highlight timing against real Scribe word timings need API keys. Verified: unit tests (`words.test.ts`, segments), type checks, and the overlay drawn on a test page (word card, compare row, highlights, real clicks on words).

## Intonation (built 2026-11-24, branch `feat/pronunciation`)

Shadowing used to check only *which words* you said (Scribe + word LCS). Now, after a take, the scroll also compares your **pitch curve** with the actor's, which is what carries intonation (and Mandarin tones).
- **Pipeline (`extension/src/pitch.ts`, pure, unit-tested):** YIN pitch per 10 ms (60–500 Hz) → `cleanContour()` (octave-jump fix, 5-frame median, bridges gaps ≤ 5 frames) → semitones relative to each speaker's own median (a deep and a high voice give the same curve) → DTW on voiced frames (Sakoe–Chiba band 20 %), so speed isn't an error (pace stays in `paceRatio`) → `intonationScore()` 0–100 + `intonationHint()`.
- **Score:** mean error per actor frame, against how much the actor's own melody moves (`SCORE` in `pitch.ts`): a flat reading ≈ 0, a match 100, 0.25 st allowed for noise. Null (no chart) when either side has < 15 voiced frames.
- **Browser side (`extension/src/intonation.ts`):** the take (webm blob) and the actor's line (`dialogue.mp3` via `mediaUrl()`, decoded once per video and kept as 16 kHz mono, line ± 0.15 s) are decoded with one `AudioContext` made on the "Hold to shadow" press. Runs in parallel with `/ext/shadow`; the word diff never waits for it.
- **UI:** under the Compare row, an inline-SVG chart (theirs solid, yours dashed and mapped onto their timeline through the DTW path, gaps where unvoiced), "Intonation N" and one hint ("Your pitch stays flat where theirs rises (at the end)"). A playhead follows Original / Back to back. Skipped silently without a dialogue track, for captions-only lines (`segmentId -1`), or on too little voiced audio.
- **Tuned on real audio (differs from the handoff's starting values):** YIN threshold 0.35 (0.15 found pitch in only ~30–40 % of a normal line's frames on the isolated, mp3-compressed track), pitch floor 60 Hz (deep voices dip under 70), and the relative score above (a fixed "6 semitones = 0" let a flat reading of a calm line score 85).
- **Verified on real audio** (the dialogue track of `iDulhoQ2pro`, English, with synthetic takes made from the actor's own line): same melody faster/higher or slower/lower 77–100, a flat reading 12–18, played backwards 10–40, a different line 22–43. ~60–250 ms per take once the track is decoded (decode ~1–2.5 s, once per video). The demo-cache Spanish clip is mostly whispered, so few frames are voiced there.
- **Not verified:** a real microphone take (needs a human), and Mandarin tones.

## Clarity + coaching tip, no Azure needed (built 2026-11-24, branch `feat/pronunciation`)

The default pronunciation feedback, from the keys we already have (ElevenLabs + Anthropic). Azure (next section) replaces the clarity scores when it's configured; the tip works with both.
- **Clarity (Scribe):** Scribe returns a `logprob` per word; `transcribeWords()` now keeps it, and `clarityFromScribe()` (`src/shared/clarity.ts`, unit-tested) turns it into 0–100 per word of the line (`exp(logprob)`), lined up with the word diff, with missed/wrong words counting 0 in the overall. It measures whether a listener would catch the word, not per-sound accuracy. Below 70 counts as unclear.
- **Tip (Claude, `src/server/coach.ts`):** when something was missed, wrong, added or unclear (`needsTip()`; never for silence), Claude gets the line, what was heard and each word's status/clarity (`tipInput()`) and writes one or two sentences on the most likely sound to fix. Claude can't hear audio: it reasons from how the words came out ("«perro» came out as «pero» … the rolled rr"). Same model/settings as explain, 6 s timeout; no tip on timeout or error. The ShadowAttempt is saved before the tip is requested.
- **UI:** each word's score as a coloured underline, "Clarity N" (or "Pronunciation N · fluency · complete" with Azure), and the tip in a "Tip" box.
- **Verified live** (learner-like takes made with ElevenLabs TTS, converted to webm/opus, through the real `/ext/shadow`): clean takes → clarity 100, no tip, ~0.3 s; "perro" said as "pero" → accuracy 83 and the rolled-rr tip; wrong words → a tip naming them; with a tip, ~2.7–3.7 s per take. Clarity stays ~100 for anything intelligible (a TTS "Spanish accent", a mild lowpass) and drops only when a word really blurs (heavy noise: "they" 62; rushed + muffled: "been" 56), and the tip then targets that word.
- **Not verified:** a real microphone take (needs a human).

## Pronunciation scores with Azure (built 2026-11-24, branch `feat/pronunciation`, optional)

Phase 2 of the pronunciation handoff: per-word and per-sound scores from **Azure Speech Pronunciation Assessment**, used only when `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` (or `AZURE_SPEECH_ENDPOINT`) are set in `.env.server`. Without them, shadowing behaves exactly as before.
- **Server (`src/server/azure.ts`):** the take is converted to 16 kHz mono WAV with ffmpeg and sent to the REST short-audio endpoint (`…/speech/recognition/conversation/cognitiveservices/v1?language=…&format=detailed`) with a base64 `Pronunciation-Assessment` header: HundredMark, Phoneme granularity, Comprehensive, miscue on. No SDK dependency.
- **`shadow.ts`:** if Azure is configured and the video's language maps to a supported locale (`azureLocale()`; `AZURE_SPEECH_LOCALE` covers videos with no detected language, or picks a variant like es-MX), Azure replaces Scribe for the take. Its recognised text goes through the same `score()`, so `accuracy`, `diff` and `paceRatio` keep their meaning; the scores are added as `pronunciation`. Any Azure failure logs and falls back to Scribe. Log: `[shadow] azure <locale> pron=… in …ms`.
- **Pure parts (`src/shared/pronunciation.ts`, unit-tested):** locale mapping, reading Azure's JSON (the docs show the scores both flat on `NBest[0]` and nested under `PronunciationAssessment`; both are read), and `attachToDiff()`, which lines Azure's words up with our diff using the same normalisation (a Chinese word covers each of its characters; inserted words are skipped; left-out words score 0).
- **UI:** each word in the shadowing result gets a coloured underline and its score (green ≥ 80, amber ≥ 60, red below, Azure's "mispronounced" line), plus "Pronunciation N · fluency N · complete N". Tapping a word opens its sounds on the tap-a-word card. Azure names sounds only for English (US) and Mandarin; elsewhere they're numbered ("sound 2 · 41").
- **Not verified live:** no Azure key was available. Verified: unit tests with fixture JSON in both layouts, type checks, the no-key fallback (`/ext/shadow` answers exactly as before), and the UI drawn on a test page with sample scores. The REST layout (flat vs nested) should be checked on the first real response.
- **Cost:** billed as speech-to-text; Azure's free F0 tier has 5 audio hours a month (≈ 6,000 three-second takes). Create the resource on F0 explicitly.

## Any language (decided 2026-11-22)

The user demos Mandarin as well as Spanish, so there is **no fixed `LANGUAGE`** any more.
- **Detection:** Scribe auto-detects the language per video. It is saved as `language` in `data/{id}/video.json` and reused when transcribing shadowing attempts.
- **Chinese and Japanese text:** `src/shared/text.ts` joins words without spaces between Han/Kana characters. `src/shared/segments.ts` splits lines at 。！？ as well as .?!, at pauses over 0.8 s, and at a comma once a line is already 6 s long (lyrics).
- **Scoring:** `normalize()` tokenizes Han/Kana per character, so Chinese and Japanese are scored per character.
- **Tutor prompt:** language-neutral. It writes English translations and gives the spoken summary in English.
- **Romanization (added 2026-11-22):** for any line with non-Latin letters (`hasNonLatin()` in `src/shared/text.ts`), Claude returns the whole line in Latin letters (Hanyu Pinyin with tone marks, Hepburn romaji, Revised Romanization, else a standard transliteration) in the same explain call. It's saved in `translations.json` next to the translation, and shown under the line in the overlay, `/deck` and `/practice`. Lines explained before this were backfilled once. Claude writes it, so the occasional word is off (one Korean slip in testing).
- **Verified end to end:** Spanish (`aUGOFL0Ygsw`) and Mandarin (`YCIFNPMu0hs`; the explanation came back in 7 s with pinyin notes).
- **One script per transcript (added 2026-11-24):** auto-detect can still write a word in a neighbouring language's script: a Korean video got 国外 (Chinese) for 국외 "abroad", and Claude then romanized it wrong ("gukwae"). Ingest now checks the first transcript with `offScript()` (`src/shared/script.ts`, unit-tested): Han or kana in Korean, Hangul in Japanese, Hangul or kana in Chinese. If found, it transcribes again with the detected language set (the same code shadowing already passes back to Scribe), ~2 s more, only for those videos; on failure it keeps the first transcript. Other languages are never re-run, since they can quote Korean or Chinese on purpose. Videos processed before this keep their old transcript. **Not verified live:** that Scribe with `languageCode: "kor"` writes 국외 in Hangul (needs API keys); verified with the real `ingest()` against stubbed Scribe/yt-dlp/database.

## Explanations in context (decided 2026-11-22)

The voice explains **the line just said, at that moment in the video**: what it means there (who it's aimed at, what it refers to, the joke, feeling or subtext), plus the one thing worth learning. A quick bit of plot recap to set it up is fine (user's call), but no overview of the whole video or song. Claude also gets `background`: up to 20 earlier lines (never later ones) plus the title, which it reads but doesn't translate. The summary limit is 45 words.

**Cost:** romanization and context made Claude ~1.5 s slower (4.9–5.8 s), so a pause took ~5.5–7 s in total. "Voice first" now speaks before the translations are written, which should win that back.

**Voice speed:** the pill next to the × in the panel header cycles 0.75× → 1× → 1.25× → 1.5× → 2× (`extension/src/voiceRate.ts`). It applies at once, even mid-sentence, with pitch preserved, and is saved in `chrome.storage.local`, so it carries over to every video and tab. Each tab tags its own writes so a late storage echo can't undo a newer click.

**Foreign words in their own accent (added 2026-11-22):** read in one English TTS call, quotes from the video were anglicized (Scribe heard 难追 as "nonjui", ¿qué onda, güey? as "Kyon dagwe"). Now Claude wraps every quote in the video's language in «guillemets» and returns `language` (ISO 639-1). `speechParts()` (`src/shared/text.ts`) splits the summary into English and foreign parts (non-Latin script is caught even without the marks; romanization in parentheses is dropped). `speakMixed()` (`eleven.ts`) speaks each part with its own `language_code` (`en` or the video's; Scribe's ISO 639-3 code is the fallback) in parallel, with the neighbouring text as `previous_text`/`next_text`, and `joinMp3()` (`mp3.ts`) joins them after stripping each clip's ID3 tag and Xing/Info frame. On screen, «x» is shown as “x” (`displaySummary()`). Verified with Scribe: 告白气球 now transcribes as Chinese characters and "Estoy bien" as Spanish, and a pause still takes ~3.5 s.

**Hear it clearly speed (added 2026-11-22):** a slider pill right of the button (1× · .75× · .5×, default .75× = `HEAR_IT_RATE`) whose hatched thumb slides to the pick. Clicks or ←/→ change it; it applies to a playing clip at once and is saved as `clipRate` in `chrome.storage.local`, with the same per-tab tagging (both settings use `rateSetting()` in `voiceRate.ts`). The /practice page still plays at a fixed 0.75×.

## Scriba UI (decided 2026-11-22)

On pause, a **right-hand sidebar drawn as an unrolled paper scroll** slides in over the video (`extension/src/overlay.ts`). The user asked for: right sidebar, translucent, minimal, sketched rather than solid, and the text box like a scroll.
- **The scroll:** rolled ends top and bottom with spiral tips, a red ribbon bookmark (the ribbon on Scriba's scroll), a translucent frosted sheet with pencil-sketch edges (uneven border radii plus a faint second stroke), handwritten labels (Chalkboard SE), and a wavy hand-drawn divider.
- **Contents, top to bottom:** Scriba + "paused at m:ss" + the voice-speed pill + ×; Scriba (animated: bobs, tilts while thinking, bounces while talking) with the spoken note, clamped to 5 lines (3 on small players; click to expand); "Just said": the line, romanization, translation, **Hear it clearly** and **Hold to shadow**, notes; the line before it (hidden on short players); **Deck** and **Practice** links to the web app, and **Keep watching**.
- **Unrolls on pause (added 2026-11-26):** the scroll arrives rolled up (the usual slide-in) and unrolls downward: the bottom roll drops to its place while the paper, and everything on it, is revealed behind it. `unroll()` in `overlay.ts` measures the distance between the rolls in the finished layout and runs two Web Animations by that distance on the same curve (the paper's `clip-path` and the bottom roll's `translate`, which adds to its tilt), so the paper's edge stays tucked 4 px under the roll and the scroll ends exactly where the CSS puts it. 650 ms after a 120 ms delay (`UNROLL_*`). The shade over the video comes down with the roll too (a third animation, on its `mask-size`, with a 48 px soft edge ending at the roll's bottom edge), so nothing darkens below the roll before it gets there; once the roll lands it settles to the bottom of the video in 200 ms (`SHADE_*`) and the mask goes away. Only a new pause unrolls; redrawing an open scroll (the explanation arriving) doesn't. Skipped with `prefers-reduced-motion` and while hidden during an ad. Closing is unchanged (slide + fade).
- **Behaviour:** it sits inside `#movie_player` under YouTube's control bar, so the controls and fullscreen still work. Clicking the video outside the scroll resumes playback; Space/K on the scroll resumes; Esc closes without resuming. The status chips use the same sketched style.
- **Footer fit (fixed 2026-11-24):** Deck, Practice and Keep watching sit left-aligned with the same gap between each (the old spacer before Keep watching doubled that gap). The text is sized by the *window* (`1.3cqw` on `.wrap` resolves against the viewport, since `.wrap` is itself the container), but the scroll by the *player*, so outside full screen the scroll is narrow for its text and Keep watching stuck out past the border (reproduced: 1280–1366 px window, ~850–870 px player, 24 px past). The containers are now named (`player` on `.wrap`, `paper` on `.paper`; queries must name `player`, or a width query inside the scroll would hit `.paper`). `@container paper (max-width: 24em)` tightens the footer, `(max-width: 19em)` drops its icons. Checked at 13 window/player sizes in Inter and an Arial-metric font: equal gaps, nothing past the border, no clipped labels.
- **three.js paper field** (`extension/src/fx.ts`, built separately as `dist/fx.js` and `import()`ed on first open, so YouTube browsing never loads three.js): 16 hand-cut paper scraps carrying the paused line's characters (CJK) or words (Latin) drift up behind the scroll text at 50% opacity, plus faint dust. It follows the installed three.js skills: `setAnimationLoop` + `Timer`, sRGB `CanvasTexture`s without mipmaps, pixel ratio capped at 1.5, no allocations per frame, edge fade, stopped while hidden and disposed with its canvas.
- **Poses (added 2026-11-22):** when an explanation has no lines (and it isn't "Still listening…"), Scriba **sleeps**: centred, ~10em wide, the message under it, no divider or line area (`.body.asleep`). While you hold to shadow, the head next to the note becomes **listening** (same size). Placeholders are SVGs in `extension/assets/` (`scriba-sleeping.svg`, `scriba-listening.svg`); `setPose()` tries `scriba-<pose>.png` first, so the artist's PNGs replace them with no code change. Brief for the artist: [docs/mascot/README.md](docs/mascot/README.md).
- **Toolbar button** opens the deck (`chrome.action.onClicked` in `background.ts`).
- **Pencil look:** outlines are drawn on pseudo-elements through two SVG noise-displacement filters (`#sk1`, `#sk2`, defined inside the shadow root in the extension and by `SketchDefs.tsx` on the web pages), so lines wobble like pencil with a faint second stroke; text is never filtered. Orange buttons use a hatched marker fill.
- **Web pages match:** `/`, `/deck` and `/practice` (`study.css`) use the same paper desk, Scriba header, sketched slips and hatched buttons; `/practice` puts the card on the same scroll (rolls, ribbon) with a score ring and progress dots. The tab title and favicon are Scriba (`main.wasp`).
- **Delete a card (added 2026-11-23):** each deck card has a sketched × in its top-right corner; on hover or keyboard focus, "Delete" unrolls to its left. Clicking it hides the card at once and calls the `deleteCard` action, which deletes that line's Moments and ShadowAttempts for the demo user (a later pause on the line starts a fresh card). No confirm step. If the call fails, the card comes back with an error line.
- **Deck cards open practice (added 2026-11-24):** clicking a deck card opens that card first in `/practice` (`/practice?card=<videoId>:<segmentId>`; the rest of the top 5 follow). The only link to YouTube is the video name at the bottom of the card ("<title> at m:ss ↗", new tab, at the line's moment). The card is a `div.card` with an empty `a.card-open` stretched over it; the words, the word card, the video name and the × sit above that link (`z-index: 1`), so clicking them never opens practice.
- **Tap a word on /deck and /practice (added 2026-11-24):** the line's words are tappable there too, with the same word card as the scroll (meaning, dictionary form, romanization, note, speaker; tap the word again or × to close). `TappableLine` in `src/client/WordTaps.tsx` splits the line with `src/shared/words.ts` (a copy of the extension's `words.ts`; keep them the same) and asks the **`getWordGloss`** query, which shares `/ext/word`'s lookup and `words.json` cache (`glossWord()` in `src/server/word.ts`). The speaker plays the server's TTS of the word, else cuts the word out of the dialogue track at .75× (`DeckCard.words` carries Scribe's word timings). One sound plays at a time on these pages (`src/client/sound.ts`), and holding to shadow stops it.
- Superseded on the way: a full-window page, then a full-video frosted overlay. Screens of each are in git history (`a57ce75`).

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
  - yt-dlp 2026.10.26. `~/.local/bin/yt-dlp` is a wrapper that runs the **Python zipapp** (`~/.local/share/yt-dlp/yt-dlp.zipapp`), which starts in ~1 s. The macOS one-file build (kept as `yt-dlp-onefile`) spends ~17 s unpacking itself on every run. The old `/usr/local/bin/yt-dlp` (2025.06) fails on YouTube with "The page needs to be reloaded". YouTube now needs a JS runtime, so ingest passes `--js-runtimes node:<server's node>`.
  - The server auto-detects both binaries (`~/.local/bin` first, else on PATH, e.g. `sudo apt install ffmpeg` on Linux/WSL); override with `FFMPEG_PATH` / `YTDLP_PATH`. A bare `ffmpeg` on PATH is not passed to yt-dlp's `--ffmpeg-location` (it takes a path, and a bare name makes yt-dlp report "ffmpeg is not installed"), so yt-dlp searches PATH itself.
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
  - Claude call: `claude-sonnet-5-5` on the beta endpoint, with structured JSON output, `thinking: between_tools` (off, for latency), `effort: low`, server-side refusal `fallbacks: "default"`, and a 10 s timeout. It's streamed (see "Voice first"). TTS uses **Hope** ("Hope - upbeat and clear", library voice `tnSpp4vdxKPjI9w0GnoV`; switched from the stock voice George `JBFqnCBsd6RMkjVDRZzb` on 2026-11-22, same ~0.35 s latency) with `eleven_flash_v2_5`. Scribe uses `scribe_v2`. All can be overridden with env vars (`CLAUDE_MODEL`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_SCRIBE_MODEL`).
  - **Titles come from yt-dlp** (`--print after_move:title`), because the YouTube page title is stale right after in-app navigation. Before this fix, titles were off by one video.
  - **Re-ingest:** clears the old line data (`segments` set to null, `explain-*`, `translations.json`), because line ids change.
  - **Status chip:** the extension shows "Listening to the first 3 minutes…", then "Ready · pause anytime", then "Couldn't process…" or "Can't reach the server". Past 3:00, explain falls back to captions and says so if CC is off.
  - **Ads:** `isAdShowing()` checks the `ad-showing` / `ad-interrupting` classes and the ad overlay. During an ad, the overlay is hidden (`setHidden`), pauses are ignored, the voice and clips are stopped, captions aren't recorded, and late explanations aren't drawn. Play is always handled, because pressing play is also how a mid-roll starts. `watchAds` starts from "no ad", so a pre-roll that is already playing at page load is caught. Tested with a real pre-roll (Despacito) and with simulated pre- and mid-rolls; 9/9 checks pass.
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
- Keys live **only** in the Wasp server's `.env.server`: `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY` and `DEMO_KEY` (plus the optional `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` for pronunciation scores). The extension holds only `DEMO_KEY`, which maps every request to the demo user.
- Never a blank overlay: it shows "thinking…" immediately, and every call has an 8 s timeout with a cached fallback.
- Mascot voice: Hope from the ElevenLabs voice library (published by its voice actor), never a clone of an actor from the video.

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
export type Segment = { id: number; start: number; end: number; text: string;
  words?: { text: string; start: number; end: number }[] }  // Scribe word timings (newer ingests)
export type WordGloss = { word: string; lemma?: string; romanization?: string; meaning: string; note?: string; audioUrl: string | null }
export type Explanation = { summary: string; audioUrl: string | null;
  lines: { segmentId: number; original: string; romanization?: string; translation: string; notes: string[] }[];
  offline?: boolean; partial?: boolean }
export type ShadowResult = { diff: { word: string; status: "ok" | "missed" | "wrong" | "extra" }[]; accuracy: number; paceRatio: number;
  pronunciation?: { overall: number; source?: "azure" | "scribe"; tip?: string;   // scribe = clarity; tip from Claude
    fluency?: number; completeness?: number;   // Azure only
    words: { word: string; score: number; i: number; phonemes?: { p: string; score: number }[] }[] } }  // i = index into diff
```

**Extension → Wasp endpoints.** All are POST with JSON, carry the header `x-demo-key`, and are called only from the background worker:

| Route | Request | Response |
|---|---|---|
| `/ext/ping` | `{}` | `{ ok: true }` (Task 0 smoke test) |
| `/ext/session` | `{ videoId, title }` | `{ status: "processing" \| "ready" \| "failed", segments: Segment[] \| null, hasDialogue: boolean }`. Starts ingest on the first call; the extension polls every 5 s. |
| `/ext/explain` | `{ videoId, t, captionLines: { text, start, end }[] }` | `Explanation`. Also records a pause Moment. May be `partial: true` (voice first, translations still coming). |
| `/ext/explain-rest` | `{ videoId, t }` | The full `Explanation` for a pause that came back `partial`; 404 if there's none. |
| `/ext/word` | `{ videoId, segmentId, line, word, index }` | `WordGloss` for a tapped word (cached per video). 502 if Claude is unavailable. |
| `/ext/shadow` | `{ videoId, segmentId, audioBase64, durationSec, text?, origDur? }` | `ShadowResult & { heard }` |

Wasp operations for the pages: `getDeck` (query) → `DeckCard[]`, `submitShadow` (action), which uses the same scoring as `/ext/shadow`, `deleteCard` (action) `{ videoId, segmentId }` → `{ deleted }`, and `getWordGloss` (query) `{ videoId, segmentId, line, word, index }` → `WordGloss` (tap a word; same lookup and cache as `/ext/word`).

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
- Ingest: run yt-dlp via `execFile` with `--download-sections "*0:00-3:00" -f "ba/best[height<=360]" -S "lang,+abr"` (audio only, original language, smallest stream: ~4 s; see the comment in `ingest.ts`), then run `transcribe` and `isolate` in parallel with `Promise.all`, then set `status: "ready"`.
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
- `/deck`: one card per line, showing the line, the video title, chips for why it was flagged ("rewound 2×, paused"), and the best score or "not practised". Clicking a card opens it in `/practice` (the video name links to `youtube.com/watch?v={id}&t={start-1}`; see "Deck cards open practice").
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

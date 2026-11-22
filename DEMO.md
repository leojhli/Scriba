# How to demo Pause & Effect

**The product in one line:** you watch a YouTube video in the language you're learning. When you pause, a mascot explains the last few lines out loud, and every line you paused on becomes a card you can practise. The language is auto-detected; Spanish and Mandarin are verified end to end.

## 0. One-time setup (≈5 min)

1. **API keys.** Open `wasp-app/.env.server` and fill in:
   ```
   ELEVENLABS_API_KEY=sk_...      # Scribe, Voice Isolator, text-to-speech
   ANTHROPIC_API_KEY=sk-ant-...   # explanations
   DEMO_KEY=pause-and-effect-demo # leave as is
   ```
   Without the keys everything still runs, but the overlay shows "offline mode" with untranslated lines.
2. **Start the backend** in a new terminal:
   ```bash
   cd ~/yc-elevenlabs/wasp-app
   wasp db migrate-dev     # first time only
   wasp start              # server :3001, web app :3000
   ```
   Restart `wasp start` after editing `.env.server`.
3. **Load the extension:**
   ```bash
   cd ~/yc-elevenlabs/extension && npm i && npm run build
   ```
   Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick the `extension/` folder. After any rebuild, click the reload icon on the card, then refresh the YouTube tab.
4. **Pick the demo video.** Any language works, ideally with music under the dialogue so "Hear it clearly" has something to remove. Open it once about 2 minutes before you demo so the first 3 minutes get processed. These are already processed and ready:
   - Spanish: Brad Pitt sled-dog clip, `aUGOFL0Ygsw` (pause at ~1:41)
   - Mandarin: Street Talk interview, `YCIFNPMu0hs` (pause at ~0:25, after "请问你今年芳龄？")
   - Mandarin songs, great for Hear it clearly: 周興哲 `wSBXfzgqHtE`, Jay Chou 告白氣球 `bu7nU9Mhpyo`

## 1. Demo each step

| # | What you do | What the audience sees | How to check it's working |
|---|---|---|---|
| **1. It watches alongside you** | Open the video. | Nothing visible yet: it's listening. | DevTools Console on the YouTube tab shows `[Pause&Effect] processing…`, then `ready: N segments, dialogue=true` within ~60 s. The server terminal logs `[ingest] <id> ready in …s`. |
| **2. Pause → explanation** | Play ~20 s and pause right after a fast line. | The video dims and a glass panel slides in from the right: mascot, "Paused at 1:41", a shimmering "thinking" state, then an English summary and the lines, newest first ("Just said"), with translations and grammar/slang note pills. Older lines fold their notes behind "Notes (2)". Press play or the × and it slides away. | Pausing before anyone has spoken shows "Nothing's been said yet." While the video is still processing with captions off, it shows "Still listening…". |
| **3. The mascot talks** | Pause again. | The mascot bobs and talks, with a sound-wave next to its name, while the voice explains **the line you just heard**: what it means and the one word or grammar point worth knowing. No scene or song recaps. | `wasp-app/data/<id>/explain-<t>.mp3` gets created. |
| **4. Hear it clearly** | Click **🔊 Hear it clearly** on a line. | The YouTube audio is muted. Only the voice plays, with the music removed, slowed to 0.75×. | The button is hidden if the Voice Isolator failed (`dialogue=false` in the console). |
| **5. Shadow it** | Hold **🎙 Hold to shadow**, say the line and release. Allow the mic the first time. | A score like "75%" with coloured words: green = correct, red struck-through = missed, amber = wrong. Also shows pace ("1.10× · good pace"). | Saying it badly gives a lower score. Saying nothing gives 0% with every word missed, not an error. |
| **6. Your deck** | Open <http://localhost:3000/deck>. | One card per line you paused on, most-paused first, with "paused 2×" and your best score or "not practised". Clicking a card jumps back to that moment on YouTube. | The page refreshes every 5 s, so you can keep it open in a second window. |
| **7. Practice** | Click **Practice top 5 →**. | Steps through your top 5 lines: hear the clean clip, read the translation, shadow it, then **Next →**. | Practising updates "best %" on the deck. |

## 1b. Demo with any video (or a judge's pick)

1. Paste the YouTube link into the demo Chrome window.
2. A chip in the top-left says **"Listening to the first 3 minutes…"** for about 60–70 s, then **"Ready · pause anytime"**.
3. Pause anywhere in the first 3 minutes for the full experience: voice, Hear it clearly, shadowing, and the line goes to your deck.
4. After 3:00, turn on **CC**: the panel explains from YouTube's own captions instead. You won't get "Hear it clearly" there, and those lines aren't added to the deck.
5. **Any language:** it's auto-detected per video. Translations and the spoken summary are in English. Chinese notes include pinyin and Japanese notes include romaji. Shadowing scores Chinese and Japanese per character.

## 2. The 3-minute script

- **0:00 Hook:** "Learners turn shows into study material by hand: pause, look it up, make flashcards. We built a coworker that does it while you watch." Open the Spanish video, which is already processed.
- **0:25** Let a fast line go by, then **pause**. "I didn't catch that." The bubble appears and the mascot explains the line out loud.
- **0:55** Hover a line for the slang note. "It knows what was just said: ElevenLabs Scribe transcribed it, and Claude explains it in context."
- **1:15** **Hear it clearly:** the music drops out and the line plays slowed down. "That's ElevenLabs Voice Isolator."
- **1:40** **Shadow it:** say the line and the coloured diff appears. "Scribe scores you word by word."
- **2:05** Pause on one or two more lines, then open **/deck**: every line you paused on, ranked. Click **Practice**.
- **2:40 Close:** "You just watch. It builds the program. Next: Netflix and role-play with the characters." Partner tools: **ElevenLabs** (Scribe, Voice Isolator, TTS) and **Wasp** (API, auth, Prisma, deck pages).

## 3. Make it unbreakable (venue Wi-Fi)

- **Rehearse once on each demo video.** Every explanation is cached twice: on the server (`data/<id>/explain-cache.json`) and in the extension. If Claude, ElevenLabs or the Wi-Fi fails mid-demo, the nearest cached explanation and voice come back within 8 s with an **"offline mode"** chip.
- **Freeze the demo videos into the repo:**
  ```bash
  cd wasp-app
  npm run cache:export -- <videoId1> <videoId2>   # copies data/<id> → demo-cache/<id>
  git add ../demo-cache && git commit -m "demo cache"
  ```
  On any machine, `wasp db seed` restores them as ready, with no ElevenLabs calls.
- **Offline test:** turn Wi-Fi off and run the script on a cached video. Everything except a brand-new video should still work.

## 4. If something goes wrong

| Symptom | Fix |
|---|---|
| No bubble on pause | Reload the extension at `chrome://extensions`, then refresh the YouTube tab. Check the console for `[Pause&Effect] listening`. |
| An ad is playing | That's expected: the overlay hides during ads (pre-rolls and mid-rolls), ignores pauses, and stops the voice. It comes back when the ad ends. |
| Credits | Every video opened in the demo window gets processed, which costs about 3k ElevenLabs characters for the voice isolation. Browse in your normal Chrome and open only demo videos in the demo window. |
| "Can't reach the server" chip | `wasp start` isn't running. Start it, and the chip clears on its own. |
| "offline mode" chip all the time | `wasp start` isn't running, or the keys are missing in `.env.server`. Check the server terminal. |
| Console says `ingest failed` | Usually a missing ElevenLabs key or an outdated yt-dlp. Fix it and refresh the tab: a reload retries the ingest. |
| No voice | Click anywhere on the page once (autoplay policy), then pause again. |
| Mic doesn't work | Allow the microphone for youtube.com (address bar → site settings). |

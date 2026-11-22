# Pause & Effect

**You just watch. It builds your study program.**

A Chrome extension that overlays YouTube, notices which lines you struggle with (pauses, rewinds, replays, captions, slowdowns), explains them out loud, and turns them into a ranked deck with "Hear it clearly" and shadowing practice. It's backed by a Wasp app and uses ElevenLabs Scribe, Voice Isolator and TTS.

## Run it

```bash
# Backend (localhost:3001, client on :3000)
cd wasp-app
cp .env.server.example .env.server   # fill in ELEVENLABS_API_KEY, ANTHROPIC_API_KEY
wasp db migrate-dev
wasp start

# Extension
cd extension
npm i && npm run build
# chrome://extensions → Developer mode → Load unpacked → select extension/
```

Open any YouTube video and pause it. With the Task 0 skeleton, a "ping ok" bubble appears over the player.

See [CLAUDE.md](CLAUDE.md) for the full plan, interfaces and tasks.

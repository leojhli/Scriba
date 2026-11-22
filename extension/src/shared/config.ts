// The video language is auto-detected per video by Scribe (no fixed LANGUAGE).

export const SERVER_URL = "http://localhost:3001";
export const WEB_URL = "http://localhost:3000";

// Must match DEMO_KEY in wasp-app/.env.server. Maps every request to the demo user.
export const DEMO_KEY = "pause-and-effect-demo";

// Every backend call times out after this and falls back to cache (Task 8).
export const REQUEST_TIMEOUT_MS = 8000;
// Shadow scoring runs Scribe on the recording, so it gets a little longer.
export const SHADOW_TIMEOUT_MS = 15000;
// Claude (~4 s) + TTS (~1 s); the bubble shows "thinking…" meanwhile.
export const EXPLAIN_TIMEOUT_MS = 15000;
export const MEDIA_TIMEOUT_MS = 15000;

export const SESSION_POLL_MS = 2000; // localhost, cheap: notice "ready" quickly
export const DIALOGUE_POLL_MS = 3000; // after ready, until the isolated dialogue track exists
export const CAPTION_KEEP_S = 3 * 60;
export const HEAR_IT_RATE = 0.75;

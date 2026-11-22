// Keep LANGUAGE identical to wasp-app/src/shared/config.ts.
export const LANGUAGE = "es";

export const SERVER_URL = "http://localhost:3001";

// Must match DEMO_KEY in wasp-app/.env.server. Maps every request to the demo user.
export const DEMO_KEY = "pause-and-effect-demo";

// Every backend call times out after this and falls back to cache (Task 8).
export const REQUEST_TIMEOUT_MS = 8000;

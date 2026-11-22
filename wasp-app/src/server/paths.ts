import fs from "node:fs";
import path from "node:path";

// `wasp start` runs the server from wasp-app/.wasp/out/server, so walk up to the
// directory holding .wasproot to find the project root.
function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, ".wasproot"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

export const PROJECT_ROOT = findProjectRoot();
/** Per-video media + transcripts: data/{videoId}/... (gitignored) */
export const DATA_DIR = process.env.DATA_DIR ?? path.join(PROJECT_ROOT, "data");
/** Pre-processed demo videos (committed), loaded by `wasp db seed` */
export const DEMO_CACHE_DIR = process.env.DEMO_CACHE_DIR ?? path.join(PROJECT_ROOT, "..", "demo-cache");

export function videoDir(videoId: string): string {
  // YouTube ids are [A-Za-z0-9_-]{11}; refuse anything else so paths stay inside DATA_DIR.
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) throw new Error(`bad videoId: ${videoId}`);
  const dir = path.join(DATA_DIR, videoId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

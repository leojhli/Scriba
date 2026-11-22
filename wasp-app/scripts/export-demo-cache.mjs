// Usage: npm run cache:export -- <videoId> [<videoId> ...]
// Copies data/{id}/ (transcript, dialogue.mp3, audio.mp3, explanations, translations)
// into ../demo-cache/{id}/ so `wasp db seed` can restore it with no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ids = process.argv.slice(2);
if (!ids.length) {
  console.error("usage: npm run cache:export -- <videoId> [<videoId> ...]");
  process.exit(1);
}
for (const id of ids) {
  const src = path.join(root, "data", id);
  if (!fs.existsSync(path.join(src, "video.json"))) {
    console.error(`skip ${id}: not ingested yet (no data/${id}/video.json). Open it with the extension first.`);
    continue;
  }
  const dst = path.join(root, "..", "demo-cache", id);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (f.startsWith("source.") || f.startsWith("shadow-")) continue; // big video file / temp recordings
    fs.cpSync(path.join(src, f), path.join(dst, f));
  }
  console.log(`exported ${id} → demo-cache/${id}`);
}

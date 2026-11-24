import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { ExtWord } from "wasp/server/api";
import { hasNonLatin } from "../shared/text";
import type { WordGloss } from "../shared/types";
import { checkDemoKey } from "./demoKey";
import { speakIn } from "./eleven";
import { ttsLanguage } from "./explain";
import { readJson, videoDir, writeJson } from "./paths";
import { getVideo, videoLanguage } from "./videos";

// Same model and settings as /ext/explain (known to work); the answer is a few short fields.
const MODEL = process.env.CLAUDE_WORD_MODEL ?? process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5";
const TIMEOUT_MS = 7_000; // the extension gives up after 8 s

const SYSTEM = `A learner watching a video tapped one word in a line to see what it means. Explain that word as it is used in this line.

Reply only with JSON:
- "lemma": the dictionary form if it differs from the tapped word (infinitive, singular…), else "";
- "romanization": the word in Latin letters if it's in a non-Latin script (Hanyu Pinyin with tone marks, Hepburn romaji, Revised Romanization…), else "";
- "meaning": what the word means here, in plain English, a few words (e.g. "I want", "hard to chase");
- "note": one short, useful note (grammar, form, slang, tone, or how it combines with its neighbours in this line), or "".`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lemma", "romanization", "meaning", "note"],
  properties: {
    lemma: { type: "string" },
    romanization: { type: "string" },
    meaning: { type: "string" },
    note: { type: "string" },
  },
} as const;

let anthropic: Anthropic | null = null;
function claude(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set in .env.server");
  return (anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: TIMEOUT_MS }));
}

type Body = { videoId?: string; segmentId?: number; line?: string; word?: string; index?: number };
type Cache = Record<string, WordGloss>;
const cacheFile = (videoId: string) => path.join(videoDir(videoId), "words.json");

/** POST /ext/word { videoId, segmentId, line, word, index } → WordGloss */
export const extWord: ExtWord = async (req, res) => {
  if (!checkDemoKey(req, res)) return;
  const { videoId, segmentId = -1, line, word, index = 0 } = (req.body ?? {}) as Body;
  if (!videoId || !line || !word || word.length > 60 || line.length > 500) {
    res.status(400).json({ error: "videoId, line and word required" });
    return;
  }
  const key = `${segmentId}|${index}|${word}|${line}`;
  const cached = readJson<Cache>(cacheFile(videoId), {})[key];
  if (cached) {
    res.json(cached);
    return;
  }

  const t0 = Date.now();
  const video = await getVideo(videoId);
  const seg = video?.segments?.find((s) => s.id === segmentId);
  // The video's own audio plays the word when it has a clean dialogue track and Scribe's word
  // timings; otherwise the word is spoken on its own, in the video's language.
  const needVoice = !(video?.hasDialogue && seg?.words?.length);
  const lang = ttsLanguage(undefined, videoLanguage(videoId));
  const voice = needVoice
    ? speakIn(word, lang, path.join(videoDir(videoId), `word-${Math.max(segmentId, 0)}-${index}-${Date.now() % 1e6}.mp3`))
        .then((f) => `/media/${videoId}/${path.basename(f)}`)
        .catch((e) => {
          console.error("[word] TTS failed", e);
          return null;
        })
    : Promise.resolve(null);

  try {
    const msg = await claude().beta.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
      thinking: { type: "between_tools" }, // no thinking: latency-bound
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: JSON.stringify({ video: video?.title ?? "", line, word, position: index }) }],
    });
    if (msg.stop_reason === "refusal") throw new Error("Claude declined");
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const out = JSON.parse(text) as { lemma: string; romanization: string; meaning: string; note: string };
    const lemma = out.lemma.trim();
    const romanization = hasNonLatin(word) ? out.romanization.trim() : "";
    const gloss: WordGloss = {
      word,
      ...(lemma && lemma.toLowerCase() !== word.toLowerCase() ? { lemma } : {}),
      ...(romanization ? { romanization } : {}),
      meaning: out.meaning.trim(),
      ...(out.note.trim() ? { note: out.note.trim() } : {}),
      audioUrl: await voice,
    };
    const cache = readJson<Cache>(cacheFile(videoId), {});
    cache[key] = gloss;
    writeJson(cacheFile(videoId), cache);
    console.log(`[word] ${videoId} "${word}" in ${Date.now() - t0}ms (voice: ${needVoice ? "tts" : "video"})`);
    res.json(gloss);
  } catch (e) {
    console.error("[word] failed", e);
    res.status(502).json({ error: String(e) });
  }
};

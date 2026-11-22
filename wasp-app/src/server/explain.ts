import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { ExtExplain } from "wasp/server/api";
import { spokenText } from "../shared/text";
import type { Explanation } from "../shared/types";
import { window as segWindow } from "../shared/window";
import { checkDemoKey } from "./demoKey";
import { speak } from "./eleven";
import { recordPause } from "./moments";
import { readJson, videoDir, writeJson } from "./paths";
import { getVideo, readTranslations, translationsFile, videoLanguage } from "./videos";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5";
const CLAUDE_TIMEOUT_MS = 10_000; // ~4 s typical for 3 lines; TTS adds ~1 s (extension waits 15 s)
const MAX_LINES = 3; // the last few lines keep it fast and focused
const PROCESSED_S = 180; // ingest downloads "*0:00-3:00"

const SYSTEM = `You are a friendly language tutor sitting next to a learner who is watching a video in the language they're learning (any language; detect it from the lines). The learner just paused right after the line in "justSaid". "context" holds the lines just before it, oldest first.

Reply only with JSON:
- "lines": one entry for every line (each context line and the justSaid line), with its index, a natural English translation, and short notes: 1–2 for the justSaid line (idioms, slang, grammar, or why it is said that way) and at most 1 for each context line. For Chinese include pinyin for key words; for Japanese include romaji.
- "summary": what you say out loud. 1–2 short spoken sentences (30 words at most) in English about the justSaid line only: what it means and the single most useful thing to know about it (a word, an idiom, a grammar point or the tone). Do not recap the scene, the story or the song, and do not open with "In this clip" or "Here". Talk to the learner directly, like a friend leaning over. Don't guess a speaker's gender: say "they" or use a name from the lines. You may quote one short word or phrase from the line in its original script, but never write pinyin or romaji in the summary.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "lines"],
  properties: {
    summary: { type: "string", description: "Spoken explanation of the justSaid line only: 1–2 short sentences in English." },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "translation", "notes"],
        properties: {
          index: { type: "integer" },
          translation: { type: "string" },
          notes: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

type Line = { segmentId: number; text: string; start: number; end: number };
type ClaudeOut = { summary: string; lines: { index: number; translation: string; notes: string[] }[] };

let anthropic: Anthropic | null = null;
function claude(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set in .env.server");
  return (anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: CLAUDE_TIMEOUT_MS }));
}

/** The last line is the one the learner paused on; the voice explains only that one. */
async function askClaude(lines: Line[], title: string, language: string | null): Promise<ClaudeOut> {
  const last = lines.length - 1;
  const user = JSON.stringify({
    video: title,
    ...(language ? { language } : {}),
    context: lines.slice(0, last).map((l, index) => ({ index, text: l.text })),
    justSaid: { index: last, text: lines[last].text },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await claude().beta.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      thinking: { type: "between_tools" }, // no thinking: this is latency-bound
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: user }],
    });
    if (msg.stop_reason === "refusal") throw new Error("Claude declined");
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    try {
      const out = JSON.parse(text) as ClaudeOut;
      if (typeof out.summary === "string" && Array.isArray(out.lines)) return out;
    } catch {
      /* retry once on invalid JSON */
    }
  }
  throw new Error("Claude returned invalid JSON twice");
}

type Cache = Record<string, Explanation>;
const cacheFile = (videoId: string) => path.join(videoDir(videoId), "explain-cache.json");

/** A cached explanation of the same just-said line (the voice talks about that line only). */
function cachedFor(videoId: string, lines: Line[]): Explanation | null {
  const just = lines[lines.length - 1];
  if (just.segmentId < 0) return null;
  const cache = readJson<Cache>(cacheFile(videoId), {});
  return Object.values(cache).find((e) => e.lines[e.lines.length - 1]?.segmentId === just.segmentId) ?? null;
}

/** POST /ext/explain { videoId, t, captionLines } → Explanation */
export const extExplain: ExtExplain = async (req, res) => {
  if (!checkDemoKey(req, res)) return;
  const body = (req.body ?? {}) as {
    videoId?: string;
    t?: number;
    captionLines?: { text: string; start: number; end: number }[];
  };
  const { videoId, t } = body;
  if (!videoId || typeof t !== "number") {
    res.status(400).json({ error: "videoId and t required" });
    return;
  }
  const video = await getVideo(videoId);
  const captionLines = body.captionLines ?? [];

  // Scribe segments when ready; otherwise the live captions the extension read.
  const fromSegments: Line[] = video?.segments
    ? segWindow(video.segments, t).map((s) => ({ segmentId: s.id, text: s.text, start: s.start, end: s.end }))
    : [];
  // Scribe only covers the first 3 minutes; past that (or while processing) use the live captions.
  const lines: Line[] = fromSegments.length
    ? fromSegments
    : segWindow(captionLines, t).map((c) => ({ segmentId: -1, text: c.text, start: c.start, end: c.end }));
  lines.splice(0, Math.max(0, lines.length - MAX_LINES));

  if (!lines.length) {
    const processing = !video || video.status === "processing";
    const saidEarlier = (video?.segments ?? []).some((s) => s.start <= t) || captionLines.some((c) => c.start <= t);
    const summary =
      processing && !captionLines.length
        ? "Still listening… give me a few seconds."
        : t > PROCESSED_S
          ? "I transcribed the first 3 minutes. Past that I read YouTube's captions, so turn on CC and play a little."
          : saidEarlier
            ? "Nothing was said in the last few seconds. Pause right after a line and I'll explain it."
            : "Nothing's been said yet. Play a bit more!";
    res.json({ summary, audioUrl: null, lines: [] } satisfies Explanation);
    return;
  }

  await recordPause(videoId, t).catch((e) => console.error("[explain] moment", e));

  const key = String(Math.round(t));
  const t0 = Date.now();
  let tClaude = 0;
  let explanation: Explanation;
  try {
    const out = await askClaude(lines, video?.title ?? videoId, videoLanguage(videoId));
    const byIndex = new Map(out.lines.map((l) => [l.index, l]));
    explanation = {
      summary: out.summary,
      audioUrl: null,
      lines: lines.map((l, i) => {
        const o = byIndex.get(i) ?? out.lines[i];
        return { segmentId: l.segmentId, original: l.text, translation: o?.translation ?? "", notes: o?.notes ?? [] };
      }),
    };
    tClaude = Date.now() - t0;
  } catch (e) {
    console.error("[explain] Claude failed, using cache", e);
    const cached = cachedFor(videoId, lines);
    if (cached) {
      res.json({ ...cached, offline: true } satisfies Explanation);
      return;
    }
    // No explanation of this exact line cached: show the lines with any translations we know.
    const tr = readTranslations(videoId);
    const known = lines.map((l) => ({ segmentId: l.segmentId, original: l.text, translation: tr[l.segmentId]?.translation ?? "", notes: tr[l.segmentId]?.notes ?? [] }));
    const just = known[known.length - 1].translation;
    res.json({
      summary: just ? `I'm offline, but that line means: “${just}”` : "I'm offline right now, but here are the lines.",
      audioUrl: null,
      offline: true,
      lines: known,
    } satisfies Explanation);
    return;
  }

  const t1 = Date.now();
  try {
    const file = `explain-${key}.mp3`;
    await speak(spokenText(explanation.summary), path.join(videoDir(videoId), file));
    explanation.audioUrl = `/media/${videoId}/${file}`;
  } catch (e) {
    console.error("[explain] TTS failed", e);
  }
  console.log(`[explain] ${videoId}@${key}s claude=${tClaude}ms tts=${Date.now() - t1}ms total=${Date.now() - t0}ms`);

  // Persist: translations for /deck + /practice, and the explanation for offline fallback.
  const tr = readTranslations(videoId);
  for (const l of explanation.lines) if (l.segmentId >= 0) tr[l.segmentId] = { translation: l.translation, notes: l.notes };
  writeJson(translationsFile(videoId), tr);
  const cache = readJson<Cache>(cacheFile(videoId), {});
  cache[key] = explanation;
  writeJson(cacheFile(videoId), cache);

  res.json(explanation);
};

export function hasMedia(videoId: string, file: string): boolean {
  return fs.existsSync(path.join(videoDir(videoId), file));
}

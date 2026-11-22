import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { ExtExplain } from "wasp/server/api";
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

const SYSTEM = `You are a friendly language tutor watching a video with a learner who is studying the language spoken in it (any language; detect it from the lines). For each line, give a natural English translation and 1–2 short notes on idioms, slang, grammar or what is happening in the scene. For Chinese include pinyin for key words, for Japanese include romaji. Then write a spoken summary in English of at most 2 sentences. Reply only with JSON matching the Explanation type.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "lines"],
  properties: {
    summary: { type: "string", description: "Spoken summary, at most 2 sentences, in English." },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["segmentId", "translation", "notes"],
        properties: {
          segmentId: { type: "integer" },
          translation: { type: "string" },
          notes: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

type Line = { segmentId: number; text: string; start: number; end: number };
type ClaudeOut = { summary: string; lines: { segmentId: number; translation: string; notes: string[] }[] };

let anthropic: Anthropic | null = null;
function claude(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set in .env.server");
  return (anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: CLAUDE_TIMEOUT_MS }));
}

async function askClaude(lines: Line[], title: string, language: string | null): Promise<ClaudeOut> {
  const user = JSON.stringify({
    video: title,
    ...(language ? { language } : {}),
    lines: lines.map((l) => ({ segmentId: l.segmentId, text: l.text })),
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

function nearestCached(videoId: string, t: number): Explanation | null {
  const cache = readJson<Cache>(cacheFile(videoId), {});
  let best: { d: number; e: Explanation } | null = null;
  for (const [k, e] of Object.entries(cache)) {
    const d = Math.abs(Number(k) - t);
    if (d <= 30 && (!best || d < best.d)) best = { d, e };
  }
  return best?.e ?? null;
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
    const summary =
      processing && !captionLines.length
        ? "Still listening… give me a few seconds."
        : t > PROCESSED_S
          ? "I transcribed the first 3 minutes. Past that I read YouTube's captions, so turn on CC and play a little."
          : "Nothing's been said yet. Play a bit more!";
    res.json({ summary, audioUrl: null, lines: [] } satisfies Explanation);
    return;
  }

  await recordPause(videoId, t).catch((e) => console.error("[explain] moment", e));

  const key = String(Math.round(t));
  let explanation: Explanation;
  try {
    const out = await askClaude(lines, video?.title ?? videoId, videoLanguage(videoId));
    const byId = new Map(out.lines.map((l) => [l.segmentId, l]));
    explanation = {
      summary: out.summary,
      audioUrl: null,
      lines: lines.map((l, i) => {
        const o = (l.segmentId >= 0 ? byId.get(l.segmentId) : undefined) ?? out.lines[i];
        return { segmentId: l.segmentId, original: l.text, translation: o?.translation ?? "", notes: o?.notes ?? [] };
      }),
    };
  } catch (e) {
    console.error("[explain] Claude failed, using cache", e);
    const cached = nearestCached(videoId, t);
    res.json(
      cached
        ? { ...cached, offline: true }
        : ({
            summary: "I'm offline right now, but here are the lines.",
            audioUrl: null,
            offline: true,
            lines: lines.map((l) => ({ segmentId: l.segmentId, original: l.text, translation: "", notes: [] })),
          } satisfies Explanation),
    );
    return;
  }

  try {
    const file = `explain-${key}.mp3`;
    await speak(explanation.summary, path.join(videoDir(videoId), file));
    explanation.audioUrl = `/media/${videoId}/${file}`;
  } catch (e) {
    console.error("[explain] TTS failed", e);
  }

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

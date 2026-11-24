import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { ExtExplain, ExtExplainRest } from "wasp/server/api";
import { completedStrings } from "../shared/partialJson";
import { displaySummary, hasNonLatin, speechParts } from "../shared/text";
import type { Explanation } from "../shared/types";
import { window as segWindow } from "../shared/window";
import { checkDemoKey } from "./demoKey";
import { speakMixed } from "./eleven";
import { recordPause } from "./moments";
import { readJson, videoDir, writeJson } from "./paths";
import { getVideo, readTranslations, translationsFile, videoLanguage } from "./videos";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5";
// ~4–6 s for the whole reply, but the voice starts once "summary" is done (~1.5 s in) and the
// extension gets it right after TTS; the translations follow via /ext/explain-rest.
const CLAUDE_TIMEOUT_MS = 10_000;
const MAX_LINES = 3; // the last few lines keep it fast and focused
const PROCESSED_S = 180; // ingest downloads "*0:00-3:00"
const BACKGROUND_LINES = 20; // earlier lines Claude reads (not shown) to understand the moment

const SYSTEM = `You are a friendly language tutor sitting next to a learner who is watching a video in the language they're learning (any language; detect it from the lines). The learner just paused right after the line in "justSaid". "context" holds the lines just before it, oldest first. "background" holds what was said earlier in the video, oldest first: together with the video title, use it to understand the situation (who is talking to whom, what is going on, what the line refers to). Don't reveal what happens later.

Reply only with JSON:
- "lines": one entry for every line (each context line and the justSaid line), with:
  - "index";
  - "romanization": if the line is in a non-Latin script, the whole line in Latin letters: Hanyu Pinyin with tone marks for Chinese, Hepburn romaji for Japanese, Revised Romanization for Korean, a standard transliteration for any other script. Keep words already in Latin letters as they are. Empty string for a line in a Latin-script language;
  - "translation": a natural English translation;
  - "notes": 1–2 short notes for the justSaid line and at most 1 for each context line: what the line means at this moment in the video (what it refers to, the joke, feeling or subtext), idioms, slang or grammar. Give the reading of key words in non-Latin scripts (pinyin, romaji…).
- "summary": what you say out loud. 1–2 short spoken sentences (45 words at most) in English about the justSaid line: what it means here, at this moment in the video (who it's aimed at, what it refers to, the joke, feeling or subtext), and the single most useful thing to learn from it (a word, an idiom, a grammar point or the tone). A quick bit of plot recap to set the line up is fine, but keep the focus on this line: no overview of the whole video or song, and don't open with "In this clip" or "Here". Talk to the learner directly, like a friend leaning over. Don't guess a speaker's gender: say "they" or use a name from the lines. You may quote one short word or phrase from the line in its original script, but never write pinyin or romaji in the summary. Wrap every word or phrase you quote in the video's language in «guillemets», exactly as written in the line, e.g. The key phrase is «难追», hard to chase. / They call it «la neta», the honest truth. The quotes are read aloud in that language's own accent, so put only the foreign words inside, never English.
- "language": the ISO 639-1 code of the language of the lines (e.g. "es", "zh", "ja", "ko", "fr").`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "language", "lines"],
  properties: {
    language: { type: "string", description: "ISO 639-1 code of the lines' language, e.g. es, zh, ja." },
    summary: { type: "string", description: "Spoken explanation of the justSaid line only: 1–2 short sentences in English." },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "romanization", "translation", "notes"],
        properties: {
          index: { type: "integer" },
          romanization: { type: "string" },
          translation: { type: "string" },
          notes: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

type Line = { segmentId: number; text: string; start: number; end: number };
type ClaudeOut = { summary: string; language?: string; lines: { index: number; romanization: string; translation: string; notes: string[] }[] };

let anthropic: Anthropic | null = null;
function claude(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set in .env.server");
  return (anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: CLAUDE_TIMEOUT_MS }));
}

/**
 * The last line is the one the learner paused on; the voice explains only that one.
 * Streams the reply and calls `onSummary` once, as soon as "summary" is complete (Claude writes it
 * before the line translations), so the voice can be made while the rest is still being written.
 */
async function askClaude(
  lines: Line[],
  title: string,
  language: string | null,
  background: string[],
  onSummary: (summary: string, language?: string) => void,
): Promise<ClaudeOut> {
  const last = lines.length - 1;
  const user = JSON.stringify({
    video: title,
    ...(language ? { language } : {}),
    ...(background.length ? { background } : {}),
    context: lines.slice(0, last).map((l, index) => ({ index, text: l.text })),
    justSaid: { index: last, text: lines[last].text },
  });
  let told = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = claude().beta.messages.stream({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      thinking: { type: "between_tools" }, // no thinking: this is latency-bound
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: user }],
    });
    let sofar = "";
    stream.on("text", (delta) => {
      if (told) return;
      sofar += delta;
      const f = completedStrings(sofar);
      if (f.summary === undefined) return;
      told = true;
      onSummary(f.summary, f.language);
    });
    const msg = await stream.finalMessage();
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

// Scribe reports ISO 639-3 ("zho", "spa"); ElevenLabs TTS takes ISO 639-1 ("zh", "es").
const ISO3_TO_1: Record<string, string> = {
  zho: "zh", cmn: "zh", yue: "zh", spa: "es", jpn: "ja", kor: "ko", fra: "fr", deu: "de", ita: "it", por: "pt",
  rus: "ru", ara: "ar", hin: "hi", tur: "tr", vie: "vi", tha: "th", ind: "id", nld: "nl", pol: "pl", eng: "en",
};

/** The code the foreign parts are spoken with: Claude's answer, else the language Scribe detected. */
function ttsLanguage(fromClaude: string | undefined, fromScribe: string | null): string | null {
  const c = fromClaude?.trim().toLowerCase().slice(0, 2);
  if (c && /^[a-z]{2}$/.test(c)) return c;
  return (fromScribe && ISO3_TO_1[fromScribe]) || null;
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

  // What was said before these lines (not shown or translated), so Claude knows the situation.
  const earlier: { text: string; start: number }[] = fromSegments.length ? (video?.segments ?? []) : captionLines;
  const background = earlier.filter((s) => s.start < lines[0].start).slice(-BACKGROUND_LINES).map((s) => s.text);

  const key = String(Math.round(t));
  const job = explainInTwoPhases(videoId, key, lines, video?.title ?? videoId, background);
  const first = await job.first;
  if (first.partial) {
    // The extension asks for the rest right away; keep it around for a while in case it's slow.
    const id = pendingId(videoId, key);
    pending.set(id, job.full);
    setTimeout(() => pending.get(id) === job.full && pending.delete(id), PENDING_KEEP_MS);
  }
  res.json(first);
};

/** POST /ext/explain-rest { videoId, t } → the full Explanation for a pause /ext/explain answered `partial`. */
export const extExplainRest: ExtExplainRest = async (req, res) => {
  if (!checkDemoKey(req, res)) return;
  const { videoId, t } = (req.body ?? {}) as { videoId?: string; t?: number };
  if (!videoId || typeof t !== "number") {
    res.status(400).json({ error: "videoId and t required" });
    return;
  }
  const key = String(Math.round(t));
  const job = pending.get(pendingId(videoId, key));
  if (job) {
    res.json(await job);
    return;
  }
  // Already finished and dropped from memory (or the server restarted): it was saved to the cache.
  const cached = readJson<Cache>(cacheFile(videoId), {})[key];
  if (cached) res.json(cached);
  else res.status(404).json({ error: "no explanation for that moment" });
};

const PENDING_KEEP_MS = 2 * 60_000;
const pending = new Map<string, Promise<Explanation>>();
const pendingId = (videoId: string, key: string) => `${videoId}@${key}`;

type Voice = { summary: string; audioUrl: string | null };

/**
 * `first` resolves as soon as the voice is ready (`partial`: translations still coming), or with
 * the full explanation if that somehow finishes first. `full` resolves when Claude is done; it is
 * saved for /deck, /practice and offline use. Neither ever rejects: failures become the offline
 * explanation.
 */
function explainInTwoPhases(
  videoId: string,
  key: string,
  lines: Line[],
  title: string,
  background: string[],
): { first: Promise<Explanation>; full: Promise<Explanation> } {
  const t0 = Date.now();
  const scribeLang = videoLanguage(videoId);
  const ms = { summary: 0, voice: 0, claude: 0 };

  const speak = async (raw: string, claudeLang: string | undefined): Promise<Voice> => {
    const file = `explain-${key}.mp3`;
    let audioUrl: string | null = null;
    try {
      await speakMixed(speechParts(raw), ttsLanguage(claudeLang, scribeLang), path.join(videoDir(videoId), file));
      audioUrl = `/media/${videoId}/${file}`;
    } catch (e) {
      console.error("[explain] TTS failed", e);
    }
    ms.voice = Date.now() - t0;
    return { summary: displaySummary(raw), audioUrl };
  };

  let voice: Promise<Voice> | null = null;
  let voiceReady!: (v: Voice) => void;
  const firstVoice = new Promise<Voice>((r) => (voiceReady = r));

  const claudeDone = askClaude(lines, title, scribeLang, background, (summary, language) => {
    ms.summary = Date.now() - t0;
    voice = speak(summary, language);
    void voice.then(voiceReady);
  });

  let settled: Explanation | null = null;
  const full = claudeDone.then(
    async (out) => {
      ms.claude = Date.now() - t0;
      voice ??= speak(out.summary, out.language); // the summary never streamed on its own
      const v = await voice;
      const byIndex = new Map(out.lines.map((l) => [l.index, l]));
      const e: Explanation = {
        summary: v.summary,
        audioUrl: v.audioUrl,
        lines: lines.map((l, i) => {
          const o = byIndex.get(i) ?? out.lines[i];
          // Only lines that actually have non-Latin letters get one (the model may echo Latin lines).
          const romanization = hasNonLatin(l.text) ? o?.romanization?.trim() : "";
          return {
            segmentId: l.segmentId,
            original: l.text,
            ...(romanization ? { romanization } : {}),
            translation: o?.translation ?? "",
            notes: o?.notes ?? [],
          };
        }),
      };
      console.log(
        `[explain] ${videoId}@${key}s summary=${ms.summary}ms voice=${ms.voice}ms claude=${ms.claude}ms total=${Date.now() - t0}ms`,
      );
      try {
        save(videoId, key, e);
      } catch (err) {
        console.error("[explain] couldn't save", err);
      }
      return (settled = e);
    },
    async (err): Promise<Explanation> => {
      console.error("[explain] Claude failed", err);
      const v = voice ? await voice : null;
      if (!v) {
        const cached = cachedFor(videoId, lines);
        if (cached) return (settled = { ...cached, offline: true });
      }
      return (settled = withKnownTranslations(videoId, lines, v));
    },
  );

  const first = Promise.race([full, firstVoice]).then((r): Explanation => {
    if ("lines" in r) return r; // Claude finished (or failed) before the voice was ready
    if (settled) return settled;
    console.log(`[explain] ${videoId}@${key}s voice ready at ${ms.voice}ms (summary ${ms.summary}ms), details to follow`);
    return { ...withKnownTranslations(videoId, lines, r), partial: true };
  });
  return { first, full };
}

/**
 * The lines with any translations an earlier pause already saved. With a voice: it's the voice's
 * summary (Claude is fine, just not done, or failed after the summary). Without: the offline message.
 */
function withKnownTranslations(videoId: string, lines: Line[], voice: Voice | null): Explanation {
  const tr = readTranslations(videoId);
  const known = lines.map((l) => ({
    segmentId: l.segmentId,
    original: l.text,
    ...(tr[l.segmentId]?.romanization ? { romanization: tr[l.segmentId].romanization } : {}),
    translation: tr[l.segmentId]?.translation ?? "",
    notes: tr[l.segmentId]?.notes ?? [],
  }));
  if (voice) return { ...voice, lines: known };
  const just = known[known.length - 1].translation;
  return {
    summary: just ? `I'm offline, but that line means: “${just}”` : "I'm offline right now, but here are the lines.",
    audioUrl: null,
    offline: true,
    lines: known,
  };
}

/** Persist: translations for /deck + /practice, and the explanation for offline fallback. */
function save(videoId: string, key: string, e: Explanation): void {
  const tr = readTranslations(videoId);
  for (const l of e.lines)
    if (l.segmentId >= 0) tr[l.segmentId] = { translation: l.translation, notes: l.notes, romanization: l.romanization };
  writeJson(translationsFile(videoId), tr);
  const cache = readJson<Cache>(cacheFile(videoId), {});
  cache[key] = e;
  writeJson(cacheFile(videoId), cache);
}

export function hasMedia(videoId: string, file: string): boolean {
  return fs.existsSync(path.join(videoDir(videoId), file));
}

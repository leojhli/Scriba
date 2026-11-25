import fs from "node:fs";
import path from "node:path";
import { prisma } from "wasp/server";
import type { ExtShadow } from "wasp/server/api";
import { clarityFromScribe, needsTip, tipInput } from "../shared/clarity";
import { type Assessment, attachToDiff, azureLocale } from "../shared/pronunciation";
import type { Word } from "../shared/segments";
import { score } from "../shared/score";
import { assessPronunciation, azureConfigured, toWav16k } from "./azure";
import { coachTip } from "./coach";
import type { ShadowResult } from "../shared/types";
import { checkDemoKey } from "./demoKey";
import { getDemoUserId } from "./demoUser";
import { transcribeWords } from "./eleven";
import { videoDir } from "./paths";
import { getVideo, videoLanguage } from "./videos";

export type ShadowInput = {
  videoId: string;
  segmentId: number;
  audioBase64: string;
  durationSec: number;
  /** Fallback when the transcript isn't ready (captions-only lines have segmentId -1). */
  text?: string;
  origDur?: number;
};

/**
 * Transcribe the attempt (Azure if configured, else Scribe), score it against the line, save a
 * ShadowAttempt, and add how clearly each word was said plus one coaching tip from Claude.
 */
export async function scoreAttempt(input: ShadowInput, userId: number): Promise<ShadowResult & { heard: string }> {
  const { videoId, segmentId, audioBase64, durationSec } = input;
  const video = await getVideo(videoId);
  const seg = video?.segments?.find((s) => s.id === segmentId);
  const expected = seg?.text ?? input.text ?? "";
  const origDur = seg ? seg.end - seg.start : (input.origDur ?? durationSec);
  if (!expected) throw new Error("unknown line");

  const t0 = Date.now();
  const language = videoLanguage(videoId);
  let heard = "";
  let heardWords: Word[] = [];
  let assessment: Assessment | null = null;
  if (audioBase64 && durationSec > 0.3) {
    const stamp = Date.now();
    const file = path.join(videoDir(videoId), `shadow-${stamp}.webm`);
    const wav = path.join(videoDir(videoId), `shadow-${stamp}.wav`);
    fs.writeFileSync(file, Buffer.from(audioBase64, "base64"));
    try {
      // Azure scores each word and sound when it's set up and knows the language; otherwise (or if
      // it fails) Scribe transcribes the take, as before. Either way the word diff below is the same.
      const locale = azureConfigured() ? azureLocale(language, process.env.AZURE_SPEECH_LOCALE) : null;
      if (locale) {
        try {
          await toWav16k(file, wav);
          assessment = await assessPronunciation(wav, expected, locale);
          heard = assessment.heard;
          console.log(`[shadow] azure ${locale} pron=${Math.round(assessment.overall)} in ${Date.now() - t0}ms`);
        } catch (e) {
          console.error(`[shadow] azure failed after ${Date.now() - t0}ms, using Scribe`, e);
        }
      }
      if (!assessment) {
        const t = await transcribeWords(file, language);
        heard = t.text ?? "";
        heardWords = t.words;
      }
    } finally {
      fs.rmSync(file, { force: true });
      fs.rmSync(wav, { force: true });
    }
  }
  // Silence or mumbling just scores 0 with every word missed, never an error.
  const words = score(expected, heard, durationSec, origDur);
  // How well each word was said: Azure's scores when it ran, else how sure Scribe was (clarity).
  const pron = assessment ? attachToDiff(words.diff, assessment) : clarityFromScribe(words.diff, heardWords);
  if (segmentId >= 0) {
    await prisma.shadowAttempt.create({
      data: { userId, videoId, segmentId, accuracy: words.accuracy, paceRatio: words.paceRatio },
    });
  }
  // One coaching tip from Claude when something needs fixing (time-boxed; the score never waits long).
  const tip = needsTip(words.diff, pron, heard) ? await coachTip(tipInput(expected, heard, words.diff, pron, language)) : null;
  const pronunciation = pron || tip ? { ...(pron ?? { overall: Math.round(words.accuracy * 100), source: "scribe" as const, words: [] }), ...(tip ? { tip } : {}) } : null;
  console.log(
    `[shadow] ${videoId}#${segmentId} accuracy=${Math.round(words.accuracy * 100)} ${pron?.source ?? "no"}=${pron?.overall ?? "-"} tip=${tip ? "yes" : "no"} in ${Date.now() - t0}ms`,
  );
  return { ...words, ...(pronunciation ? { pronunciation } : {}), heard };
}

/** POST /ext/shadow { videoId, segmentId, audioBase64, durationSec } → ShadowResult */
export const extShadow: ExtShadow = async (req, res) => {
  if (!checkDemoKey(req, res)) return;
  const input = (req.body ?? {}) as ShadowInput;
  if (!input.videoId || typeof input.segmentId !== "number") {
    res.status(400).json({ error: "videoId and segmentId required" });
    return;
  }
  try {
    res.json(await scoreAttempt(input, await getDemoUserId()));
  } catch (e) {
    console.error("[shadow] failed", e);
    res.status(502).json({ error: String(e) });
  }
};

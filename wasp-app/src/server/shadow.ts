import fs from "node:fs";
import path from "node:path";
import { prisma } from "wasp/server";
import type { ExtShadow } from "wasp/server/api";
import { type Assessment, attachToDiff, azureLocale } from "../shared/pronunciation";
import { score } from "../shared/score";
import { assessPronunciation, azureConfigured, toWav16k } from "./azure";
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

/** Transcribe the attempt with Scribe, score it against the line, save a ShadowAttempt. */
export async function scoreAttempt(input: ShadowInput, userId: number): Promise<ShadowResult & { heard: string }> {
  const { videoId, segmentId, audioBase64, durationSec } = input;
  const video = await getVideo(videoId);
  const seg = video?.segments?.find((s) => s.id === segmentId);
  const expected = seg?.text ?? input.text ?? "";
  const origDur = seg ? seg.end - seg.start : (input.origDur ?? durationSec);
  if (!expected) throw new Error("unknown line");

  let heard = "";
  let assessment: Assessment | null = null;
  if (audioBase64 && durationSec > 0.3) {
    const stamp = Date.now();
    const file = path.join(videoDir(videoId), `shadow-${stamp}.webm`);
    const wav = path.join(videoDir(videoId), `shadow-${stamp}.wav`);
    fs.writeFileSync(file, Buffer.from(audioBase64, "base64"));
    try {
      const language = videoLanguage(videoId);
      // Azure scores each word and sound when it's set up and knows the language; otherwise (or if
      // it fails) Scribe transcribes the take, as before. Either way the word diff below is the same.
      const locale = azureConfigured() ? azureLocale(language, process.env.AZURE_SPEECH_LOCALE) : null;
      if (locale) {
        const t0 = Date.now();
        try {
          await toWav16k(file, wav);
          assessment = await assessPronunciation(wav, expected, locale);
          heard = assessment.heard;
          console.log(`[shadow] azure ${locale} pron=${Math.round(assessment.overall)} in ${Date.now() - t0}ms`);
        } catch (e) {
          console.error(`[shadow] azure failed after ${Date.now() - t0}ms, using Scribe`, e);
        }
      }
      if (!assessment) heard = (await transcribeWords(file, language)).text ?? "";
    } finally {
      fs.rmSync(file, { force: true });
      fs.rmSync(wav, { force: true });
    }
  }
  // Silence or mumbling just scores 0 with every word missed, never an error.
  const words = score(expected, heard, durationSec, origDur);
  const result = assessment ? { ...words, pronunciation: attachToDiff(words.diff, assessment) } : words;
  if (segmentId >= 0) {
    await prisma.shadowAttempt.create({
      data: { userId, videoId, segmentId, accuracy: result.accuracy, paceRatio: result.paceRatio },
    });
  }
  return { ...result, heard };
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

// Azure Speech Pronunciation Assessment over the REST API for short audio (no SDK dependency).
// Optional: only used when AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (or AZURE_SPEECH_ENDPOINT)
// are set in .env.server. Shadow scoring falls back to Scribe + the word diff otherwise.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { type Assessment, parseAssessment } from "../shared/pronunciation";
import { ffmpegPath } from "./ingest";

const run = promisify(execFile);
const TIMEOUT_MS = 10_000; // the extension waits 15 s for /ext/shadow

export function azureConfigured(): boolean {
  return !!process.env.AZURE_SPEECH_KEY && !!(process.env.AZURE_SPEECH_REGION || process.env.AZURE_SPEECH_ENDPOINT);
}

function endpoint(): string {
  const path = "speech/recognition/conversation/cognitiveservices/v1";
  // A resource endpoint (https://<name>.cognitiveservices.azure.com) or the regional host.
  const custom = process.env.AZURE_SPEECH_ENDPOINT?.replace(/\/+$/, "");
  return custom ? `${custom}/stt/${path}` : `https://${process.env.AZURE_SPEECH_REGION}.stt.speech.microsoft.com/${path}`;
}

/** Azure wants 16 kHz mono PCM WAV; the extension records webm/opus. */
export async function toWav16k(input: string, output: string): Promise<void> {
  await run(ffmpegPath(), ["-y", "-loglevel", "error", "-i", input, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", output], {
    timeout: 20_000,
  });
}

/**
 * Scores a recording of `referenceText` per word and per phoneme (HundredMark, miscue on, so
 * left-out and added words show up). Throws on any failure; the caller falls back to Scribe.
 */
export async function assessPronunciation(wavFile: string, referenceText: string, locale: string): Promise<Assessment> {
  const params = {
    ReferenceText: referenceText,
    GradingSystem: "HundredMark",
    Granularity: "Phoneme",
    Dimension: "Comprehensive",
    EnableMiscue: true,
  };
  const res = await fetch(`${endpoint()}?language=${encodeURIComponent(locale)}&format=detailed`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY!,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      Accept: "application/json",
      "Pronunciation-Assessment": Buffer.from(JSON.stringify(params), "utf8").toString("base64"),
    },
    body: await fs.readFile(wavFile),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Azure ${res.status}: ${text.slice(0, 200)}`);
  const a = parseAssessment(JSON.parse(text));
  if (!a) throw new Error(`Azure recognised nothing (${text.slice(0, 120)})`);
  return a;
}

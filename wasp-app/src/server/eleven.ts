import fs from "node:fs/promises";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { groupWords, type Word } from "../shared/segments";
import type { SpeechPart } from "../shared/text";
import type { Segment } from "../shared/types";
import { joinMp3 } from "./mp3";

const SCRIBE_MODEL = process.env.ELEVENLABS_SCRIBE_MODEL ?? "scribe_v2";
const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5";
// Scriba's voice: "Hope - upbeat and clear" from the ElevenLabs voice library
// (published by its voice actor). Never a clone of an actor from the video.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "tnSpp4vdxKPjI9w0GnoV";

let client: ElevenLabsClient | null = null;
function eleven(): ElevenLabsClient {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set in .env.server");
  return (client ??= new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY }));
}

export type { Word };

/** Scribe with word timestamps. `lang` omitted = auto-detect. Returns only spoken words. */
export async function transcribeWords(
  path: string,
  lang?: string | null,
): Promise<{ text: string; language: string | null; words: Word[] }> {
  const res = await eleven().speechToText.convert({
    file: { path },
    modelId: SCRIBE_MODEL,
    ...(lang ? { languageCode: lang } : {}),
    timestampsGranularity: "word",
    tagAudioEvents: false,
  });
  if (!("words" in res)) throw new Error("unexpected Scribe response (multichannel/webhook)");
  const words = res.words
    .filter((w) => w.type === "word" && w.start != null && w.end != null)
    .map((w) => ({ text: w.text, start: w.start!, end: w.end! }));
  return { text: res.text, language: res.languageCode || null, words };
}

/** Transcribes a whole video's audio, auto-detecting the language. */
export async function transcribe(path: string, lang?: string | null): Promise<{ segments: Segment[]; language: string | null }> {
  const { words, language } = await transcribeWords(path, lang);
  return { segments: groupWords(words), language };
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

/** Voice Isolator: writes the dialogue-only track to outPath. Returns outPath, or null on error. */
export async function isolate(inPath: string, outPath: string): Promise<string | null> {
  try {
    const stream = await eleven().audioIsolation.convert({ audio: { path: inPath } });
    await fs.writeFile(outPath, await streamToBuffer(stream));
    return outPath;
  } catch (e) {
    console.error("[eleven] isolate failed", e);
    return null;
  }
}

async function tts(text: string, opts: { languageCode?: string; previousText?: string; nextText?: string } = {}): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const stream = await eleven().textToSpeech.convert(VOICE_ID, {
        text,
        modelId: TTS_MODEL,
        outputFormat: "mp3_44100_128",
        ...(opts.languageCode ? { languageCode: opts.languageCode } : {}),
        ...(opts.previousText ? { previousText: opts.previousText } : {}),
        ...(opts.nextText ? { nextText: opts.nextText } : {}),
      });
      return await streamToBuffer(stream);
    } catch (e) {
      // Several parts go out at once; on a busy plan ElevenLabs answers 429. Retry once.
      if (attempt >= 1 || (e as { statusCode?: number }).statusCode !== 429) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

/** Text-to-speech in Scriba's voice. Writes an mp3 to outPath. */
export async function speak(text: string, outPath: string): Promise<string> {
  await fs.writeFile(outPath, await tts(text));
  return outPath;
}

/** Text-to-speech in a given language (e.g. one tapped word in the video's language). */
export async function speakIn(text: string, languageCode: string | null, outPath: string): Promise<string> {
  await fs.writeFile(outPath, await tts(text, languageCode ? { languageCode } : {}));
  return outPath;
}

/**
 * Speaks a summary that quotes another language: English parts with "en", quotes with the
 * video's language code, so "难追" sounds Mandarin instead of "nonjui". The parts are made in
 * parallel (English parts get the neighbouring text as context, for natural intonation) and joined.
 */
export async function speakMixed(parts: SpeechPart[], language: string | null, outPath: string): Promise<string> {
  if (parts.length <= 1 && !parts.some((p) => p.foreign)) return speak(parts[0]?.text ?? "", outPath);
  const clips = await Promise.all(
    parts.map((p, i) =>
      tts(
        p.text,
        // Quotes get no context: English around a short quote pulls it back to an English accent
        // (难追 with context → "Nanjue" 3/3 times; without → Mandarin 3/3, checked with Scribe).
        p.foreign
          ? { languageCode: language ?? undefined }
          : {
              languageCode: "en",
              previousText: parts.slice(0, i).map((q) => q.text).join(" ").slice(-300) || undefined,
              nextText: parts.slice(i + 1).map((q) => q.text).join(" ").slice(0, 300) || undefined,
            },
      ),
    ),
  );
  await fs.writeFile(outPath, joinMp3(clips));
  return outPath;
}

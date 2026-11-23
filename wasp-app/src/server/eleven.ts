import fs from "node:fs/promises";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { groupWords, type Word } from "../shared/segments";
import type { Segment } from "../shared/types";

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

/** Text-to-speech with the stock mascot voice. Writes an mp3 to outPath. */
export async function speak(text: string, outPath: string): Promise<string> {
  const stream = await eleven().textToSpeech.convert(VOICE_ID, {
    text,
    modelId: TTS_MODEL,
    outputFormat: "mp3_44100_128",
  });
  await fs.writeFile(outPath, await streamToBuffer(stream));
  return outPath;
}

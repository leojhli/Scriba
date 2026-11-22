import fs from "node:fs/promises";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { Segment } from "../shared/types";

const SCRIBE_MODEL = process.env.ELEVENLABS_SCRIBE_MODEL ?? "scribe_v2";
const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5";
// Stock premade voice ("George"). Never a cloned actor.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";

let client: ElevenLabsClient | null = null;
function eleven(): ElevenLabsClient {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set in .env.server");
  return (client ??= new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY }));
}

export type Word = { text: string; start: number; end: number };

/** Scribe with word timestamps. Returns only spoken words (no spacing / audio events). */
export async function transcribeWords(path: string, lang: string): Promise<{ text: string; words: Word[] }> {
  const res = await eleven().speechToText.convert({
    file: { path },
    modelId: SCRIBE_MODEL,
    languageCode: lang,
    timestampsGranularity: "word",
    tagAudioEvents: false,
  });
  if (!("words" in res)) throw new Error("unexpected Scribe response (multichannel/webhook)");
  const words = res.words
    .filter((w) => w.type === "word" && w.start != null && w.end != null)
    .map((w) => ({ text: w.text, start: w.start!, end: w.end! }));
  return { text: res.text, words };
}

/** Group words into segments, splitting after .?! or at any gap over 0.8 s. Ids from 0. */
export function groupWords(words: Word[], maxGap = 0.8): Segment[] {
  const segs: Segment[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    segs.push({
      id: segs.length,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.text).join(" ").replace(/\s+([,.?!;:])/g, "$1"),
    });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > maxGap) flush();
    cur.push(w);
    if (/[.?!…]["»”']?$/.test(w.text)) flush();
  }
  flush();
  return segs;
}

export async function transcribe(path: string, lang: string): Promise<Segment[]> {
  const { words } = await transcribeWords(path, lang);
  return groupWords(words);
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

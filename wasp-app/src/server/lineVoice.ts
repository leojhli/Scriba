// A line read aloud by TTS, in the video's language, for lines whose timing can't be cut from
// the video (squeezed(): Scribe stamped the whole line at one moment, so the clip is a sliver).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HttpError } from "wasp/server";
import type { ExtLineVoice } from "wasp/server/api";
import type { GetLineVoice } from "wasp/server/operations";
import { checkDemoKey } from "./demoKey";
import { speakIn } from "./eleven";
import { ttsLanguage } from "./explain";
import { videoDir } from "./paths";
import { getVideo, videoLanguage } from "./videos";

type Input = { videoId?: string; segmentId?: number };
type Output = { audioUrl: string };

const inFlight = new Map<string, Promise<string>>();

/** /media URL of the line spoken by TTS, made once per line (the file name carries a hash of its text). */
async function lineVoice({ videoId, segmentId }: Input): Promise<string | null> {
  if (!videoId || typeof segmentId !== "number") return null;
  const seg = (await getVideo(videoId))?.segments?.find((s) => s.id === segmentId);
  if (!seg?.text.trim()) return null;
  const hash = createHash("sha1").update(seg.text).digest("hex").slice(0, 8);
  const name = `line-${segmentId}-${hash}.mp3`;
  const url = `/media/${videoId}/${name}`;
  const file = path.join(videoDir(videoId), name);
  if (fs.existsSync(file)) return url;
  let job = inFlight.get(file);
  if (!job) {
    const t0 = Date.now();
    job = speakIn(seg.text, ttsLanguage(undefined, videoLanguage(videoId)), file)
      .then(() => {
        console.log(`[line-voice] ${videoId}#${segmentId} in ${Date.now() - t0}ms`);
        return url;
      })
      .finally(() => inFlight.delete(file));
    inFlight.set(file, job);
  }
  return job;
}

/** POST /ext/line-voice { videoId, segmentId } → { audioUrl } (the scroll's play buttons). */
export const extLineVoice: ExtLineVoice = async (req, res) => {
  if (!checkDemoKey(req, res)) return;
  try {
    const audioUrl = await lineVoice((req.body ?? {}) as Input);
    if (!audioUrl) res.status(404).json({ error: "unknown line" });
    else res.json({ audioUrl } satisfies Output);
  } catch (e) {
    console.error("[line-voice] failed", e);
    res.status(502).json({ error: String(e) });
  }
};

/** The same for /deck and /practice (a Wasp query, so no demo key in the page). */
export const getLineVoice: GetLineVoice<Input, Output> = async (args) => {
  let audioUrl: string | null;
  try {
    audioUrl = await lineVoice(args ?? {});
  } catch (e) {
    console.error("[line-voice] failed", e);
    throw new HttpError(502, "Couldn't read that line aloud right now");
  }
  if (!audioUrl) throw new HttpError(404, "unknown line");
  return { audioUrl };
};

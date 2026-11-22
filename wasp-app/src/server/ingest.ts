import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "wasp/server";
import type { ExtSession } from "wasp/server/api";
import { LANGUAGE } from "../shared/config";
import { checkDemoKey } from "./demoKey";
import { isolate, transcribe } from "./eleven";
import { videoDir, writeJson } from "./paths";
import { getVideo } from "./videos";

const run = promisify(execFile);

function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const local = path.join(os.homedir(), ".local/bin/ffmpeg");
  return fs.existsSync(local) ? local : "ffmpeg";
}
// Prefer the up-to-date standalone build in ~/.local/bin (the Homebrew one was too old for YouTube).
const YTDLP =
  process.env.YTDLP_PATH ??
  (fs.existsSync(path.join(os.homedir(), ".local/bin/yt-dlp")) ? path.join(os.homedir(), ".local/bin/yt-dlp") : "yt-dlp");

const running = new Set<string>();

/** POST /ext/session { videoId, title } → { status, segments, hasDialogue }. Starts ingest on first call. */
export const extSession: ExtSession = async (req, res) => {
  if (!checkDemoKey(req, res)) return;
  const { videoId, title } = (req.body ?? {}) as { videoId?: string; title?: string };
  if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    res.status(400).json({ error: "videoId required" });
    return;
  }

  let video = await getVideo(videoId);
  if (!video) {
    await prisma.video.create({
      data: { id: videoId, title: title || videoId, status: "processing", hasDialogue: false },
    });
    video = await getVideo(videoId);
    void startIngest(videoId);
  } else if (video.status !== "ready" && !running.has(videoId)) {
    // Retry a failed ingest (e.g. after keys were added) or one orphaned by a server restart.
    await prisma.video.update({ where: { id: videoId }, data: { status: "processing" } });
    video = { ...video, status: "processing" };
    void startIngest(videoId);
  }

  res.json({ status: video!.status, segments: video!.segments, hasDialogue: video!.hasDialogue });
};

async function startIngest(videoId: string): Promise<void> {
  if (running.has(videoId)) return;
  running.add(videoId);
  const t0 = Date.now();
  try {
    await ingest(videoId);
    console.log(`[ingest] ${videoId} ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    console.error(`[ingest] ${videoId} failed`, e);
    await prisma.video.update({ where: { id: videoId }, data: { status: "failed" } }).catch(() => {});
  } finally {
    running.delete(videoId);
  }
}

/** yt-dlp (first 3 min) → ffmpeg audio.mp3 → Scribe + Voice Isolator in parallel → ready. */
export async function ingest(videoId: string): Promise<void> {
  const dir = videoDir(videoId);
  const ffmpeg = ffmpegPath();

  for (const f of fs.readdirSync(dir)) if (f.startsWith("source.")) fs.rmSync(path.join(dir, f));
  await run(
    YTDLP,
    [
      "--no-playlist",
      "--force-overwrites",
      "--quiet",
      "--no-warnings",
      // yt-dlp needs a JS runtime for YouTube; reuse the Node running this server.
      "--js-runtimes",
      `node:${process.execPath}`,
      "--ffmpeg-location",
      ffmpeg,
      "--download-sections",
      "*0:00-3:00",
      "-f",
      "mp4[height<=360]/best[height<=360]/bestaudio",
      "-o",
      path.join(dir, "source.%(ext)s"),
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { timeout: 180_000 },
  );
  const source = fs.readdirSync(dir).find((f) => f.startsWith("source."));
  if (!source) throw new Error("yt-dlp produced no file");

  const audio = path.join(dir, "audio.mp3");
  await run(ffmpeg, ["-y", "-loglevel", "error", "-i", path.join(dir, source), "-vn", "-ac", "1", "-ar", "44100", "-b:a", "128k", audio], {
    timeout: 120_000,
  });

  const [segments, dialogue] = await Promise.all([
    transcribe(audio, LANGUAGE),
    isolate(audio, path.join(dir, "dialogue.mp3")),
  ]);

  const data = { status: "ready", hasDialogue: dialogue !== null, segments: JSON.stringify(segments) };
  const v = await prisma.video.update({ where: { id: videoId }, data });
  // Snapshot for demo-cache/ (Task 8): copy data/{id} there and `wasp db seed` reloads it.
  writeJson(path.join(dir, "video.json"), { id: v.id, title: v.title, hasDialogue: v.hasDialogue, segments });
  console.log(`[ingest] ${videoId}: ${segments.length} segments, dialogue=${data.hasDialogue}`);
}

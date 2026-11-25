import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "wasp/server";
import type { ExtSession } from "wasp/server/api";
import { checkDemoKey } from "./demoKey";
import { isolate, transcribe } from "./eleven";
import { videoDir, writeJson } from "./paths";
import { getVideo } from "./videos";

const run = promisify(execFile);

/** A full path to ffmpeg when we know one, else the bare name "ffmpeg", which is looked up on PATH. */
export function ffmpegPath(): string {
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
    await prisma.video.update({ where: { id: videoId }, data: { status: "processing", segments: null } });
    video = { ...video, status: "processing", segments: null };
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
    console.log(`[ingest] ${videoId} done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    console.error(`[ingest] ${videoId} failed`, e);
    await prisma.video.update({ where: { id: videoId }, data: { status: "failed" } }).catch(() => {});
  } finally {
    running.delete(videoId);
  }
}

/**
 * yt-dlp (first 3 min) → audio track → Scribe → ready. Voice Isolator runs alongside and
 * flips hasDialogue when it finishes, so pausing works as soon as the transcript exists.
 */
export async function ingest(videoId: string): Promise<void> {
  const dir = videoDir(videoId);
  const ffmpeg = ffmpegPath();
  const t0 = Date.now();
  const lap = (() => {
    let last = t0;
    return () => {
      const now = Date.now();
      const ms = now - last;
      last = now;
      return `${(ms / 1000).toFixed(1)}s`;
    };
  })();

  // A fresh ingest renumbers the lines, so drop anything keyed by the old line ids.
  for (const f of fs.readdirSync(dir))
    if (f.startsWith("source.") || f.startsWith("explain-") || f === "translations.json" || f === "audio.mp3")
      fs.rmSync(path.join(dir, f));
  const { stdout } = await run(
    YTDLP,
    [
      "--no-playlist",
      "--force-overwrites",
      "--quiet",
      "--no-warnings",
      // yt-dlp needs a JS runtime for YouTube; reuse the Node running this server.
      "--js-runtimes",
      `node:${process.execPath}`,
      // --ffmpeg-location takes a path. Given the bare name (ffmpeg installed on PATH, e.g. with
      // apt on Linux/WSL), yt-dlp says "ffmpeg is not installed", so leave it to yt-dlp's PATH search.
      ...(path.basename(ffmpeg) === ffmpeg ? [] : ["--ffmpeg-location", ffmpeg]),
      "--download-sections",
      "*0:00-3:00",
      // The page title can be stale right after YouTube's in-app navigation, so take it from yt-dlp.
      "--print",
      "after_move:title",
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
  const tDownload = lap();

  // Copy the AAC track out of the mp4 (instant); only re-encode if the source isn't AAC.
  const audio = path.join(dir, "audio.m4a");
  const copy = /\.(mp4|m4a)$/.test(source) ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "128k"];
  await run(ffmpeg, ["-y", "-loglevel", "error", "-i", path.join(dir, source), "-vn", ...copy, audio], { timeout: 120_000 });
  const tAudio = lap();

  const isolating = isolate(audio, path.join(dir, "dialogue.mp3"));
  const { segments, language } = await transcribe(audio); // language auto-detected per video
  const tScribe = lap();

  const title = stdout.trim().split("\n").pop()?.trim();
  const v = await prisma.video.update({
    where: { id: videoId },
    data: { status: "ready", hasDialogue: false, segments: JSON.stringify(segments), ...(title ? { title } : {}) },
  });
  // Snapshot for demo-cache/ (Task 8): copy data/{id} there and `wasp db seed` reloads it.
  const snapshot = (hasDialogue: boolean) =>
    writeJson(path.join(dir, "video.json"), { id: v.id, title: v.title, language, hasDialogue, segments });
  snapshot(false);
  console.log(
    `[ingest] ${videoId} READY in ${((Date.now() - t0) / 1000).toFixed(1)}s (download ${tDownload}, audio ${tAudio}, scribe ${tScribe}): ${segments.length} segments, language=${language}`,
  );

  const dialogue = await isolating;
  if (dialogue) {
    await prisma.video.update({ where: { id: videoId }, data: { hasDialogue: true } });
    snapshot(true);
  }
  console.log(`[ingest] ${videoId} dialogue=${dialogue !== null} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

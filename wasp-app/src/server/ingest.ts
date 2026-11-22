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

  // A fresh ingest renumbers the lines, so drop anything keyed by the old line ids.
  for (const f of fs.readdirSync(dir))
    if (f.startsWith("source.") || f.startsWith("explain-") || f === "translations.json") fs.rmSync(path.join(dir, f));
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
      "--ffmpeg-location",
      ffmpeg,
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

  const audio = path.join(dir, "audio.mp3");
  await run(ffmpeg, ["-y", "-loglevel", "error", "-i", path.join(dir, source), "-vn", "-ac", "1", "-ar", "44100", "-b:a", "128k", audio], {
    timeout: 120_000,
  });

  const [{ segments, language }, dialogue] = await Promise.all([
    transcribe(audio), // language auto-detected per video
    isolate(audio, path.join(dir, "dialogue.mp3")),
  ]);

  const title = stdout.trim().split("\n").pop()?.trim();
  const data = {
    status: "ready",
    hasDialogue: dialogue !== null,
    segments: JSON.stringify(segments),
    ...(title ? { title } : {}),
  };
  const v = await prisma.video.update({ where: { id: videoId }, data });
  // Snapshot for demo-cache/ (Task 8): copy data/{id} there and `wasp db seed` reloads it.
  writeJson(path.join(dir, "video.json"), { id: v.id, title: v.title, language, hasDialogue: v.hasDialogue, segments });
  console.log(`[ingest] ${videoId}: ${segments.length} segments, language=${language}, dialogue=${data.hasDialogue}`);
}

import path from "node:path";
import { prisma } from "wasp/server";
import type { Segment } from "../shared/types";
import { DATA_DIR, readJson } from "./paths";

/** Language Scribe detected at ingest (e.g. "spa", "cmn"), or null if unknown. */
export function videoLanguage(videoId: string): string | null {
  return readJson<{ language?: string | null }>(path.join(DATA_DIR, videoId, "video.json"), {}).language ?? null;
}

export type VideoStatus = "processing" | "ready" | "failed";
export type VideoInfo = {
  id: string;
  title: string;
  status: VideoStatus;
  hasDialogue: boolean;
  segments: Segment[] | null;
};

export async function getVideo(videoId: string): Promise<VideoInfo | null> {
  const v = await prisma.video.findUnique({ where: { id: videoId } });
  if (!v) return null;
  return {
    id: v.id,
    title: v.title,
    status: v.status as VideoStatus,
    hasDialogue: v.hasDialogue,
    segments: v.segments ? (JSON.parse(v.segments) as Segment[]) : null,
  };
}

/** Per-segment translations/notes that /ext/explain has produced, used by /deck and /practice. */
export type TranslationMap = Record<string, { translation: string; notes: string[] }>;

export function translationsFile(videoId: string): string {
  return path.join(DATA_DIR, videoId, "translations.json");
}

export function readTranslations(videoId: string): TranslationMap {
  return readJson<TranslationMap>(translationsFile(videoId), {});
}

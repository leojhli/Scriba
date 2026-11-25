import fs from "node:fs";
import path from "node:path";
import { HttpError } from "wasp/server";
import type { DeleteCard, GetDeck, SubmitShadow } from "wasp/server/operations";
import type { ShadowResult } from "../shared/types";
import { getDemoUserId } from "./demoUser";
import { scoreAttempt, type ShadowInput } from "./shadow";
import { DATA_DIR } from "./paths";
import { getVideo, readTranslations } from "./videos";

export type DeckCard = {
  videoId: string;
  videoTitle: string;
  segmentId: number;
  text: string;
  /** Latin-letter reading for non-Latin scripts (pinyin, romaji…), else "". */
  romanization: string;
  start: number;
  end: number;
  /** Scribe's word timings (newer ingests), so a tapped word can be cut from the dialogue track. */
  words?: { text: string; start: number; end: number }[];
  translation: string;
  notes: string[];
  pauses: number;
  bestAccuracy: number | null;
  hasDialogue: boolean;
  /** Audio for /practice: the dialogue track, else the plain audio track. */
  audioFile: string;
};

/** The demo user's pauses grouped by line, ranked by how often they paused there. */
export const getDeck: GetDeck<void, DeckCard[]> = async (_args, context) => {
  const userId = await getDemoUserId();
  const moments = await context.entities.Moment.findMany({ where: { userId, segmentId: { gte: 0 } } });
  const attempts = await context.entities.ShadowAttempt.findMany({ where: { userId } });

  const groups = new Map<string, { videoId: string; segmentId: number; pauses: number; last: number }>();
  for (const m of moments) {
    const key = `${m.videoId}:${m.segmentId}`;
    const g = groups.get(key) ?? { videoId: m.videoId, segmentId: m.segmentId, pauses: 0, last: 0 };
    g.pauses += 1;
    g.last = Math.max(g.last, m.createdAt.getTime());
    groups.set(key, g);
  }

  const cards: DeckCard[] = [];
  for (const g of groups.values()) {
    const video = await getVideo(g.videoId);
    const seg = video?.segments?.find((s) => s.id === g.segmentId);
    if (!video || !seg) continue;
    const tr = readTranslations(g.videoId)[g.segmentId];
    const best = attempts
      .filter((a) => a.videoId === g.videoId && a.segmentId === g.segmentId)
      .reduce<number | null>((b, a) => (b === null || a.accuracy > b ? a.accuracy : b), null);
    cards.push({
      videoId: g.videoId,
      videoTitle: video.title,
      segmentId: g.segmentId,
      text: seg.text,
      romanization: tr?.romanization ?? "",
      start: seg.start,
      end: seg.end,
      ...(seg.words?.length ? { words: seg.words } : {}),
      translation: tr?.translation ?? "",
      notes: tr?.notes ?? [],
      pauses: g.pauses,
      bestAccuracy: best,
      hasDialogue: video.hasDialogue,
      audioFile: video.hasDialogue
        ? "dialogue.mp3"
        : fs.existsSync(path.join(DATA_DIR, g.videoId, "audio.m4a"))
          ? "audio.m4a"
          : "audio.mp3",
    });
  }
  const last = new Map([...groups.values()].map((g) => [`${g.videoId}:${g.segmentId}`, g.last]));
  // Most-paused first; ties go to the most recent.
  return cards.sort(
    (a, b) => b.pauses - a.pauses || (last.get(`${b.videoId}:${b.segmentId}`) ?? 0) - (last.get(`${a.videoId}:${a.segmentId}`) ?? 0),
  );
};

export type DeleteCardInput = { videoId: string; segmentId: number };

/**
 * The × on a deck card: forget that line. A card is the demo user's pauses on one line, so
 * deleting its Moments removes it; its practice attempts go too, so a later pause on the same
 * line starts a fresh card instead of bringing back the old best score.
 */
export const deleteCard: DeleteCard<DeleteCardInput, { deleted: number }> = async (args, context) => {
  const { videoId, segmentId } = (args ?? {}) as Partial<DeleteCardInput>;
  if (typeof videoId !== "string" || !videoId || !Number.isInteger(segmentId)) {
    throw new HttpError(400, "videoId and segmentId are required");
  }
  const where = { userId: await getDemoUserId(), videoId, segmentId: segmentId as number };
  const { count } = await context.entities.Moment.deleteMany({ where });
  await context.entities.ShadowAttempt.deleteMany({ where });
  return { deleted: count };
};

/** Shadowing from /practice: same scoring path as /ext/shadow. */
export const submitShadow: SubmitShadow<ShadowInput, ShadowResult & { heard: string }> = async (args) => {
  return scoreAttempt(args, await getDemoUserId());
};

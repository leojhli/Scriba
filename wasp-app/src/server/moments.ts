import { prisma } from "wasp/server";
import { segmentAt } from "../shared/window";
import { getDemoUserId } from "./demoUser";
import { getVideo } from "./videos";

/** Segment under t, or -1 while the transcript isn't ready. */
export async function segmentIdAt(videoId: string, t: number): Promise<number> {
  const v = await getVideo(videoId);
  return v?.segments ? (segmentAt(v.segments, t)?.id ?? -1) : -1;
}

/** Every pause on a line becomes a Moment; the deck ranks lines by how often you paused on them. */
export async function recordPause(videoId: string, t: number): Promise<number> {
  const segmentId = await segmentIdAt(videoId, t);
  await prisma.moment.create({
    data: { userId: await getDemoUserId(), videoId, segmentId, kind: "pause", weight: 1 },
  });
  return segmentId;
}

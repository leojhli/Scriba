import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { Segment } from "../shared/types";
import { DATA_DIR, DEMO_CACHE_DIR } from "./paths";

type CachedVideo = { id: string; title: string; hasDialogue: boolean; segments: Segment[] };

/**
 * `wasp db seed`: copies demo-cache/{videoId}/ into data/ and upserts the Video rows
 * as ready, so the demo videos work with no network (Task 8).
 */
export async function seedDemoCache(prisma: PrismaClient): Promise<void> {
  if (!fs.existsSync(DEMO_CACHE_DIR)) {
    console.log(`[seed] no ${DEMO_CACHE_DIR}, nothing to load`);
    return;
  }
  for (const id of fs.readdirSync(DEMO_CACHE_DIR)) {
    const src = path.join(DEMO_CACHE_DIR, id);
    const meta = path.join(src, "video.json");
    if (!fs.existsSync(meta)) continue;
    const v = JSON.parse(fs.readFileSync(meta, "utf8")) as CachedVideo;
    fs.cpSync(src, path.join(DATA_DIR, id), { recursive: true });
    const data = { title: v.title, status: "ready", hasDialogue: v.hasDialogue, segments: JSON.stringify(v.segments) };
    await prisma.video.upsert({ where: { id: v.id }, update: data, create: { id: v.id, ...data } });
    console.log(`[seed] loaded ${v.id} (${v.segments.length} segments) "${v.title}"`);
  }
  if (!(await prisma.user.findFirst())) await prisma.user.create({ data: {} });
}

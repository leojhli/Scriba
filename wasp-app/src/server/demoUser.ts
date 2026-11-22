import { prisma } from "wasp/server";

let cached: number | null = null;

/** DEMO_KEY maps every extension request to one user: the first User row (created if none). */
export async function getDemoUserId(): Promise<number> {
  if (cached !== null) return cached;
  const first = await prisma.user.findFirst({ orderBy: { id: "asc" } });
  cached = (first ?? (await prisma.user.create({ data: {} }))).id;
  return cached;
}

import type { PlayerEvent, Struggle } from "./types";

export const WEIGHTS = { pause: 1, rewind: 2, replay: 3, captions: 1, slowdown: 1 } as const;

const REWIND_MIN_S = 2;
const REWIND_MAX_S = 30;
const REPLAY_SAME_SPOT_S = 5;
const REPLAY_WALL_MS = 60_000;

/**
 * Pure: turns a list of player events into struggle signals.
 * - pause: any pause
 * - rewind: a backward seek of 2–30 s (forward seeks, skips and big jumps don't count)
 * - replay: a rewind landing within 5 s of an earlier rewind, within 60 s of wall time
 * - captions: captions turned on
 * - slowdown: playback rate set below 1
 */
export function detectStruggles(events: PlayerEvent[]): Struggle[] {
  const out: Struggle[] = [];
  const rewinds: { t: number; at: number }[] = [];

  for (const e of events) {
    switch (e.type) {
      case "pause":
        out.push({ kind: "pause", t: e.t, weight: WEIGHTS.pause });
        break;
      case "seek": {
        const back = e.from - e.t;
        if (back < REWIND_MIN_S || back > REWIND_MAX_S) break;
        const isReplay = rewinds.some(
          (r) => Math.abs(r.t - e.t) <= REPLAY_SAME_SPOT_S && e.at - r.at <= REPLAY_WALL_MS,
        );
        out.push(
          isReplay
            ? { kind: "replay", t: e.t, weight: WEIGHTS.replay }
            : { kind: "rewind", t: e.t, weight: WEIGHTS.rewind },
        );
        rewinds.push({ t: e.t, at: e.at });
        break;
      }
      case "captions":
        if (e.on) out.push({ kind: "captions", t: e.t, weight: WEIGHTS.captions });
        break;
      case "rate":
        if (e.value < 1) out.push({ kind: "slowdown", t: e.t, weight: WEIGHTS.slowdown });
        break;
    }
  }
  return out;
}

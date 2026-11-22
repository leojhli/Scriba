// Keep identical to extension/src/shared/window.ts.
import type { Segment } from "./types";

/**
 * Lines that overlap the last `span` seconds before t, including a line still
 * being said at t. Import as `{ window as segWindow }` to avoid shadowing the global.
 */
export function window<S extends { start: number; end: number }>(segments: S[], t: number, span = 15): S[] {
  return segments.filter((s) => s.start <= t && s.end >= t - span);
}

/** The segment being said at t, else the last one before t, else null. */
export function segmentAt(segments: Segment[], t: number): Segment | null {
  let best: Segment | null = null;
  for (const s of segments) {
    if (s.start <= t) best = s;
    if (s.start <= t && s.end >= t) return s;
  }
  return best;
}

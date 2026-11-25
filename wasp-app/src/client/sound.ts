// One sound at a time on the study pages: a line's clip, a tapped word, or a word cut out of the
// dialogue track. Starting one stops whatever was playing.

let current: HTMLAudioElement | null = null;
let frame = 0;

export function stopSound(): void {
  cancelAnimationFrame(frame);
  current?.pause();
  current = null;
}

/** Plays `url`, optionally only from `from` to `to` (seconds) and at `rate` (pitch kept). */
export function playSound(url: string, opts: { from?: number; to?: number; rate?: number } = {}): void {
  stopSound();
  const { from, to, rate = 1 } = opts;
  const a = new Audio(url);
  current = a;
  a.preservesPitch = true;
  a.addEventListener(
    "loadedmetadata",
    () => {
      if (current !== a) return;
      if (from !== undefined) a.currentTime = Math.max(0, from);
      a.defaultPlaybackRate = a.playbackRate = rate;
      a.play().catch(() => {});
    },
    { once: true },
  );
  if (to === undefined) return;
  // Checked every frame: timeupdate fires only ~4 times a second, too coarse for a single word.
  const tick = () => {
    if (current !== a) return;
    if (a.currentTime >= to) {
      a.pause();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  a.addEventListener("playing", () => current === a && (frame = requestAnimationFrame(tick)), { once: true });
}

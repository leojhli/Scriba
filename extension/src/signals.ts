// Pause → explain, play → hide. That's the only player activity the extension listens to.

export function isAdShowing(): boolean {
  return !!document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting");
}

/**
 * Listens at document level in the capture phase (media events don't bubble), so it
 * survives YouTube swapping the <video> element. Ads are ignored.
 */
export function watchPlayback(handlers: { onPause(v: HTMLVideoElement): void; onPlay(v: HTMLVideoElement): void }): void {
  const on = (type: "pause" | "play", fn: (v: HTMLVideoElement) => void) =>
    document.addEventListener(
      type,
      (ev) => {
        if (ev.target instanceof HTMLVideoElement && ev.target.closest("#movie_player") && !isAdShowing()) fn(ev.target);
      },
      true,
    );
  on("pause", handlers.onPause);
  on("play", handlers.onPlay);
}

// Pause → explain, play → hide. That's the only player activity the extension listens to.
// Ads are off-limits: no explanations, no caption reading, and the overlay is hidden.

/** True while YouTube is playing an ad (pre-roll, mid-roll or an ad break). */
export function isAdShowing(): boolean {
  const p = document.querySelector("#movie_player");
  if (!p) return false;
  return (
    p.classList.contains("ad-showing") ||
    p.classList.contains("ad-interrupting") ||
    !!p.querySelector(".ytp-ad-player-overlay, .ytp-ad-player-overlay-layout")
  );
}

/**
 * Listens at document level in the capture phase (media events don't bubble), so it
 * survives YouTube swapping the <video> element. A pause during an ad is ignored, but
 * play always fires: pressing play is also how a mid-roll ad starts, and the panel and
 * voice must go away then too.
 */
export function watchPlayback(handlers: { onPause(v: HTMLVideoElement): void; onPlay(v: HTMLVideoElement): void }): void {
  const on = (type: "pause" | "play", fn: (v: HTMLVideoElement) => void) =>
    document.addEventListener(
      type,
      (ev) => {
        if (ev.target instanceof HTMLVideoElement && ev.target.closest("#movie_player")) fn(ev.target);
      },
      true,
    );
  on("pause", (v) => {
    if (!isAdShowing()) handlers.onPause(v);
  });
  on("play", handlers.onPlay);
}

/** Calls onChange(true) when an ad starts and onChange(false) when it ends. */
export function watchAds(onChange: (ad: boolean) => void): void {
  // Start from "no ad" so a pre-roll that is already playing when the page loads is caught too.
  let last = false;
  const check = () => {
    const now = isAdShowing();
    if (now !== last) {
      last = now;
      onChange(now);
    }
  };
  // YouTube toggles classes on #movie_player for ads; the player element can be replaced
  // on navigation, so re-attach when it changes. The interval doubles as a fallback check.
  const observer = new MutationObserver(check);
  let observed: Element | null = null;
  setInterval(() => {
    const p = document.querySelector("#movie_player");
    if (p && p !== observed) {
      observer.disconnect();
      observed = p;
      observer.observe(p, { attributes: true, attributeFilter: ["class"] });
    }
    check();
  }, 500);
}

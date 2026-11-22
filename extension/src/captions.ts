// Reads YouTube's on-screen captions into a rolling buffer of { text, start, end } (Task 3).
import { CAPTION_KEEP_S } from "./shared/config";
import { isAdShowing } from "./signals";

export type CaptionLine = { text: string; start: number; end: number };

export class CaptionBuffer {
  lines: CaptionLine[] = [];
  private current: CaptionLine | null = null;
  private observer: MutationObserver | null = null;
  private container: Element | null = null;

  start(): void {
    // The caption container is created lazily and replaced on navigation, so re-attach.
    setInterval(() => this.attach(), 1000);
    this.attach();
  }

  reset(): void {
    this.lines = [];
    this.current = null;
  }

  private attach(): void {
    const c = document.querySelector("#movie_player .ytp-caption-window-container");
    if (!c || c === this.container) return;
    this.observer?.disconnect();
    this.container = c;
    this.observer = new MutationObserver(() => this.read());
    this.observer.observe(c, { childList: true, subtree: true, characterData: true });
  }

  private read(): void {
    // Ads have their own captions and their own clock: never mix them into the lines.
    if (isAdShowing()) {
      this.current = null;
      return;
    }
    const video = document.querySelector<HTMLVideoElement>("#movie_player video");
    if (!video) return;
    const t = video.currentTime;
    const text = [...(this.container?.querySelectorAll(".ytp-caption-segment") ?? [])]
      .map((s) => s.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      if (this.current) this.current.end = t;
      this.current = null;
      return;
    }
    if (this.current && text === this.current.text) {
      this.current.end = t;
      return;
    }
    if (this.current && text.startsWith(this.current.text)) {
      // Auto-captions grow word by word: same line, longer text.
      this.current.text = text;
      this.current.end = t;
      return;
    }
    if (this.current) this.current.end = t;
    // After a rewind the same line shows again: reuse it instead of duplicating.
    const again = this.lines.find((l) => l.text === text && Math.abs(l.start - t) < 3);
    if (again) {
      this.current = again;
      return;
    }
    this.current = { text, start: t, end: t };
    this.lines.push(this.current);
    this.lines.sort((a, b) => a.start - b.start);
    this.lines = this.lines.filter((l) => Math.abs(t - l.start) <= CAPTION_KEEP_S);
  }

  /** Lines ending up to now, with the still-open line closed at t. */
  snapshot(t: number): CaptionLine[] {
    return this.lines.map((l) => (l === this.current ? { ...l, end: Math.max(l.end, t) } : { ...l }));
  }
}

// Shared contract between the extension and the Wasp app.
// Keep identical to extension/src/shared/types.ts.

export type Segment = { id: number; start: number; end: number; text: string };

export type Explanation = {
  summary: string;
  audioUrl: string | null;
  lines: {
    segmentId: number;
    original: string;
    /** The line in Latin letters (pinyin, romaji, Revised Romanization…); only for non-Latin scripts. */
    romanization?: string;
    translation: string;
    notes: string[];
  }[];
  /** Set when this came from a cache because the server or an API was down (Task 8). */
  offline?: boolean;
  /**
   * The voice arrived first: `summary` and `audioUrl` are final, but the lines' translations and
   * notes are still being written. POST /ext/explain-rest { videoId, t } returns the full one.
   */
  partial?: boolean;
};

export type ShadowResult = {
  diff: { word: string; status: "ok" | "missed" | "wrong" | "extra" }[];
  accuracy: number;
  paceRatio: number;
};

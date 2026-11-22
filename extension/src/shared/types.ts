// Shared contract between the extension and the Wasp app.
// Keep identical to wasp-app/src/shared/types.ts.

export type Segment = { id: number; start: number; end: number; text: string };

export type Explanation = {
  summary: string;
  audioUrl: string | null;
  lines: { segmentId: number; original: string; translation: string; notes: string[] }[];
  /** Set when this came from a cache because the server or an API was down (Task 8). */
  offline?: boolean;
};

export type ShadowResult = {
  diff: { word: string; status: "ok" | "missed" | "wrong" | "extra" }[];
  accuracy: number;
  paceRatio: number;
};

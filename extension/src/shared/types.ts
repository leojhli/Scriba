// Shared contract between the extension and the Wasp app.
// Keep identical to wasp-app/src/shared/types.ts.

export type Segment = { id: number; start: number; end: number; text: string };

export type PlayerEvent =
  | { type: "pause" | "play"; t: number; at: number }
  | { type: "seek"; from: number; t: number; at: number }
  | { type: "rate"; t: number; value: number; at: number }
  | { type: "captions"; t: number; on: boolean; at: number }; // t = video seconds, at = Date.now()

export type StruggleKind = "pause" | "rewind" | "replay" | "captions" | "slowdown";

export type Struggle = { kind: StruggleKind; t: number; weight: number };

export type Explanation = {
  summary: string;
  audioUrl: string | null;
  lines: { segmentId: number; original: string; translation: string; notes: string[] }[];
};

export type ShadowResult = {
  diff: { word: string; status: "ok" | "missed" | "wrong" | "extra" }[];
  accuracy: number;
  paceRatio: number;
};

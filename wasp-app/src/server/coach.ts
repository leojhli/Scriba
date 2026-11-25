// One coaching tip for a shadowing take, from Claude. Claude can't hear the recording: it gets
// the line, what Scribe (or Azure) heard, and each word's status and clarity, and infers the most
// likely sound to fix (e.g. "perro" heard as "pero" → the rolled rr).
import Anthropic from "@anthropic-ai/sdk";
import type { tipInput } from "../shared/clarity";

// Same model and settings as /ext/explain and /ext/word (known to work).
const MODEL = process.env.CLAUDE_COACH_MODEL ?? process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5";
/** The score is shown either way; a tip that takes longer than this is dropped. */
const TIMEOUT_MS = 6_000;

const SYSTEM = `You are a friendly pronunciation coach. A language learner just tried to repeat a line from a video out loud. You can't hear the recording. You get:
- "line": what they were trying to say;
- "heard": what a speech recogniser transcribed from their recording;
- "words": each word of the line with its status: "ok", "missed" (not heard), "wrong" (heard as a different word), "extra" (said but not in the line), and for "ok" words a "clarity" (how sure the recogniser was, 0–100; under 70 means it was hard to make out) or a "pronunciation" score.

Infer the single most useful thing to fix, from how the words came out: a word heard as a similar one points at the sound that differs (e.g. «perro» heard as «pero» → the rolled rr; «casa» heard as «caza» → the s), an unclear word at its hardest sound, a missed word at linking or speed. Reply only with JSON:
- "tip": one or two short sentences (35 words at most) in English, talking to the learner directly: name the word, say what it came out as if it did, and say how to make the sound (tongue, lips, length, tone). Quote words from the line in its own script inside «guillemets». For Chinese or Japanese, add the reading in brackets after the word, e.g. «难追» (nán zhuī). Never claim to have heard them: say "it came out as…", not "I heard…". If everything looks fine, say what to keep doing.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tip"],
  properties: { tip: { type: "string" } },
} as const;

let anthropic: Anthropic | null = null;
function claude(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set in .env.server");
  return (anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: TIMEOUT_MS }));
}

/** The tip, or null if Claude is unavailable, slow or declines (the score is shown without it). */
export async function coachTip(input: ReturnType<typeof tipInput>): Promise<string | null> {
  const t0 = Date.now();
  try {
    const msg = await claude().beta.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
      thinking: { type: "between_tools" }, // no thinking: latency-bound
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: JSON.stringify(input) }],
    });
    if (msg.stop_reason === "refusal") return null;
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const tip = (JSON.parse(text) as { tip?: string }).tip?.trim();
    console.log(`[shadow] tip in ${Date.now() - t0}ms`);
    return tip || null;
  } catch (e) {
    console.error(`[shadow] no tip (${Date.now() - t0}ms)`, String(e).slice(0, 200));
    return null;
  }
}

import { describe, expect, it } from "vitest";
import { displaySummary, speechParts } from "./text";

const en = (text: string) => ({ text, foreign: false });
const fx = (text: string) => ({ text, foreign: true });

describe("speechParts", () => {
  it("keeps an all-English summary as one part", () => {
    expect(speechParts("They're teasing their friend here.")).toEqual([en("They're teasing their friend here.")]);
  });

  it("splits out quotes marked with guillemets (Latin-script languages)", () => {
    expect(speechParts("They say «¿qué onda, güey?», a casual way of asking what's up.")).toEqual([
      en("They say"),
      fx("¿qué onda, güey?"),
      en(", a casual way of asking what's up."),
    ]);
  });

  it("splits out non-Latin script even when the model forgot the marks", () => {
    expect(speechParts("The key phrase is 难追, hard to chase.")).toEqual([en("The key phrase is"), fx("难追"), en(", hard to chase.")]);
  });

  it("drops romanization in parentheses, which the voice would anglicize", () => {
    expect(speechParts("The key phrase is «难追» (nán zhuī), hard to chase.")).toEqual([
      en("The key phrase is"),
      fx("难追"),
      en(", hard to chase."),
    ]);
  });

  it("keeps a multi-word Japanese or Korean quote together", () => {
    expect(speechParts("They whisper 사랑해 요 softly.")).toEqual([en("They whisper"), fx("사랑해 요"), en("softly.")]);
  });

  it("folds punctuation-only leftovers into the previous part", () => {
    expect(speechParts("Listen to «vale».")).toEqual([en("Listen to"), fx("vale.")]);
  });
});

describe("displaySummary", () => {
  it("shows the marked quotes as ordinary quotes", () => {
    expect(displaySummary("They say «¿qué onda?», casually.")).toBe("They say “¿qué onda?”, casually.");
  });
});

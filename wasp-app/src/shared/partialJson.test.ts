import { describe, expect, it } from "vitest";
import { completedStrings } from "./partialJson";

describe("completedStrings", () => {
  it("returns nothing for an empty or barely started object", () => {
    expect(completedStrings("")).toEqual({});
    expect(completedStrings('{"lang')).toEqual({});
    expect(completedStrings('{"language": "e')).toEqual({});
  });

  it("returns top-level string fields once their closing quote has arrived", () => {
    expect(completedStrings('{"language": "es", "summary": "They\'re joki')).toEqual({ language: "es" });
    expect(completedStrings('{"language":"es","summary":"They\'re joking.","lines":[{"ind')).toEqual({
      language: "es",
      summary: "They're joking.",
    });
  });

  it("decodes escapes, including quotes and unicode", () => {
    const s = completedStrings(String.raw`{"summary": "The key phrase is \"«难追»\", hard to chase.\n¡Ya!"`);
    expect(s.summary).toBe("The key phrase is \"«难追»\", hard to chase.\n¡Ya!");
  });

  it("does not stop at an escaped quote", () => {
    expect(completedStrings(String.raw`{"summary": "say \"hola`)).toEqual({});
  });

  it("ignores string fields nested in arrays or objects", () => {
    const text = '{"lines":[{"index":0,"summary":"nested","translation":"x"}],"summary":"top';
    expect(completedStrings(text)).toEqual({});
    expect(completedStrings(text + '"')).toEqual({ summary: "top" });
  });

  it("ignores key-like text inside string values", () => {
    expect(completedStrings('{"notes_hint": "a \\"summary\\": \\"fake\\"", "summary": "real"}')).toEqual({
      notes_hint: 'a "summary": "fake"',
      summary: "real",
    });
  });

  it("skips non-string values", () => {
    expect(completedStrings('{"n": 3, "ok": true, "summary": "hi", "x": null}')).toEqual({ summary: "hi" });
  });
});

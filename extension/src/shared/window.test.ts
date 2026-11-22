import { describe, expect, it } from "vitest";
import { window as segWindow } from "./window";

const segs = [
  { id: 0, start: 2, end: 4, text: "a" },
  { id: 1, start: 6, end: 9, text: "b" },
  { id: 2, start: 18, end: 23, text: "c" },
];

describe("window", () => {
  it("returns lines that overlap the last 15 s", () => {
    expect(segWindow(segs, 20).map((s) => s.id)).toEqual([1, 2]);
  });
  it("includes a line still being said", () => {
    expect(segWindow(segs, 7).map((s) => s.id)).toEqual([0, 1]);
  });
  it("is empty before anything has been said", () => {
    expect(segWindow(segs, 1)).toEqual([]);
  });
  it("honours a custom span", () => {
    expect(segWindow(segs, 20, 3).map((s) => s.id)).toEqual([2]);
  });
});

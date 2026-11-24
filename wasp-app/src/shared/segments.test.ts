import { describe, expect, it } from "vitest";
import { groupWords } from "./segments";

const w = (text: string, start: number, end: number) => ({ text, start, end });

describe("groupWords", () => {
  it("splits Spanish at sentence ends", () => {
    const s = groupWords([w("Hola", 0, 0.3), w("amigo.", 0.4, 0.8), w("¿Qué", 1.0, 1.2), w("tal?", 1.3, 1.5)]);
    expect(s.map((x) => x.text)).toEqual(["Hola amigo.", "¿Qué tal?"]);
    expect(s.map((x) => x.id)).toEqual([0, 1]);
  });

  it("splits at a pause longer than 0.8 s", () => {
    expect(groupWords([w("a", 0, 0.2), w("b", 1.5, 1.7)]).map((x) => x.text)).toEqual(["a", "b"]);
  });

  it("joins Chinese without spaces and splits at 。", () => {
    const s = groupWords([w("你", 0, 0.2), w("好", 0.2, 0.4), w("。", 0.4, 0.4), w("我", 0.5, 0.7), w("姓", 0.7, 0.9), w("高", 0.9, 1.1), w("。", 1.1, 1.1)]);
    expect(s.map((x) => x.text)).toEqual(["你好。", "我姓高。"]);
  });

  it("breaks a long run-on line at a comma after 6 s", () => {
    const s = groupWords([w("唱", 0, 3), w("歌，", 3, 6.5), w("跳", 6.6, 7), w("舞，", 7, 7.5)]);
    expect(s.map((x) => x.text)).toEqual(["唱歌，", "跳舞，"]);
  });

  it("keeps each line's word timings", () => {
    const s = groupWords([w("Hola", 0, 0.3), w("amigo.", 0.4, 0.8)]);
    expect(s[0].words).toEqual([w("Hola", 0, 0.3), w("amigo.", 0.4, 0.8)]);
  });

  it("keeps a short line together across commas", () => {
    expect(groupWords([w("Hola,", 0, 0.5), w("amigo", 0.6, 1)]).map((x) => x.text)).toEqual(["Hola, amigo"]);
  });
});

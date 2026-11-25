import { describe, expect, it } from "vitest";
import { offScript } from "./script";

describe("offScript", () => {
  it("flags Chinese characters in a Korean transcript (the 国外 for 국외 case)", () => {
    expect(offScript("그 국내산이라고 썼는데 이게 보니까 国外 산이던데.", "kor")).toBe(true);
  });
  it("flags Japanese kana in a Korean transcript", () => {
    expect(offScript("이거 정말 すごい 맛있다", "kor")).toBe(true);
  });
  it("leaves a clean Korean transcript alone, English loanwords included", () => {
    expect(offScript("그 국내산이라고 썼는데 이게 보니까 국외 산이던데. OK, iPhone 15!", "kor")).toBe(false);
  });
  it("accepts ISO 639-1 codes too", () => {
    expect(offScript("国外", "ko")).toBe(true);
    expect(offScript("국외", "ko")).toBe(false);
  });
  it("allows kanji and kana in Japanese, but not Hangul", () => {
    expect(offScript("東京に行きたいです。カフェで会おう", "jpn")).toBe(false);
    expect(offScript("東京に行きたい 사랑해", "jpn")).toBe(true);
  });
  it("allows Han in Chinese (any code Scribe uses), but not Hangul or kana", () => {
    expect(offScript("这么多年过去了，我用 iPhone 拍的", "cmn")).toBe(false);
    expect(offScript("这么多年过去了", "zho")).toBe(false);
    expect(offScript("我们去 カフェ 吧", "cmn")).toBe(true);
    expect(offScript("我们去 사랑 吧", "yue")).toBe(true);
  });
  it("never re-runs other languages, which can quote Korean or Chinese on purpose", () => {
    expect(offScript("She said 사랑해 and then 我爱你", "eng")).toBe(false);
    expect(offScript("¿Qué significa 国外?", "spa")).toBe(false);
  });
  it("does nothing without a detected language", () => {
    expect(offScript("国外 국외", null)).toBe(false);
    expect(offScript("国外 국외", undefined)).toBe(false);
    expect(offScript("国外 국외", "")).toBe(false);
  });
  it("is case-insensitive about the code", () => {
    expect(offScript("国外", "KOR")).toBe(true);
  });
});

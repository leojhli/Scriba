import { describe, expect, it } from "vitest";
import { hasNonLatin, joinWords, SENTENCE_END, tidyText, tokenize } from "./text";

describe("joinWords", () => {
  it("joins Spanish words with spaces and no space before punctuation", () => {
    expect(joinWords(["Estoy", "bien", ",", "amigo", "."])).toBe("Estoy bien, amigo.");
  });
  it("joins Chinese characters without spaces", () => {
    expect(joinWords(["这", "么", "多", "年", "过", "去", "了", "，"])).toBe("这么多年过去了，");
  });
  it("keeps the space between Chinese and Latin words", () => {
    expect(joinWords(["我", "用", "iPhone", "拍", "的"])).toBe("我用 iPhone 拍的");
  });
});

describe("tidyText", () => {
  it("repairs transcripts stored with spaces between characters", () => {
    expect(tidyText("不 知 道 你 现 在 好 不 好 。")).toBe("不知道你现在好不好。");
    expect(tidyText("¿Yo soy el lento?")).toBe("¿Yo soy el lento?");
  });
});

describe("SENTENCE_END", () => {
  it("matches Latin and CJK sentence ends", () => {
    expect(SENTENCE_END.test("aquí?")).toBe(true);
    expect(SENTENCE_END.test("好。")).toBe(true);
    expect(SENTENCE_END.test("吗？")).toBe(true);
    expect(SENTENCE_END.test("amigo,")).toBe(false);
  });
});

describe("tokenize", () => {
  it("splits CJK per character and Latin per word", () => {
    expect(tokenize("你好，iPhone 不错！")).toEqual(["你", "好", "iphone", "不", "错"]);
  });
});

describe("hasNonLatin", () => {
  it("is false for Latin-script lines, accents and punctuation included", () => {
    expect(hasNonLatin("¿Quieres ser un perro de trineo?")).toBe(false);
    expect(hasNonLatin("Ma meilleure ennemie, ça va ?")).toBe(false);
    expect(hasNonLatin("Hi, welcome to Street Talk。Today we are in China")).toBe(false);
  });

  it("is true for Chinese, Japanese, Korean and other scripts", () => {
    expect(hasNonLatin("我姓高。")).toBe(true);
    expect(hasNonLatin("ありがとう")).toBe(true);
    expect(hasNonLatin("사랑을 했다")).toBe(true);
    expect(hasNonLatin("Привет")).toBe(true);
    expect(hasNonLatin("OK, 好不好？")).toBe(true);
  });
});

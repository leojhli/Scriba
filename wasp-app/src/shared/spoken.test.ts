import { describe, expect, it } from "vitest";
import { spokenText } from "./text";


describe("spokenText", () => {
  it("drops pinyin in parentheses but keeps English glosses", () => {
    expect(spokenText("The key word is 等 (děng), 'to wait'.")).toBe("The key word is 等, 'to wait'.");
    expect(spokenText("The word 勾勒 (outline, sketch) is poetic.")).toBe("The word 勾勒 (outline, sketch) is poetic.");
    expect(spokenText("高小姐 (Gāo xiǎojiě) is polite.")).toBe("高小姐 is polite.");
  });
});

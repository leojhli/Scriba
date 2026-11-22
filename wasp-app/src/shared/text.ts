// Language-agnostic text helpers. Chinese/Japanese have no spaces between words,
// so they are handled per character.
const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";
const CJK_PUNCT = "，。！？、：；「」『』（）《》…";

const CJK_GAP = new RegExp(`([${CJK}${CJK_PUNCT}])\\s+(?=[${CJK}${CJK_PUNCT}])`, "gu");
const SPACE_BEFORE_PUNCT = /\s+([,.?!;:…])/g;

/** Joins transcript words: no space before punctuation, none between CJK characters. */
export function joinWords(words: string[]): string {
  return words.join(" ").replace(SPACE_BEFORE_PUNCT, "$1").replace(CJK_GAP, "$1").replace(/\s+/g, " ").trim();
}

/** Tidies text that was joined word-by-word with spaces (e.g. older transcripts). */
export function tidyText(s: string): string {
  return s.replace(CJK_GAP, "$1").replace(/\s+/g, " ").trim();
}

/** Sentence end in any script: . ? ! … 。 ！ ？ (optionally followed by a closing quote). */
export const SENTENCE_END = /[.?!…。！？]["»”'」』]?$/u;

// One token per CJK character, otherwise runs of letters/digits.
const TOKEN = new RegExp(`[${CJK}]|(?:(?![${CJK}])[\\p{L}\\p{N}])+`, "gu");

/** Lowercase, strip accents and punctuation, split into words (CJK: characters). */
export function tokenize(s: string): string[] {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").match(TOKEN) ?? [];
}

// Pinyin/romaji in parentheses, e.g. "等 (děng)": fine on screen, odd when read aloud.
const SPOKEN_ROMANIZATION = /\s*[（(][^)）]*[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ][^)）]*[)）]/g;

/** What the mascot actually says: the summary without romanization in parentheses. */
export function spokenText(summary: string): string {
  return summary.replace(SPOKEN_ROMANIZATION, "").replace(/\s+([,.;:!?])/g, "$1").trim();
}

/** True if the text has letters outside the Latin script (Han, Kana, Hangul, Cyrillic…): those lines get a romanization. */
export function hasNonLatin(s: string): boolean {
  return /(?!\p{Script=Latin})\p{L}/u.test(s);
}

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

// ---------- Speaking other languages in their own accent ----------
// The summary is English, but it quotes words from the video. Read in one English TTS call,
// those get anglicized ("难追" → "nonjui"), so the voice is split into parts and each quote is
// spoken with its own language code. Claude marks quotes «like this»; non-Latin script is
// caught even without the marks.

export type SpeechPart = { text: string; foreign: boolean };

const QUOTE = /«([^»]*)»/g;
// A run of non-Latin letters (Han, Kana, Hangul, Cyrillic…), with CJK punctuation and the
// spaces between words of the same script.
const NON_LATIN_WORD = `(?:(?!\\p{Script=Latin})\\p{L}|[${CJK_PUNCT}])+`;
const NON_LATIN_RUN = new RegExp(`${NON_LATIN_WORD}(?:\\s+${NON_LATIN_WORD})*`, "gu");

/** Splits what the mascot says into English parts and parts in the video's language. */
export function speechParts(summary: string): SpeechPart[] {
  const raw: SpeechPart[] = [];
  const text = spokenText(summary);
  let at = 0;
  const english = (s: string) => {
    let i = 0;
    for (const m of s.matchAll(NON_LATIN_RUN)) {
      raw.push({ text: s.slice(i, m.index), foreign: false }, { text: m[0], foreign: true });
      i = m.index + m[0].length;
    }
    raw.push({ text: s.slice(i), foreign: false });
  };
  for (const m of text.matchAll(QUOTE)) {
    english(text.slice(at, m.index));
    raw.push({ text: m[1], foreign: true });
    at = m.index + m[0].length;
  }
  english(text.slice(at));

  const parts: SpeechPart[] = [];
  for (const p of raw) {
    const t = p.text.trim();
    if (!t) continue;
    const last = parts[parts.length - 1];
    if (last && (last.foreign === p.foreign || !/[\p{L}\p{N}]/u.test(t))) last.text += (/^[,.;:!?…]/.test(t) ? "" : " ") + t;
    else parts.push({ text: t, foreign: p.foreign });
  }
  return parts;
}

/** The summary as shown on screen: the «quote marks» meant for the voice become ordinary quotes. */
export function displaySummary(summary: string): string {
  return summary.replace(QUOTE, "“$1”");
}

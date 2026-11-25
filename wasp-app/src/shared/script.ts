/**
 * Scribe auto-detects a video's language, but it can still write one word in a neighbouring
 * language's script: a Korean video got 国外 (Chinese characters) for 국외 "abroad", and the
 * romanization that followed was wrong too. `offScript()` spots that, so ingest can transcribe
 * again with the detected language set.
 *
 * Only Korean, Japanese and Chinese are checked, and only for each other's scripts. Latin text
 * (English loanwords, names) is always fine, and a video detected as e.g. English or Spanish is
 * never re-run: those can quote Korean or Chinese on purpose.
 */

const HAN = /\p{Script=Han}/u;
const HANGUL = /\p{Script=Hangul}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Scripts that don't belong in a transcript of this language. Scribe returns ISO 639-3 codes; 639-1 is accepted too. */
function foreignScripts(language: string): RegExp[] {
  switch (language.toLowerCase()) {
    case "kor":
    case "ko":
      return [HAN, KANA];
    case "jpn":
    case "ja":
      return [HANGUL];
    case "zho":
    case "cmn":
    case "yue":
    case "chi":
    case "zh":
      return [HANGUL, KANA];
    default:
      return [];
  }
}

/** True when `text` contains a script that doesn't belong to `language` (see above). */
export function offScript(text: string, language: string | null | undefined): boolean {
  if (!language) return false;
  return foreignScripts(language).some((script) => script.test(text));
}

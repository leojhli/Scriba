import { type KeyboardEvent, type MouseEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { config } from "wasp/client";
import { getWordGloss } from "wasp/client/operations";
import type { WordGloss } from "../shared/types";
import { charTimes, splitWords, tokenSpans } from "../shared/words";
import type { DeckCard } from "../server/deck";
import { playSound } from "./sound";

// Tap a word on /deck and /practice, like on the scroll: every word of the line opens a word card
// (meaning here, dictionary form, romanization, a note), from the same lookup and cache as the
// extension (src/server/word.ts).

const CLIP_RATE = 0.75; // the scroll's default "Hear it clearly" speed

type LineCard = Pick<DeckCard, "videoId" | "segmentId" | "text" | "start" | "end" | "words" | "hasDialogue" | "audioFile">;
type Tapped = { tok: number; word: string } & ({ loading: true } | { gloss: WordGloss } | { error: string });

// Answers already fetched on this page visit, so going from the deck to practice is instant.
const seen = new Map<string, WordGloss>();

/**
 * The card's line with each word tappable, then `children` (romanization, translation…), then the
 * word card for the tapped word. Give it `key={videoId:segmentId}` so a new line starts closed.
 */
export function TappableLine({ card, className, children }: { card: LineCard; className: string; children?: ReactNode }) {
  const tokens = useMemo(() => splitWords(card.text), [card.text]);
  const [tapped, setTapped] = useState<Tapped | null>(null);
  const seq = useRef(0);

  const open = async (tok: number) => {
    const me = ++seq.current;
    if (tapped?.tok === tok) {
      setTapped(null); // tapping the open word again closes its card
      return;
    }
    const word = tokens[tok].text;
    // Which occurrence of the word it is, counted in words (the server's cache key).
    const index = tokens.slice(0, tok).filter((t) => t.word).length;
    const key = `${card.videoId}|${card.segmentId}|${index}|${word}`;
    const known = seen.get(key);
    if (known) {
      setTapped({ tok, word, gloss: known });
      return;
    }
    setTapped({ tok, word, loading: true });
    try {
      const gloss = await getWordGloss({ videoId: card.videoId, segmentId: card.segmentId, line: card.text, word, index });
      seen.set(key, gloss);
      if (seq.current === me) setTapped({ tok, word, gloss });
    } catch {
      if (seq.current === me) setTapped({ tok, word, error: "Couldn't look that up right now." });
    }
  };

  const close = () => {
    seq.current++;
    setTapped(null);
  };

  // The word spoken on its own if the server made one, else cut out of the voice-only track.
  const gloss = tapped && "gloss" in tapped ? tapped.gloss : null;
  const canPlay = !!gloss?.audioUrl || card.hasDialogue;
  const play = () => {
    if (!tapped) return;
    if (gloss?.audioUrl) {
      playSound(`${config.apiUrl}${gloss.audioUrl}`);
      return;
    }
    const span = tokenSpans(tokens, charTimes(card))[tapped.tok];
    if (span) playSound(`${config.apiUrl}/media/${card.videoId}/${card.audioFile}`, { from: span.start - 0.08, to: span.end + 0.12, rate: CLIP_RATE });
  };

  // Keeps a tap from reaching the card underneath (on /deck the card opens practice).
  const tap = (tok: number) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void open(tok);
  };
  const key = (tok: number) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    void open(tok);
  };

  return (
    <>
      <div className={className}>
        {tokens.map((t, k) =>
          t.word ? (
            <span
              key={k}
              className={tapped?.tok === k ? "tap sel" : "tap"}
              role="button"
              tabIndex={0}
              title="What does this word mean?"
              aria-expanded={tapped?.tok === k}
              onClick={tap(k)}
              onKeyDown={key(k)}
            >
              {t.text}
            </span>
          ) : (
            <span key={k}>{t.text}</span>
          ),
        )}
      </div>
      {children}
      {tapped && (
        <div className="gloss" role="region" aria-label={`What “${tapped.word}” means`} aria-live="polite">
          {canPlay && (
            <button type="button" className="btn icon" title="Hear this word" aria-label={`Hear “${tapped.word}”`} onClick={play}>
              <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5-.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
              </svg>
            </button>
          )}
          <div className="gbody">
            {gloss ? (
              <>
                <div>
                  <span className="gw">{gloss.word}</span>
                  {gloss.lemma && <span className="gl">from {gloss.lemma}</span>}
                </div>
                {gloss.romanization && <div className="gr">{gloss.romanization}</div>}
                <div className="gm">{gloss.meaning}</div>
                {gloss.note && <div className="gn">{gloss.note}</div>}
              </>
            ) : (
              <>
                <div className="gw">{tapped.word}</div>
                {"error" in tapped ? (
                  <div className="gn">{tapped.error}</div>
                ) : (
                  <div className="skel" aria-label="Looking it up…">
                    <div className="sk w60" />
                    <div className="sk w40" />
                  </div>
                )}
              </>
            )}
          </div>
          <button type="button" className="x" title="Close" aria-label="Close word card" onClick={close}>
            ×
          </button>
        </div>
      )}
    </>
  );
}

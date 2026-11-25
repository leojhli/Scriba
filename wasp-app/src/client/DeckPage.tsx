import { useState } from "react";
import { deleteCard, getDeck, useQuery } from "wasp/client/operations";
import { Link } from "wasp/client/router";
import "./Main.css";
import "./study.css";
import { SketchDefs } from "./SketchDefs";
import { TappableLine } from "./WordTaps";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Task 7: one card per line you paused on, most-paused first.
export function DeckPage() {
  const { data, isLoading, error, refetch } = useQuery(getDeck, undefined, { refetchInterval: 5000 });
  // Cards being deleted are hidden right away, then dropped for good once the deck reloads without them.
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const keyOf = (c: { videoId: string; segmentId: number }) => `${c.videoId}:${c.segmentId}`;
  const cards = data?.filter((c) => !removing.has(keyOf(c)));

  const onDelete = async (videoId: string, segmentId: number) => {
    const key = keyOf({ videoId, segmentId });
    const forget = () =>
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    setDeleteError(null);
    setRemoving((prev) => new Set(prev).add(key));
    try {
      await deleteCard({ videoId, segmentId });
      await refetch();
      forget();
    } catch (e) {
      forget();
      setDeleteError(`Couldn't delete that card: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <main className="study">
      <SketchDefs />
      <header className="study-head">
        <div className="brand">
          <img src="/scriba-inu.png" alt="Scriba" />
          <div>
            <div className="kicker">Scriba</div>
            <h1>Your deck</h1>
            <p className="sub">
              Every line you paused on, ranked by how often you stopped there. Open a card to practise it, or tap a word.
            </p>
          </div>
        </div>
        <Link to="/practice" className="btn primary">
          Practice top 5 →
        </Link>
      </header>

      {isLoading && <p className="sub">Loading…</p>}
      {error && <p className="sub">Couldn't load the deck: {String(error)}</p>}
      {deleteError && <p className="sub">{deleteError}</p>}
      {cards && cards.length === 0 && (
        <div className="empty">
          <img src="/scriba-inu.png" alt="Scriba" />
          <p className="say">No cards yet.</p>
          <p className="sub">Open any YouTube video with Scriba on and pause on a line you didn't catch.</p>
        </div>
      )}

      <div className="cards">
        {cards?.map((c) => (
          <div key={keyOf(c)} className="card">
            {/* The whole slip opens this card in practice; the words, the video name and the × sit above it. */}
            <Link className="card-open" to="/practice" search={{ card: keyOf(c) }} aria-label={`Practise “${c.text}”`} />
            <div className="card-body">
              <TappableLine key={keyOf(c)} card={c} className="line-es">
                {c.romanization && <div className="line-rom">{c.romanization}</div>}
                {c.translation && <div className="line-en">{c.translation}</div>}
              </TappableLine>
              {c.notes.length > 0 && (
                <ul className="notes">
                  {c.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
              <div className="meta">
                <span className="chip">paused {c.pauses}×</span>
                <span className={c.bestAccuracy === null ? "chip muted" : "chip good"}>
                  {c.bestAccuracy === null ? "not practised" : `best ${Math.round(c.bestAccuracy * 100)}%`}
                </span>
                {/* The only way to the video: its name, at the moment of the line. */}
                <a
                  className="from"
                  href={`https://www.youtube.com/watch?v=${c.videoId}&t=${Math.max(0, Math.floor(c.start) - 1)}s`}
                  target="_blank"
                  rel="noreferrer"
                  title="Watch this moment on YouTube"
                >
                  <span className="from-title">{c.videoTitle}</span>
                  <span className="from-at">at {fmt(c.start)} ↗</span>
                </a>
              </div>
            </div>
            <button
              type="button"
              className="btn card-x"
              aria-label={`Delete the card for "${c.text}"`}
              onClick={() => onDelete(c.videoId, c.segmentId)}
            >
              <span className="card-x-label" aria-hidden="true">
                Delete
              </span>
              <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}

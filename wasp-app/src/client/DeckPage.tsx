import { getDeck, useQuery } from "wasp/client/operations";
import { Link } from "wasp/client/router";
import "./Main.css";
import "./study.css";
import { SketchDefs } from "./SketchDefs";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Task 7: one card per line you paused on, most-paused first.
export function DeckPage() {
  const { data: cards, isLoading, error } = useQuery(getDeck, undefined, { refetchInterval: 5000 });

  return (
    <main className="study">
      <SketchDefs />
      <header className="study-head">
        <div className="brand">
          <img src="/scriba-inu.png" alt="Scriba" />
          <div>
            <div className="kicker">Scriba</div>
            <h1>Your deck</h1>
            <p className="sub">Every line you paused on, ranked by how often you stopped there.</p>
          </div>
        </div>
        <Link to="/practice" className="btn primary">
          Practice top 5 →
        </Link>
      </header>

      {isLoading && <p className="sub">Loading…</p>}
      {error && <p className="sub">Couldn't load the deck: {String(error)}</p>}
      {cards && cards.length === 0 && (
        <div className="empty">
          <img src="/scriba-inu.png" alt="Scriba" />
          <p className="say">No cards yet.</p>
          <p className="sub">Open any YouTube video with Scriba on and pause on a line you didn't catch.</p>
        </div>
      )}

      <div className="cards">
        {cards?.map((c) => (
          <a
            key={`${c.videoId}:${c.segmentId}`}
            className="card"
            href={`https://www.youtube.com/watch?v=${c.videoId}&t=${Math.max(0, Math.floor(c.start) - 1)}s`}
            target="_blank"
            rel="noreferrer"
          >
            <div className="line-es">{c.text}</div>
            {c.romanization && <div className="line-rom">{c.romanization}</div>}
            {c.translation && <div className="line-en">{c.translation}</div>}
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
              <span className="from">{c.videoTitle}</span>
              <span className="go">watch at {fmt(c.start)} ↗</span>
            </div>
          </a>
        ))}
      </div>
    </main>
  );
}

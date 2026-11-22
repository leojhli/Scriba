import { type CSSProperties, useRef, useState } from "react";
import { config } from "wasp/client";
import { getDeck, submitShadow, useQuery } from "wasp/client/operations";
import { Link } from "wasp/client/router";
import type { ShadowResult } from "../shared/types";
import "./Main.css";
import "./study.css";
import { SketchDefs } from "./SketchDefs";

const RATE = 0.75;

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

// Task 7: step through the top 5 cards — hear the clip, read the translation, shadow it.
export function PracticePage() {
  const { data: cards, isLoading } = useQuery(getDeck);
  const [i, setI] = useState(0);
  const [recording, setRecording] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState<(ShadowResult & { heard: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<{ mr: MediaRecorder; chunks: Blob[]; t0: number; stream: MediaStream } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const top = (cards ?? []).slice(0, 5);
  const card = top[i];

  if (isLoading) return <main className="study"><p className="sub">Loading…</p></main>;
  if (!card)
    return (
      <main className="study">
        <div className="empty">
          <img src="/scriba-inu.png" alt="Scriba" />
          <p className="say">Nothing to practise yet.</p>
          <p className="sub">Pause on a few lines with Scriba on, then come back.</p>
          <p style={{ marginTop: 16 }}>
            <Link to="/deck" className="btn">← Deck</Link>
          </p>
        </div>
      </main>
    );

  const play = () => {
    audio.current?.pause();
    const a = new Audio(`${config.apiUrl}/media/${card.videoId}/${card.audioFile}`);
    audio.current = a;
    a.preservesPitch = true;
    a.addEventListener(
      "loadedmetadata",
      () => {
        a.currentTime = Math.max(0, card.start - 0.1);
        a.defaultPlaybackRate = a.playbackRate = RATE;
        void a.play();
      },
      { once: true },
    );
    a.addEventListener("timeupdate", () => a.currentTime >= card.end + 0.2 && a.pause());
  };

  const start = async () => {
    setErr(null);
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.start();
      rec.current = { mr, chunks, t0: performance.now(), stream };
      setRecording(true);
    } catch {
      setErr("Microphone blocked. Allow it for localhost and try again.");
    }
  };

  const stop = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setRecording(false);
    const durationSec = (performance.now() - r.t0) / 1000;
    await new Promise<void>((res) => {
      r.mr.onstop = () => res();
      r.mr.stop();
    });
    r.stream.getTracks().forEach((t) => t.stop());
    setScoring(true);
    try {
      const audioBase64 = await blobToBase64(new Blob(r.chunks, { type: "audio/webm" }));
      setResult(await submitShadow({ videoId: card.videoId, segmentId: card.segmentId, audioBase64, durationSec }));
    } catch (e) {
      setErr(`Couldn't score that: ${String(e)}`);
    } finally {
      setScoring(false);
    }
  };

  const next = () => {
    audio.current?.pause();
    setResult(null);
    setErr(null);
    setI((i + 1) % top.length);
  };

  const pct = result ? Math.round(result.accuracy * 100) : 0;
  const ring = { "--p": pct, "--c": pct >= 80 ? "#3fb55e" : pct >= 50 ? "#ffb21c" : "#d6533a" } as CSSProperties;

  return (
    <main className="study">
      <SketchDefs />
      <header className="study-head">
        <div className="brand">
          <img src="/scriba-inu.png" alt="Scriba" />
          <div>
            <div className="kicker">Scriba · practice</div>
            <h1>Say it after me</h1>
            <p className="sub">
              Card {i + 1} of {top.length} · paused {card.pauses}× · {card.videoTitle}
            </p>
          </div>
        </div>
        <Link to="/deck" className="btn">← Deck</Link>
      </header>

      <section className="scroll">
        <div className="roll" />
        <div className="ribbon" />
        <div className="practice">
          <div className="kicker">Just said</div>
          <div className="line-es big">{card.text}</div>
          {card.romanization && <div className="line-rom big">{card.romanization}</div>}
          {card.translation ? <div className="line-en big">{card.translation}</div> : <div className="line-en muted">(no translation yet)</div>}

          <div className="row">
            <button className="btn" onClick={play}>
              {card.hasDialogue ? "Hear it clearly" : "Hear it"} · {RATE}×
            </button>
            <button
              className={recording ? "btn rec" : "btn primary"}
              onPointerDown={start}
              onPointerUp={stop}
              onPointerLeave={() => recording && stop()}
              disabled={scoring}
            >
              {recording ? "● Recording… release to score" : scoring ? "Scoring…" : "Hold to shadow"}
            </button>
            <button className="btn" onClick={next}>
              Next →
            </button>
          </div>

          {err && <p className="sub">{err}</p>}
          {result && (
            <div className="result">
              <div className="ring" style={ring}>
                <span>{pct}%</span>
              </div>
              <div>
                <div className="words">
                  {result.diff.map((d, k) => (
                    <span key={k} className={`w ${d.status}`} title={d.status}>
                      {d.word}
                    </span>
                  ))}
                </div>
                <div className="pace">
                  pace {result.paceRatio.toFixed(2)}× · heard “{result.heard || "…nothing"}”
                </div>
              </div>
            </div>
          )}
          <div className="dots">
            {top.map((_, k) => (
              <span key={k} className={k === i ? "on" : k < i ? "done" : ""} />
            ))}
          </div>
        </div>
        <div className="roll bottom" />
      </section>
    </main>
  );
}

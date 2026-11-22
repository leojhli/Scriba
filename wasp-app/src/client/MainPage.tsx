import { Link } from "wasp/client/router";
import "./Main.css";
import "./study.css";
import { SketchDefs } from "./SketchDefs";

export function MainPage() {
  return (
    <main className="study">
      <SketchDefs />
      <header className="study-head">
        <div className="brand">
          <img src="/scriba-inu.png" alt="Scriba" />
          <div>
            <div className="kicker">Scriba</div>
            <h1>You just watch. It builds your study program.</h1>
            <p className="sub">Pause any YouTube video and Scriba explains the line, then keeps it here for practice.</p>
          </div>
        </div>
      </header>
      <div className="home-actions">
        <Link to="/deck" className="btn primary">
          Open your deck
        </Link>
        <Link to="/practice" className="btn">
          Practice
        </Link>
      </div>
    </main>
  );
}

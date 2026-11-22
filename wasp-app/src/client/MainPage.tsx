import { Link } from "wasp/client/router";
import "./Main.css";

export function MainPage() {
  return (
    <main className="container">
      <h2 className="title">Pause &amp; Effect</h2>
      <p className="content">You just watch. It builds your study program.</p>
      <div className="buttons">
        <Link to="/deck" className="button button-filled">
          Open deck
        </Link>
        <Link to="/practice" className="button button-outlined">
          Practice
        </Link>
      </div>
    </main>
  );
}

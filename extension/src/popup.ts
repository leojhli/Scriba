// The toolbar popup: turn Scriba on or off, and open the deck or practice.
import { loadEnabled, saveEnabled } from "./enabled";
import { WEB_URL } from "./shared/config";

const toggle = document.getElementById("toggle") as HTMLInputElement;
const state = document.getElementById("state") as HTMLElement;
const hint = document.getElementById("hint") as HTMLElement;

function show(on: boolean): void {
  toggle.checked = on;
  document.body.classList.toggle("off", !on);
  state.textContent = on ? "On" : "Off";
  hint.textContent = on
    ? "Pause any YouTube video and I'll explain the line you just heard."
    : "I'll stay quiet on YouTube. Nothing is sent or transcribed until you turn me back on.";
}

void loadEnabled().then(show);
toggle.addEventListener("change", () => {
  show(toggle.checked);
  void saveEnabled(toggle.checked);
});

for (const a of document.querySelectorAll<HTMLAnchorElement>("a[data-path]")) {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    void chrome.tabs.create({ url: `${WEB_URL}${a.dataset.path}` });
    window.close();
  });
}

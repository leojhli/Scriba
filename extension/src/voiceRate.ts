// How fast Scriba's spoken reply plays. The pill in the panel header cycles through these,
// and the choice is saved in chrome.storage so it sticks across videos, tabs and restarts.
export const VOICE_RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 2];

const KEY = "voiceRate";
// Each tab tags its own writes: storage echoes them back asynchronously, and an older echo
// arriving after a newer click would otherwise undo it.
const ME = Math.random().toString(36).slice(2);
type Stored = { rate: number; from: string };

/** The next speed in the cycle, wrapping round; an unknown value restarts at 1×. */
export function nextVoiceRate(current: number): number {
  const i = VOICE_RATES.indexOf(current);
  return i < 0 ? 1 : VOICE_RATES[(i + 1) % VOICE_RATES.length];
}

export const rateLabel = (rate: number): string => `${rate}×`;

const valid = (v: unknown): v is number => typeof v === "number" && VOICE_RATES.includes(v);

export async function loadVoiceRate(): Promise<number> {
  try {
    const r = ((await chrome.storage.local.get(KEY))[KEY] as Stored | undefined)?.rate;
    return valid(r) ? r : 1;
  } catch {
    return 1; // extension reloaded under this page: keep the default
  }
}

export function saveVoiceRate(rate: number): void {
  try {
    void chrome.storage.local.set({ [KEY]: { rate, from: ME } satisfies Stored }).catch(() => {});
  } catch {
    // extension reloaded under this page: the speed still applies until it's refreshed
  }
}

/** Keeps other YouTube tabs in sync when the speed changes in one of them. */
export function onVoiceRateChange(fn: (rate: number) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const v = changes[KEY]?.newValue as Stored | undefined;
    if (area === "local" && v && v.from !== ME && valid(v.rate)) fn(v.rate);
  });
}

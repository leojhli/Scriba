// Playback speeds the user picks in the overlay, saved in chrome.storage so they stick across
// videos, tabs and restarts:
// - voice: how fast Scriba's spoken reply plays (the pill in the panel header cycles these);
// - clip: how fast "Hear it clearly" plays the isolated line (the slider pill next to it).
import { HEAR_IT_RATE } from "./shared/config";

export const VOICE_RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 2];
export const CLIP_RATES: readonly number[] = [1, 0.75, 0.5];

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
/** Compact label for the slider pill: ".75×" instead of "0.75×". */
export const shortRateLabel = (rate: number): string => `${rate}`.replace(/^0\./, ".") + "×";

/** One saved speed setting: load it, save it, and hear about changes made in other tabs. */
function rateSetting(key: string, rates: readonly number[], fallback: number) {
  const valid = (v: unknown): v is number => typeof v === "number" && rates.includes(v);
  return {
    async load(): Promise<number> {
      try {
        const r = ((await chrome.storage.local.get(key))[key] as Stored | undefined)?.rate;
        return valid(r) ? r : fallback;
      } catch {
        return fallback; // extension reloaded under this page: keep the default
      }
    },
    save(rate: number): void {
      try {
        void chrome.storage.local.set({ [key]: { rate, from: ME } satisfies Stored }).catch(() => {});
      } catch {
        // extension reloaded under this page: the speed still applies until it's refreshed
      }
    },
    onChange(fn: (rate: number) => void): void {
      chrome.storage.onChanged.addListener((changes, area) => {
        const v = changes[key]?.newValue as Stored | undefined;
        if (area === "local" && v && v.from !== ME && valid(v.rate)) fn(v.rate);
      });
    },
  };
}

const voice = rateSetting("voiceRate", VOICE_RATES, 1);
export const loadVoiceRate = voice.load;
export const saveVoiceRate = voice.save;
/** Keeps other YouTube tabs in sync when the speed changes in one of them. */
export const onVoiceRateChange = voice.onChange;

const clip = rateSetting("clipRate", CLIP_RATES, HEAR_IT_RATE);
export const loadClipRate = clip.load;
export const saveClipRate = clip.save;
export const onClipRateChange = clip.onChange;

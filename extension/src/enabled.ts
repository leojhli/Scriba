// The on/off switch in the toolbar popup. Saved in chrome.storage so every YouTube tab follows it.
// Off means Scriba stays quiet: no overlay, no explanations, and nothing is sent to the server
// (so no transcription credits are spent on videos you don't need help with).
const KEY = "enabled";

export async function loadEnabled(): Promise<boolean> {
  try {
    return (await chrome.storage.local.get(KEY))[KEY] !== false; // on unless switched off
  } catch {
    return true; // extension reloaded under this page
  }
}

export function saveEnabled(on: boolean): Promise<void> {
  return chrome.storage.local.set({ [KEY]: on });
}

export function onEnabledChange(fn: (on: boolean) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && KEY in changes) fn(changes[KEY].newValue !== false);
  });
}

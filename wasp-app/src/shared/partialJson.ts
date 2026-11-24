/**
 * Reads a JSON object that is still streaming in and returns its top-level string fields
 * whose closing quote has already arrived. Nested values are skipped, never returned.
 *
 * Used to start the voice as soon as Claude has finished writing "summary", while it is
 * still writing the line translations after it.
 */
export function completedStrings(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = text.indexOf("{");
  if (i < 0) return out;
  i++;
  let depth = 1; // 1 = inside the top-level object
  let key: string | null = null; // top-level key waiting for its value
  let expectKey = true;

  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      if (end < 0) return out; // the string is still streaming in
      if (depth === 1) {
        const s = JSON.parse(text.slice(i, end + 1)) as string;
        if (expectKey) key = s;
        else if (key !== null) {
          out[key] = s;
          key = null;
        }
      }
      i = end + 1;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (depth === 1 && c === ":") expectKey = false;
    else if (depth === 1 && c === ",") {
      expectKey = true;
      key = null;
    }
    i++;
  }
  return out;
}

/** Index of the quote closing the string that opens at `start`, or -1 if it hasn't arrived. */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i;
  }
  return -1;
}

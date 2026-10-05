/** Parses a JSON blob assigned in a page script, e.g. `window.__myx = {...}`. */
export function jsonAfter(doc: Document, marker: string): any {
  for (const s of doc.scripts) {
    const t = s.textContent ?? "";
    const at = t.indexOf(marker);
    if (at < 0) continue;
    const start = t.indexOf("{", at);
    const end = t.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      // not plain JSON; try the next script
    }
  }
  return null;
}

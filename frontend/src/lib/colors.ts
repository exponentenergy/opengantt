/**
 * Categorical bar colouring shared by GanttChart, MiniGantt, SharePage and
 * the HTML export. Bars are coloured by a categorical field value (the phase
 * for matrix imports, the detected status column for table imports).
 *
 * Well-known phase names get canonical colours matching the original sheet
 * semantics; anything else gets a stable slot in a muted categorical palette
 * (hash of the value), so colours survive reloads and re-imports.
 */

/** Muted categorical palette — legible on both light and dark canvases. */
export const PALETTE = [
  "#4f7fd9", // blue
  "#7c9cc4", // steel
  "#8fbf6f", // light green
  "#3f9e63", // green
  "#2f9e9b", // teal
  "#d66a6a", // rose
  "#9d6bbf", // purple
  "#d99a2b", // amber
  "#c46a9c", // magenta
  "#8a8f98", // slate
] as const;

/** Canonical colours for well-known phase names (keyed by normalised value). */
const CANONICAL: Record<string, string> = {
  "scope discovery": "#4f7fd9", // blue
  development: "#7c9cc4", // steel blue
  developement: "#7c9cc4", // tolerate the sheet's misspelling
  uat: "#8fbf6f", // light green
  migration: "#3f9e63", // green
  "go-live": "#1f7a4d", // dark green
  "go live": "#1f7a4d",
  sustenance: "#1e7d63", // deep green-teal (kept light enough for dark themes)
  "increment - bug": "#d66a6a", // rose
  "increment - feature": "#9d6bbf", // purple
  "increment - data import": "#d99a2b", // amber
};

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** djb2 — stable across sessions, unlike anything Math.random-based. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Colour for a categorical value. Null/empty values get no colour. */
export function categoryColor(value: string | null | undefined): string | null {
  if (value == null) return null;
  const norm = normalise(String(value));
  if (!norm) return null;
  return CANONICAL[norm] ?? PALETTE[hash(norm) % PALETTE.length];
}

/** Darker, fully-opaque variant of a hex colour (for progress fills). */
export function darker(hex: string, amount = 0.28): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c: number) => Math.max(0, Math.round(c * (1 - amount)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export interface LegendEntry {
  value: string;
  color: string;
}

/** Distinct values (first-seen order) with their colours, for legend rows. */
export function legendEntries(values: (string | null | undefined)[]): LegendEntry[] {
  const seen = new Set<string>();
  const out: LegendEntry[] = [];
  for (const v of values) {
    if (v == null) continue;
    const label = String(v).trim();
    if (!label) continue;
    const key = normalise(label);
    if (seen.has(key)) continue;
    seen.add(key);
    const color = categoryColor(label);
    if (color) out.push({ value: label, color });
  }
  return out;
}

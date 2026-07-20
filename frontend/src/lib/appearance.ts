/**
 * Appearance preferences: Astryx theme, light/dark mode, optional accent.
 *
 * Every bundled Astryx theme is scoped to `[data-astryx-theme="<name>"]`
 * (via CSS @scope), so all theme stylesheets coexist in one bundle and
 * switching is a single attribute flip on <html>. Mode rides Astryx's
 * `html[data-theme="light"|"dark"]` -> color-scheme rules (absent attribute
 * = follow the system, because tokens use light-dark()). The accent is an
 * inline CSS-variable override on <html>, which beats any scoped token.
 *
 * Persisted in localStorage under "og_appearance" and applied before first
 * paint (see main.tsx) to avoid a theme flash.
 */

export type Mode = "light" | "dark" | "system";

export interface Appearance {
  theme: string;
  mode: Mode;
  /** Hex accent override, or null for the theme's own accent. */
  accent: string | null;
}

export const STORAGE_KEY = "og_appearance";

export const THEMES: { id: string; label: string; note?: string }[] = [
  { id: "stone", label: "Stone" },
  { id: "neutral", label: "Neutral" },
  { id: "matcha", label: "Matcha" },
  { id: "butter", label: "Butter" },
  { id: "chocolate", label: "Chocolate" },
  { id: "gothic", label: "Gothic", note: "always dark" },
  { id: "y2k", label: "Y2K" },
];

/** Preset accent swatches (null = theme default). All carry white text. */
export const ACCENTS: string[] = [
  "#2f6fdb", // azure
  "#17948c", // teal
  "#1f9d55", // green
  "#d97f1f", // amber
  "#e05d5d", // coral
  "#c74b8f", // magenta
  "#7c5cd6", // violet
  "#64748b", // slate
];

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "stone",
  mode: "system",
  accent: null,
};

const ACCENT_VARS = ["--color-accent", "--color-text-accent", "--color-icon-accent"];

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return {
      theme: THEMES.some((t) => t.id === parsed.theme) ? parsed.theme! : "stone",
      mode: parsed.mode === "light" || parsed.mode === "dark" ? parsed.mode : "system",
      accent:
        typeof parsed.accent === "string" && /^#[0-9a-f]{6}$/i.test(parsed.accent)
          ? parsed.accent
          : null,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    /* private mode etc. — appearance simply won't persist */
  }
}

export function applyAppearance(a: Appearance): void {
  const html = document.documentElement;
  html.setAttribute("data-astryx-theme", a.theme);

  if (a.mode === "system") html.removeAttribute("data-theme");
  else html.setAttribute("data-theme", a.mode);

  if (a.accent) {
    for (const v of ACCENT_VARS) html.style.setProperty(v, a.accent);
    html.style.setProperty("--color-accent-muted", `${a.accent}2e`);
    html.style.setProperty("--color-on-accent", "#ffffff");
  } else {
    for (const v of ACCENT_VARS) html.style.removeProperty(v);
    html.style.removeProperty("--color-accent-muted");
    html.style.removeProperty("--color-on-accent");
  }
}

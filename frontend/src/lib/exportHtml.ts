/**
 * Serialize the current gantt view into a self-contained HTML file and
 * trigger a download. Clones the rendered chart DOM (left table + SVG) and
 * inlines the computed CSS custom properties so it renders standalone.
 */
export function exportHtml(title: string): void {
  const rootEl = document.getElementById("og-gantt-root");
  if (!rootEl) return;

  const clone = rootEl.cloneNode(true) as HTMLElement;

  // Resolve every var(--token) used in our stylesheet against computed styles.
  const cs = getComputedStyle(rootEl);
  const tokens = [
    "--color-background-body",
    "--color-background-card",
    "--color-background-surface",
    "--color-background-muted",
    "--color-border",
    "--color-text-primary",
    "--color-text-secondary",
    "--color-accent",
    "--color-accent-muted",
    "--color-success",
    "--color-error",
    "--color-overlay-hover",
    "--radius-container",
    "--font-family-body",
    "--font-size-base",
    "--font-size-sm",
    "--font-weight-semibold",
  ];
  const varCss = tokens
    .map((t) => `${t}: ${cs.getPropertyValue(t).trim() || "inherit"};`)
    .join("\n  ");

  // Pull our .og-* rules out of the loaded stylesheets.
  let appCss = "";
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (rule.cssText.includes(".og-gantt") || rule.cssText.includes(".og-cell") || rule.cssText.includes(".og-caret") || rule.cssText.includes(".og-bar") || rule.cssText.includes(".og-legend")) {
        appCss += rule.cssText + "\n";
      }
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Gantt</title>
<style>
:root {
  ${varCss}
  color-scheme: light dark;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px;
  background: var(--color-background-body);
  color: var(--color-text-primary);
  font-family: var(--font-family-body, system-ui, sans-serif);
  font-size: 14px;
}
h1 { font-size: 22px; margin: 0 0 4px; }
.og-meta { color: var(--color-text-secondary); font-size: 12px; margin-bottom: 20px; }
${appCss}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="og-meta">Exported from OpenGantt on ${new Date().toLocaleString()}</div>
${clone.outerHTML}
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\w-]+/g, "_") || "gantt"}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

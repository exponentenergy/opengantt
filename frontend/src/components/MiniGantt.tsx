import { useMemo } from "react";
import { Text } from "@astryxdesign/core/Text";
import { looseDay, toDay } from "../lib/dates";
import { categoryColor } from "../lib/colors";
import type { MatrixModulePreview } from "../lib/types";

export interface MiniGanttProps {
  headers: string[];
  rows: (string | null)[][];
  fieldMap: Record<string, string>; // role -> header
  maxRows?: number;
}

/** Live preview strip for the import wizard, rendered from the raw preview rows. */
export function MiniGantt({ headers, rows, fieldMap, maxRows = 8 }: MiniGanttProps) {
  const bars = useMemo(() => {
    const nameIdx = headers.indexOf(fieldMap.task_name ?? "");
    const startIdx = headers.indexOf(fieldMap.start_date ?? "");
    const endIdx = headers.indexOf(fieldMap.end_date ?? "");
    const statusIdx = headers.indexOf(fieldMap.status ?? "");
    if (startIdx < 0 || endIdx < 0) return null;
    const out: { label: string; s: number; e: number; color: string | null }[] = [];
    for (const r of rows) {
      const s = looseDay(r[startIdx]);
      const e = looseDay(r[endIdx]);
      if (s === null || e === null) continue;
      out.push({
        label: nameIdx >= 0 ? String(r[nameIdx] ?? "") : `Row ${out.length + 1}`,
        s,
        e: Math.max(s, e),
        color: statusIdx >= 0 ? categoryColor(r[statusIdx]) : null,
      });
      if (out.length >= maxRows) break;
    }
    return out.length ? out : null;
  }, [headers, rows, fieldMap, maxRows]);

  if (!bars) {
    return (
      <div className="og-minigantt">
        <Text type="supporting" color="secondary">
          Assign Start and End columns to see a live preview of your timeline.
        </Text>
      </div>
    );
  }

  const min = Math.min(...bars.map((b) => b.s));
  const max = Math.max(...bars.map((b) => b.e));
  const span = Math.max(1, max - min + 1);

  return (
    <div className="og-minigantt">
      {bars.map((b, i) => (
        <div key={i} className="og-minigantt-row">
          <span className="og-minigantt-label">{b.label}</span>
          <div className="og-minigantt-track">
            <div
              className="og-minigantt-bar"
              style={{
                left: `${((b.s - min) / span) * 100}%`,
                width: `${((b.e - b.s + 1) / span) * 100}%`,
                ...(b.color ? { background: b.color } : {}),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface MatrixMiniGanttProps {
  /** Server-converted preview modules (analyze_upload.matrix_preview). */
  modules: MatrixModulePreview[];
  maxRows?: number;
}

/**
 * Preview strip for matrix-mode imports: one row per module, one coloured
 * segment per phase run — rendered from server-converted data, zero client
 * parsing.
 */
export function MatrixMiniGantt({ modules, maxRows = 15 }: MatrixMiniGanttProps) {
  const shown = modules.slice(0, maxRows);
  const days: number[] = [];
  for (const m of shown) {
    for (const seg of m.segments) {
      const s = toDay(seg.start);
      const e = toDay(seg.end);
      if (s !== null) days.push(s);
      if (e !== null) days.push(e);
    }
  }
  if (!days.length) {
    return (
      <div className="og-minigantt">
        <Text type="supporting" color="secondary">
          No timeline segments found in this matrix.
        </Text>
      </div>
    );
  }
  const min = Math.min(...days);
  const span = Math.max(1, Math.max(...days) - min + 1);

  return (
    <div className="og-minigantt">
      {shown.map((m) => (
        <div key={m.module} className="og-minigantt-row">
          <span className="og-minigantt-label">{m.module}</span>
          <div className="og-minigantt-track">
            {m.segments.map((seg, i) => {
              const s = toDay(seg.start);
              const e = toDay(seg.end);
              if (s === null || e === null) return null;
              return (
                <div
                  key={i}
                  className="og-minigantt-bar"
                  title={seg.phase}
                  style={{
                    left: `${((s - min) / span) * 100}%`,
                    width: `${((e - s + 1) / span) * 100}%`,
                    background: categoryColor(seg.phase) ?? undefined,
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

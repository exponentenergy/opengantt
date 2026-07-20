import { useCallback, useMemo, useRef, useState } from "react";
import type { Task } from "../lib/types";
import { fmtMonth, fmtShort, fromDay, dayDate, toDay, todayIndex } from "../lib/dates";
import { categoryColor, darker, legendEntries } from "../lib/colors";

export const ROW_H = 36;
const HEADER_H = 44;
const NAME_COL_W = 260;
const EXTRA_COL_W = 120;

interface Row {
  task: Task;
  depth: number;
  /** computed span for groups (min/max of descendants) */
  start: number | null;
  end: number | null;
}

interface DragState {
  name: string;
  mode: "move" | "left" | "right";
  originX: number;
  start: number;
  end: number;
  deltaDays: number;
}

export interface GanttChartProps {
  tasks: Task[];
  displayColumns?: string[];
  pxPerDay: number;
  readOnly?: boolean;
  selected?: string | null;
  onSelect?: (name: string | null) => void;
  onDatesChange?: (name: string, start_date: string, end_date: string) => void;
  svgId?: string;
  /** Field key (in task.fields) whose value colours the bars, e.g. "Phase". */
  colorField?: string | null;
}

function buildRows(tasks: Task[], collapsed: Set<string>): Row[] {
  const byParent = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const t of tasks) {
    if (t.parent_task) {
      const arr = byParent.get(t.parent_task) || [];
      arr.push(t);
      byParent.set(t.parent_task, arr);
    } else {
      roots.push(t);
    }
  }
  const sortFn = (a: Task, b: Task) => a.sort_order - b.sort_order;
  roots.sort(sortFn);
  byParent.forEach((arr) => arr.sort(sortFn));

  const spans = new Map<string, { s: number | null; e: number | null }>();
  const computeSpan = (t: Task): { s: number | null; e: number | null } => {
    const cached = spans.get(t.name);
    if (cached) return cached;
    let s = toDay(t.start_date);
    let e = toDay(t.end_date);
    for (const c of byParent.get(t.name) || []) {
      const cs = computeSpan(c);
      if (cs.s !== null && (s === null || cs.s < s)) s = cs.s;
      if (cs.e !== null && (e === null || cs.e > e)) e = cs.e;
    }
    const out = { s, e };
    spans.set(t.name, out);
    return out;
  };

  const rows: Row[] = [];
  const walk = (list: Task[], depth: number) => {
    for (const t of list) {
      const span = computeSpan(t);
      rows.push({ task: t, depth, start: span.s, end: span.e });
      if (!collapsed.has(t.name)) walk(byParent.get(t.name) || [], depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}

export function GanttChart({
  tasks,
  displayColumns = [],
  pxPerDay,
  readOnly = false,
  selected = null,
  onSelect,
  onDatesChange,
  svgId,
  colorField = null,
}: GanttChartProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const rows = useMemo(() => buildRows(tasks, collapsed), [tasks, collapsed]);
  const hasChildren = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach((t) => t.parent_task && s.add(t.parent_task));
    return s;
  }, [tasks]);

  const { minDay, maxDay } = useMemo(() => {
    let min: number | null = null;
    let max: number | null = null;
    for (const t of tasks) {
      for (const d of [toDay(t.start_date), toDay(t.actual_start)]) {
        if (d !== null && (min === null || d < min)) min = d;
      }
      for (const d of [toDay(t.end_date), toDay(t.actual_end)]) {
        if (d !== null && (max === null || d > max)) max = d;
      }
    }
    const today = todayIndex();
    if (min === null) min = today - 7;
    if (max === null) max = today + 21;
    return { minDay: min - 4, maxDay: max + 8 };
  }, [tasks]);

  const totalDays = maxDay - minDay + 1;
  const chartW = Math.max(400, Math.ceil(totalDays * pxPerDay));
  const chartH = rows.length * ROW_H;
  const x = useCallback((day: number) => (day - minDay) * pxPerDay, [minDay, pxPerDay]);

  // --- axis ticks ---
  const ticks = useMemo(() => {
    const major: { x: number; label: string }[] = [];
    const minor: { x: number; label?: string }[] = [];
    if (pxPerDay >= 18) {
      // day scale: minor per day, major per week/month boundary
      for (let d = minDay; d <= maxDay; d++) {
        const dt = dayDate(d);
        minor.push({ x: x(d), label: pxPerDay >= 24 ? String(dt.getUTCDate()) : undefined });
        if (dt.getUTCDate() === 1) major.push({ x: x(d), label: fmtMonth(d) });
      }
      if (!major.length || major[0].x > 40) major.unshift({ x: 0, label: fmtMonth(minDay) });
    } else if (pxPerDay >= 5) {
      // week scale
      for (let d = minDay; d <= maxDay; d++) {
        const dt = dayDate(d);
        if (dt.getUTCDay() === 1) minor.push({ x: x(d), label: fmtShort(d) });
        if (dt.getUTCDate() === 1) major.push({ x: x(d), label: fmtMonth(d) });
      }
      if (!major.length || major[0].x > 60) major.unshift({ x: 0, label: fmtMonth(minDay) });
    } else {
      // month scale
      for (let d = minDay; d <= maxDay; d++) {
        const dt = dayDate(d);
        if (dt.getUTCDate() === 1) minor.push({ x: x(d), label: fmtMonth(d) });
      }
      if (!minor.length || minor[0].x > 80) minor.unshift({ x: 0, label: fmtMonth(minDay) });
    }
    return { major, minor };
  }, [minDay, maxDay, pxPerDay, x]);

  // --- drag handling ---
  const beginDrag = (e: React.PointerEvent, row: Row, mode: DragState["mode"]) => {
    if (readOnly || !onDatesChange) return;
    const s = toDay(row.task.start_date);
    const en = toDay(row.task.end_date);
    if (s === null || en === null) return;
    e.stopPropagation();
    e.preventDefault();
    const state: DragState = {
      name: row.task.name,
      mode,
      originX: e.clientX,
      start: s,
      end: en,
      deltaDays: 0,
    };
    dragRef.current = state;
    setDrag(state);
    const onMove = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const delta = Math.round((ev.clientX - cur.originX) / pxPerDay);
      if (delta !== cur.deltaDays) {
        const next = { ...cur, deltaDays: delta };
        dragRef.current = next;
        setDrag(next);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const cur = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!cur || cur.deltaDays === 0) return;
      let ns = cur.start;
      let ne = cur.end;
      if (cur.mode === "move") {
        ns += cur.deltaDays;
        ne += cur.deltaDays;
      } else if (cur.mode === "left") {
        ns = Math.min(cur.start + cur.deltaDays, ne);
      } else {
        ne = Math.max(cur.end + cur.deltaDays, ns);
      }
      onDatesChange(cur.name, fromDay(ns), fromDay(ne));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const dragged = (row: Row): { s: number; e: number } | null => {
    if (!drag || drag.name !== row.task.name) return null;
    let s = drag.start;
    let e = drag.end;
    if (drag.mode === "move") {
      s += drag.deltaDays;
      e += drag.deltaDays;
    } else if (drag.mode === "left") {
      s = Math.min(s + drag.deltaDays, e);
    } else {
      e = Math.max(e + drag.deltaDays, s);
    }
    return { s, e };
  };

  const today = todayIndex();
  const leftW = NAME_COL_W + displayColumns.length * EXTRA_COL_W;

  const catValue = useCallback(
    (t: Task): string | null => {
      if (!colorField) return null;
      const v = t.fields?.[colorField];
      return v == null ? null : String(v);
    },
    [colorField]
  );

  const legend = useMemo(() => {
    if (!colorField) return [];
    return legendEntries(tasks.filter((t) => t.kind !== "group").map(catValue));
  }, [tasks, colorField, catValue]);

  return (
    <div id="og-gantt-root">
      {legend.length > 0 && (
        <div className="og-legend">
          {legend.map((e) => (
            <span key={e.value} className="og-legend-item">
              <span className="og-legend-chip" style={{ background: e.color }} />
              {e.value}
            </span>
          ))}
        </div>
      )}
      <div className="og-gantt">
      <div className="og-gantt-left" style={{ width: leftW }}>
        <div className="og-gantt-left-header" style={{ height: HEADER_H }}>
          <div className="og-cell" style={{ width: NAME_COL_W }}>
            Task
          </div>
          {displayColumns.map((c) => (
            <div key={c} className="og-cell" style={{ width: EXTRA_COL_W }}>
              {c}
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <div
            key={row.task.name}
            className="og-gantt-row"
            style={{ height: ROW_H }}
            data-kind={row.task.kind}
            data-selected={selected === row.task.name}
            onClick={() => onSelect?.(row.task.name)}
          >
            <div
              className="og-cell"
              style={{ width: NAME_COL_W, paddingLeft: 10 + row.depth * 18, display: "flex", alignItems: "center" }}
            >
              {hasChildren.has(row.task.name) ? (
                <span
                  className="og-caret"
                  data-collapsed={collapsed.has(row.task.name)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.task.name)) next.delete(row.task.name);
                      else next.add(row.task.name);
                      return next;
                    });
                  }}
                >
                  ▾
                </span>
              ) : (
                <span style={{ width: 20, flex: "none" }} />
              )}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{row.task.task_name}</span>
            </div>
            {displayColumns.map((c) => (
              <div key={c} className="og-cell og-cell--extra" style={{ width: EXTRA_COL_W }}>
                {row.task.fields?.[c] != null ? String(row.task.fields[c]) : ""}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="og-gantt-scroll">
        <svg
          id={svgId}
          className="og-gantt-svg"
          width={chartW}
          height={HEADER_H + chartH}
          onClick={() => onSelect?.(null)}
        >
          {/* header */}
          <g>
            <rect x={0} y={0} width={chartW} height={HEADER_H} fill="var(--color-background-surface)" />
            {ticks.major.map((t, i) => (
              <text
                key={`M${i}`}
                x={t.x + 6}
                y={16}
                fontSize={11}
                fontWeight={600}
                fill="var(--color-text-secondary)"
              >
                {t.label}
              </text>
            ))}
            {ticks.minor.map((t, i) =>
              t.label ? (
                <text key={`m${i}`} x={t.x + 4} y={36} fontSize={10} fill="var(--color-text-secondary)">
                  {t.label}
                </text>
              ) : null
            )}
            <line x1={0} y1={HEADER_H - 0.5} x2={chartW} y2={HEADER_H - 0.5} stroke="var(--color-border)" />
          </g>

          {/* grid */}
          <g>
            {ticks.minor.map((t, i) => (
              <line
                key={i}
                x1={t.x}
                y1={HEADER_H}
                x2={t.x}
                y2={HEADER_H + chartH}
                stroke="var(--color-border)"
                strokeOpacity={0.35}
              />
            ))}
            {rows.map((_, i) => (
              <line
                key={i}
                x1={0}
                y1={HEADER_H + (i + 1) * ROW_H - 0.5}
                x2={chartW}
                y2={HEADER_H + (i + 1) * ROW_H - 0.5}
                stroke="var(--color-border)"
                strokeOpacity={0.3}
              />
            ))}
          </g>

          {/* today line */}
          {today >= minDay && today <= maxDay && (
            <g>
              <line
                x1={x(today) + pxPerDay / 2}
                y1={HEADER_H - 6}
                x2={x(today) + pxPerDay / 2}
                y2={HEADER_H + chartH}
                stroke="var(--color-error)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <circle cx={x(today) + pxPerDay / 2} cy={HEADER_H - 6} r={3} fill="var(--color-error)" />
            </g>
          )}

          {/* bars */}
          {rows.map((row, i) => {
            const y = HEADER_H + i * ROW_H;
            const live = dragged(row);
            const s = live ? live.s : row.start;
            const e = live ? live.e : row.end;
            if (s === null || e === null) return null;
            const bx = x(s);
            const bw = Math.max(pxPerDay, (e - s + 1) * pxPerDay);
            const isGroup = row.task.kind === "group";
            const isSel = selected === row.task.name;

            if (isGroup) {
              return (
                <g
                  key={row.task.name}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSelect?.(row.task.name);
                  }}
                >
                  <path
                    d={`M ${bx} ${y + 12} H ${bx + bw} v 8 l -6 -5 H ${bx + 6} l -6 5 Z`}
                    fill="var(--color-text-secondary)"
                    opacity={0.75}
                  />
                </g>
              );
            }

            const aS = toDay(row.task.actual_start);
            const aE = toDay(row.task.actual_end);
            const progress = Math.max(0, Math.min(100, row.task.progress || 0));
            const catColor = categoryColor(catValue(row.task));

            return (
              <g
                key={row.task.name}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelect?.(row.task.name);
                }}
              >
                <rect
                  className="og-bar"
                  x={bx}
                  y={y + 8}
                  width={bw}
                  height={ROW_H - 16}
                  rx={5}
                  fill={catColor ?? "var(--color-accent-muted)"}
                  fillOpacity={catColor ? 0.55 : 1}
                  stroke={isSel ? "var(--color-accent)" : "transparent"}
                  strokeWidth={isSel ? 2 : 0}
                  onPointerDown={(ev) => beginDrag(ev, row, "move")}
                />
                {progress > 0 && (
                  <rect
                    x={bx}
                    y={y + 8}
                    width={(bw * progress) / 100}
                    height={ROW_H - 16}
                    rx={5}
                    fill={catColor ? darker(catColor) : "var(--color-accent)"}
                    pointerEvents="none"
                  />
                )}
                {aS !== null && aE !== null && (
                  <rect
                    x={x(aS)}
                    y={y + ROW_H - 9}
                    width={Math.max(3, (aE - aS + 1) * pxPerDay)}
                    height={4}
                    rx={2}
                    fill="var(--color-success)"
                    pointerEvents="none"
                  />
                )}
                {!readOnly && (
                  <>
                    <rect
                      className="og-bar-handle"
                      x={bx - 4}
                      y={y + 6}
                      width={9}
                      height={ROW_H - 12}
                      onPointerDown={(ev) => beginDrag(ev, row, "left")}
                    />
                    <rect
                      className="og-bar-handle"
                      x={bx + bw - 5}
                      y={y + 6}
                      width={9}
                      height={ROW_H - 12}
                      onPointerDown={(ev) => beginDrag(ev, row, "right")}
                    />
                  </>
                )}
                {live && (
                  <text x={bx + 4} y={y + 5} fontSize={10} fill="var(--color-text-secondary)">
                    {fromDay(live.s)} → {fromDay(live.e)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        </div>
      </div>
    </div>
  );
}

import { useMemo } from "react";
import { toDay } from "../lib/dates";
import { categoryColor } from "../lib/colors";
import type { SparkSegment } from "../lib/types";

const LANES = 5;

/**
 * Mini timeline sparkline for gantt cards: leaf segments laid out on a few
 * compact lanes, coloured by their phase/status via the shared palette.
 */
export function Sparkline({ segments }: { segments: SparkSegment[] }) {
  const bars = useMemo(() => {
    const out: { s: number; e: number; color: string }[] = [];
    for (const seg of segments) {
      const s = toDay(seg.start);
      const e = toDay(seg.end);
      if (s === null || e === null) continue;
      out.push({
        s,
        e: Math.max(s, e),
        color: categoryColor(seg.color_value) ?? "var(--color-accent)",
      });
    }
    return out;
  }, [segments]);

  if (!bars.length) {
    return <div className="og-spark og-spark--empty">No dated tasks yet</div>;
  }

  const min = Math.min(...bars.map((b) => b.s));
  const max = Math.max(...bars.map((b) => b.e));
  const span = Math.max(1, max - min + 1);

  return (
    <div className="og-spark" aria-hidden="true">
      {bars.map((b, i) => (
        <span
          key={i}
          className="og-spark-bar"
          style={{
            left: `${((b.s - min) / span) * 100}%`,
            width: `${Math.max(2, ((b.e - b.s + 1) / span) * 100)}%`,
            top: `${(i % LANES) * 20}%`,
            background: b.color,
          }}
        />
      ))}
    </div>
  );
}

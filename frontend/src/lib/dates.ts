const DAY = 86400000;

/** Astryx DateInput's ISODateString template-literal type. */
export type ISODate =
  `${number}${number}${number}${number}-${number}${number}-${number}${number}`;

/** Cast a plain string date to the Astryx ISODateString type (empty → undefined). */
export function asISO(s: string): ISODate | undefined {
  return s ? (s as ISODate) : undefined;
}

/** Parse YYYY-MM-DD into day index (days since epoch, UTC). Null if invalid. */
export function toDay(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY);
}

/** Day index back to YYYY-MM-DD. */
export function fromDay(d: number): string {
  return new Date(d * DAY).toISOString().slice(0, 10);
}

export function todayIndex(): number {
  const now = new Date();
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY);
}

export function dayDate(d: number): Date {
  return new Date(d * DAY);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtShort(d: number): string {
  const dt = dayDate(d);
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

export function fmtMonth(d: number): string {
  const dt = dayDate(d);
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/** Loose parse of arbitrary spreadsheet cell text into a day index (preview only). */
export function looseDay(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const iso = toDay(s);
  if (iso !== null) return iso;
  // DD/MM/YYYY or MM/DD/YYYY — assume day-first when first part > 12
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    let [, a, b, y] = m;
    let day = +a;
    let mon = +b;
    if (mon > 12 && day <= 12) [day, mon] = [mon, day];
    const year = +y < 100 ? 2000 + +y : +y;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31)
      return Math.round(Date.UTC(year, mon - 1, day) / DAY);
    return null;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return Math.round(t / DAY);
  return null;
}

export interface TimelineWindowInput {
  start: Date;
  end: Date;
  pxPerDay: number;
  viewportWidth: number;
  scrollLeft?: number;
  overscanDays?: number;
}

export function calculateTimelineWindow(input: TimelineWindowInput) {
  const overscanDays = input.overscanDays ?? 14;
  const scrollLeft = input.scrollLeft ?? 0;
  const visibleStartOffset = Math.max(0, Math.floor(scrollLeft / input.pxPerDay) - overscanDays);
  const visibleDays = Math.ceil(input.viewportWidth / input.pxPerDay) + overscanDays * 2;
  const start = new Date(input.start);
  start.setDate(start.getDate() + visibleStartOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + visibleDays);
  return {
    start: input.start,
    end: input.end,
    visibleStart: start,
    visibleEnd: end,
    totalDays: Math.max(1, Math.round((input.end.getTime() - input.start.getTime()) / 86_400_000) + 1),
    width: Math.max(1, Math.round((input.end.getTime() - input.start.getTime()) / 86_400_000) + 1) * input.pxPerDay
  };
}

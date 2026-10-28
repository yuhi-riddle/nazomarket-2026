import type { PlayMinutes } from "../types.ts";

export function formatPlayMinutes(range: PlayMinutes | null): string {
  if (range === null) return "未確認";
  const hours = range.min >= 120 && range.min % 30 === 0 && (range.max === null || range.max % 30 === 0);
  const min = hours ? range.min / 60 : range.min;
  const max = range.max === null ? null : hours ? range.max / 60 : range.max;
  const unit = hours ? "時間" : "分";
  if (max === null) return `${min}${unit}〜`;
  return max === min ? `${min}${unit}` : `${min}〜${max}${unit}`;
}

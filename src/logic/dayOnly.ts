import type { Day } from "../types.ts";

export function dayOnlyLabel(days: readonly Day[]): "土曜のみ" | "日曜のみ" | null {
  if (days.length !== 1) return null;
  if (days[0] === "sat") return "土曜のみ";
  if (days[0] === "sun") return "日曜のみ";
  return null;
}

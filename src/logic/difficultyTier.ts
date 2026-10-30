export type DifficultyTier = "1" | "2" | "3" | "4" | "5" | "unknown";

export function difficultyTier(level: number | null | undefined): DifficultyTier {
  if (level === null || level === undefined || !Number.isInteger(level) || level < 1 || level > 5) {
    return "unknown";
  }
  return String(level) as DifficultyTier;
}

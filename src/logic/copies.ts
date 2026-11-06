const LEADING_COPIES = /^\s*(?:限定\s*)?(\d[\d,]*)\s*(部|個|セット)(?!\s*以上)/;
const TOTAL_COPIES = /合計\s*(\d[\d,]*)\s*(部|個|セット)(?!\s*以上)/;

export function copiesLabel(limited: string | null): string | null {
  if (!limited) return null;

  const match = LEADING_COPIES.exec(limited) ?? TOTAL_COPIES.exec(limited);
  return match ? `限定${match[1]}${match[2]}` : null;
}

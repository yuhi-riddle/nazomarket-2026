import type { Day } from "../../src/types.ts";

export type OfficialLinks = {
  site: string[];
  x: string[];
  instagram: string[];
};

export type OfficialBoothRow = {
  id: string;
  name: string;
  days: Day[];
  dayLabel: string;
  summary: string;
  links: OfficialLinks;
};

export type OfficialProductRow = {
  id: string;
  boothId: string;
  name: string;
  price: number | null;
  priceText: string;
  description: string;
  pickup: boolean;
  isNew: boolean;
  imageCount: number | null;
};

export type OfficialChange = {
  id: string;
  fields: string[];
};

export type OfficialDiffSection = {
  added: string[];
  removed: string[];
  changed: OfficialChange[];
};

export type OfficialDiff = {
  booths: OfficialDiffSection;
  products: OfficialDiffSection;
};

export type OfficialSnapshot = {
  booths: Array<{ id: string }>;
  products: Array<{ id: string }>;
};

function cleanPriceText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

export function parsePrice(value: string): number | null {
  let normalized = cleanPriceText(value);
  normalized = normalized.replace(/^¥\s*/, "").replace(/\s*円$/, "").replace(/,/g, "");
  if (!/^\d+$/.test(normalized)) return null;

  const price = Number(normalized);
  return Number.isSafeInteger(price) ? price : null;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    if (lower === "nbsp") return " ";

    const point = lower.startsWith("#x")
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    if (!Number.isInteger(point) || point < 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
      return entity;
    }
    return String.fromCodePoint(point);
  });
}

export function htmlToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/\r\n?/g, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

export function parseDays(label: string): Day[] {
  const normalized = label.trim();
  if (normalized === "両日出展") return ["sat", "sun"];
  if (normalized === "土曜出展") return ["sat"];
  if (normalized === "日曜出展") return ["sun"];
  throw new Error(`不明な出展日: ${label}`);
}

function isDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function cleanLink(value: string): { url: string; category: keyof OfficialLinks } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { url: value, category: "site" };
  }

  let category: keyof OfficialLinks = "site";
  if (isDomain(url.hostname, "x.com") || isDomain(url.hostname, "twitter.com")) {
    category = "x";
    url.search = "";
  } else if (isDomain(url.hostname, "instagram.com")) {
    category = "instagram";
  } else {
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["srsltid", "sa", "source", "ust", "usg"].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
  }
  url.hash = "";
  return { url: url.toString(), category };
}

export function classifyLinks(values: string[]): OfficialLinks {
  const links: OfficialLinks = { site: [], x: [], instagram: [] };
  const seen: Record<keyof OfficialLinks, Set<string>> = {
    site: new Set(),
    x: new Set(),
    instagram: new Set(),
  };

  for (const value of values) {
    for (const candidate of value.split(",")) {
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      const cleaned = cleanLink(trimmed);
      if (seen[cleaned.category].has(cleaned.url)) continue;
      seen[cleaned.category].add(cleaned.url);
      links[cleaned.category].push(cleaned.url);
    }
  }
  return links;
}

function tsvRows(value: string, columnCount: number): string[][] {
  const lines = value.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  return lines.slice(1).flatMap((line) => {
    if (!line.trim()) return [];
    const columns = line.split("\t");
    while (columns.length < columnCount) columns.push("");
    return [columns];
  });
}

export function parseBoothTsv(value: string): OfficialBoothRow[] {
  return tsvRows(value, 12).map((columns) => {
    const dayLabel = columns[1].trim();
    return {
      id: columns[0].trim(),
      name: columns[2].trim(),
      days: parseDays(dayLabel),
      dayLabel,
      summary: htmlToText(columns[3]),
      links: classifyLinks([columns[4], columns[5], columns[6], columns[8], columns[9], columns[10]]),
    };
  });
}

function parseImageCount(value: string): number | null {
  const normalized = value.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  const count = Number(normalized);
  return Number.isSafeInteger(count) ? count : null;
}

export function parseProductTsv(value: string): OfficialProductRow[] {
  return tsvRows(value, 8).map((columns) => ({
    id: columns[0].trim(),
    boothId: columns[1].trim(),
    name: columns[2].trim(),
    price: parsePrice(columns[3]),
    priceText: cleanPriceText(columns[3]),
    description: htmlToText(columns[4]),
    pickup: columns[5].trim() === "1",
    isNew: columns[6].trim() === "1",
    imageCount: parseImageCount(columns[7]),
  }));
}

function diffRows<T extends { id: string }>(previous: readonly T[], current: readonly T[]): OfficialDiffSection {
  const previousById = new Map(previous.map((row) => [row.id, row]));
  const currentById = new Map(current.map((row) => [row.id, row]));
  const added = current.filter((row) => !previousById.has(row.id)).map((row) => row.id);
  const removed = previous.filter((row) => !currentById.has(row.id)).map((row) => row.id);
  const changed: OfficialChange[] = [];

  for (const row of current) {
    const oldRow = previousById.get(row.id);
    if (!oldRow) continue;
    const oldRecord = oldRow as Record<string, unknown>;
    const newRecord = row as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(newRecord), ...Object.keys(oldRecord)])].filter((key) => key !== "id");
    const fields = keys.filter((key) => JSON.stringify(oldRecord[key]) !== JSON.stringify(newRecord[key]));
    if (fields.length > 0) changed.push({ id: row.id, fields });
  }

  return { added, removed, changed };
}

export function diffOfficial(previous: OfficialSnapshot | null, next: OfficialSnapshot): OfficialDiff {
  return {
    booths: diffRows(previous?.booths ?? [], next.booths),
    products: diffRows(previous?.products ?? [], next.products),
  };
}

export function formatDiffMarkdown(diff: OfficialDiff, previousDate: string | null, currentDate: string): string {
  const lines = [
    "# 公式データの差分",
    "",
    `- 前回取得日: ${previousDate ?? "なし（初回）"}`,
    `- 今回取得日: ${currentDate}`,
    "",
  ];

  const sections: Array<[string, OfficialDiffSection]> = [
    ["出展団体", diff.booths],
    ["ピックアップ商品", diff.products],
  ];
  let hasChanges = false;
  for (const [title, section] of sections) {
    lines.push(`## ${title}（追加 ${section.added.length} / 削除 ${section.removed.length} / 変更 ${section.changed.length}）`);
    if (section.added.length + section.removed.length + section.changed.length === 0) {
      lines.push("- 変更なし");
    } else {
      hasChanges = true;
      for (const id of section.added) lines.push(`- 追加: ${id}`);
      for (const id of section.removed) lines.push(`- 削除: ${id}`);
      for (const change of section.changed) lines.push(`- 変更: ${change.id}（${change.fields.join(", ")}）`);
    }
    lines.push("");
  }
  if (!hasChanges) lines.splice(5, 0, "- 全体: 変更なし", "");
  return lines.join("\n").trimEnd();
}

export function getJstDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  let year = "";
  let month = "";
  let day = "";
  for (const part of parts) {
    if (part.type === "year") year = part.value;
    if (part.type === "month") month = part.value;
    if (part.type === "day") day = part.value;
  }
  return `${year}-${month}-${day}`;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function resolveFetchDate(args: readonly string[], today: string): string {
  if (!isIsoDate(today)) throw new Error(`今日の日付が不正です: ${today}`);
  if (args.length === 0) return today;
  if (args.length === 2 && args[0] === "--date" && isIsoDate(args[1])) return args[1];
  throw new Error("使い方: node scripts/fetch-official.ts [--date YYYY-MM-DD]");
}

export function selectPreviousDate(directoryNames: readonly string[], currentDate: string): string | null {
  if (!isIsoDate(currentDate)) throw new Error(`日付が不正です: ${currentDate}`);
  return directoryNames
    .filter((name) => isIsoDate(name) && name < currentDate)
    .sort((a, b) => b.localeCompare(a))[0] ?? null;
}

export function getSnapshotRelativePath(date: string): string {
  if (!isIsoDate(date)) throw new Error(`日付が不正です: ${date}`);
  return `data/raw/${date}`;
}

export function formatMapHashStatus(previousHash: string | null, currentHash: string, hasPreviousSnapshot: boolean): string {
  if (!hasPreviousSnapshot) return "- マップ画像: 初回取得（比較対象なし）";
  if (previousHash === null) return "- マップ画像: 比較不能（前回ハッシュなし）";
  return `- マップ画像: ${previousHash === currentHash ? "変更なし" : "変更あり"}`;
}

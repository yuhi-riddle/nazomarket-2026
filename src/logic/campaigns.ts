import type { Campaign } from "../types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const japanDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric",
});

function deadlineEnd(endsAt: string): number {
  if (endsAt.length === 10) return Date.parse(endsAt + "T00:00:00+09:00") + DAY_MS;
  return Date.parse(endsAt + ":00+09:00") + 60_000;
}

export function isCampaignActive(endsAt: string | null, now: Date): boolean {
  return endsAt === null || now.getTime() < deadlineEnd(endsAt);
}

export function listActiveCampaigns(campaigns: Campaign[], now: Date): { withDeadline: Campaign[]; noDeadline: Campaign[] } {
  const dated: Array<{ campaign: Campaign; end: number; index: number }> = [];
  const noDeadline: Campaign[] = [];
  const nowTime = now.getTime();
  for (let index = 0; index < campaigns.length; index++) {
    const campaign = campaigns[index];
    if (campaign.endsAt === null) {
      noDeadline.push(campaign);
      continue;
    }
    const end = deadlineEnd(campaign.endsAt);
    if (nowTime < end) dated.push({ campaign, end, index });
  }
  dated.sort((a, b) => a.end - b.end || a.index - b.index);
  return { withDeadline: dated.map(({ campaign }) => campaign), noDeadline };
}

export type CampaignFilter = "all" | Campaign["kind"];

export function filterActiveByKind(
  active: { withDeadline: Campaign[]; noDeadline: Campaign[] },
  filter: CampaignFilter,
): { withDeadline: Campaign[]; noDeadline: Campaign[] } {
  if (filter === "all") return active;
  return {
    withDeadline: active.withDeadline.filter((campaign) => campaign.kind === filter),
    noDeadline: active.noDeadline.filter((campaign) => campaign.kind === filter),
  };
}

export function countByKind(active: { withDeadline: Campaign[]; noDeadline: Campaign[] }): Record<CampaignFilter, number> {
  const counts: Record<CampaignFilter, number> = { all: 0, bonus: 0, giveaway: 0, discount: 0, other: 0 };
  for (const items of [active.withDeadline, active.noDeadline]) {
    for (const campaign of items) {
      counts.all++;
      counts[campaign.kind]++;
    }
  }
  return counts;
}

export function countActive(campaigns: Campaign[], now: Date): number {
  let count = 0;
  for (const campaign of campaigns) if (isCampaignActive(campaign.endsAt, now)) count++;
  return count;
}

export function countDueSoon(campaigns: Campaign[], now: Date, days = 7): number {
  const limit = days * DAY_MS;
  let count = 0;
  for (const campaign of campaigns) {
    if (campaign.endsAt === null) continue;
    const remaining = deadlineEnd(campaign.endsAt) - now.getTime();
    if (remaining > 0 && remaining <= limit) count++;
  }
  return count;
}

function japanDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = japanDateFormatter.formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")!.value),
    month: Number(parts.find((part) => part.type === "month")!.value),
    day: Number(parts.find((part) => part.type === "day")!.value),
  };
}

export function deadlineLabel(endsAt: string, now: Date): { date: string; remaining: string } {
  const [datePart, timePart] = endsAt.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getUTCDay()];
  const label = `${month}/${day}(${weekday})`;
  const dateLabel = timePart ? `${label} ${timePart}まで` : `${label}まで`;
  const current = japanDateParts(now);
  const currentDay = Date.UTC(current.year, current.month - 1, current.day);
  const deadlineDay = Date.UTC(year, month - 1, day);
  const difference = Math.round((deadlineDay - currentDay) / DAY_MS);
  const remaining = difference === 0 ? "今日まで" : difference === 1 ? "明日まで" : `あと${difference}日`;
  return { date: dateLabel, remaining };
}

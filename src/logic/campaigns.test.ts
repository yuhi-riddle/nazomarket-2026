import { describe, expect, it } from "vitest";
import type { Campaign } from "../types.ts";
import { countDueSoon, deadlineLabel, isCampaignActive, listActiveCampaigns } from "./campaigns.ts";

// 日本時間の日時を Date にする（例: jst("2026-11-01T23:59")）
const jst = (local: string) => new Date(local + ":00+09:00");

const campaign = (id: string, endsAt: string | null): Campaign => ({
  id,
  boothId: "no01",
  productIds: [],
  kind: "giveaway",
  title: id,
  detail: "",
  endsAt,
  days: [],
  limit: null,
  sources: [{ url: "https://example.com/" + id, retrievedAt: "2026-10-30" }],
});

describe("isCampaignActive", () => {
  it("締切のないものは常に出す", () => {
    expect(isCampaignActive(null, jst("2030-01-01T00:00"))).toBe(true);
  });

  it("日付だけの締切は、日本時間のその日の終わりまで出す", () => {
    expect(isCampaignActive("2026-11-01", jst("2026-11-01T23:59"))).toBe(true);
    expect(isCampaignActive("2026-11-01", new Date("2026-11-01T14:59:59.999Z"))).toBe(true);
    expect(isCampaignActive("2026-11-01", jst("2026-11-02T00:00"))).toBe(false);
  });

  it("時刻つきの締切は、その分のあいだまで出す", () => {
    expect(isCampaignActive("2026-11-02T18:00", jst("2026-11-02T18:00"))).toBe(true);
    expect(isCampaignActive("2026-11-02T18:00", new Date("2026-11-02T09:00:59.999Z"))).toBe(true);
    expect(isCampaignActive("2026-11-02T18:00", jst("2026-11-02T18:01"))).toBe(false);
  });

  it("端末の時差に関係なく日本時間で比べる（UTC では前日でも日本時間で翌日なら締切後）", () => {
    // UTC 2026-11-01T15:30 は日本時間 11/2 0:30
    expect(isCampaignActive("2026-11-01", new Date("2026-11-01T15:30:00Z"))).toBe(false);
  });
});

describe("listActiveCampaigns", () => {
  const now = jst("2026-10-30T12:00");
  const campaigns = [
    campaign("open-1", null),
    campaign("late", "2026-11-06T23:59"),
    campaign("past", "2026-10-29"),
    campaign("soon-date", "2026-11-01"),
    campaign("open-2", null),
    campaign("soon-time", "2026-11-01T20:00"),
  ];

  it("締切を過ぎたものを外し、締切ありは近い順、締切なしはデータの順に分ける", () => {
    const result = listActiveCampaigns(campaigns, now);
    expect(result.withDeadline.map((c) => c.id)).toEqual(["soon-time", "soon-date", "late"]);
    expect(result.noDeadline.map((c) => c.id)).toEqual(["open-1", "open-2"]);
  });

  it("0件なら両方とも空", () => {
    expect(listActiveCampaigns([], now)).toEqual({ withDeadline: [], noDeadline: [] });
    expect(listActiveCampaigns([campaign("past", "2026-10-29")], now)).toEqual({ withDeadline: [], noDeadline: [] });
  });
});

describe("countDueSoon", () => {
  const now = jst("2026-10-30T12:00");

  it("締切が7日以内に来る受付中のものだけ数える", () => {
    const campaigns = [
      campaign("open", null),
      campaign("past", "2026-10-30T11:00"),
      // 時刻つきの締切はその分の終わりまで有効なので、11:59 締切は 12:00 に終わる＝ちょうど7日後
      campaign("in-7days", "2026-11-06T11:59"),
      campaign("over-7days", "2026-11-06T12:00"),
      campaign("tomorrow", "2026-10-31"),
    ];
    expect(countDueSoon(campaigns, now)).toBe(2);
  });
});

describe("deadlineLabel", () => {
  it("締切の日付・曜日・時刻と、日本時間の暦で数えた残り日数を返す", () => {
    expect(deadlineLabel("2026-11-01T23:59", jst("2026-10-30T23:00"))).toEqual({ date: "11/1(日) 23:59まで", remaining: "あと2日" });
    expect(deadlineLabel("2026-11-01", jst("2026-10-31T01:00"))).toEqual({ date: "11/1(日)まで", remaining: "明日まで" });
    expect(deadlineLabel("2026-11-02T18:00", jst("2026-11-02T09:00"))).toEqual({ date: "11/2(月) 18:00まで", remaining: "今日まで" });
  });

  it("時刻は0埋めした2桁で出す", () => {
    expect(deadlineLabel("2026-11-04T09:05", jst("2026-10-30T12:00")).date).toBe("11/4(水) 09:05まで");
  });
});

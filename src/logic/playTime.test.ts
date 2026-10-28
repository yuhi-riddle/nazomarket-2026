import { describe, expect, it } from "vitest";
import { formatPlayMinutes } from "./playTime.ts";

describe("formatPlayMinutes（所要時間の表示）", () => {
  it.each([
    [{ min: 45, max: 45 }, "45分"],
    [{ min: 90, max: 90 }, "90分"],
    [{ min: 120, max: 120 }, "2時間"],
    [{ min: 45, max: 120 }, "45〜120分"],
    [{ min: 30, max: 60 }, "30〜60分"],
    [{ min: 60, max: 90 }, "60〜90分"],
    [{ min: 120, max: 240 }, "2〜4時間"],
    [{ min: 150, max: 240 }, "2.5〜4時間"],
    [{ min: 60, max: null }, "60分〜"],
    [{ min: 90, max: null }, "90分〜"],
    [{ min: 210, max: null }, "3.5時間〜"],
    [{ min: 240, max: null }, "4時間〜"],
    [{ min: 130, max: 130 }, "130分"],
  ])("%j → %s（2時間以上で30分刻みなら時間、それ以外は分）", (range, text) => {
    expect(formatPlayMinutes(range)).toBe(text);
  });
  it("不明は「未確認」", () => {
    expect(formatPlayMinutes(null)).toBe("未確認");
  });
});

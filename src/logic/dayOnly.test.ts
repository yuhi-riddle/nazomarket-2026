import { describe, expect, it } from "vitest";
import { dayOnlyLabel } from "./dayOnly.ts";

describe("dayOnlyLabel", () => {
  it("土曜だけなら「土曜のみ」", () => {
    expect(dayOnlyLabel(["sat"])).toBe("土曜のみ");
  });

  it("日曜だけなら「日曜のみ」", () => {
    expect(dayOnlyLabel(["sun"])).toBe("日曜のみ");
  });

  it("両日や日付なしは出さない", () => {
    expect(dayOnlyLabel(["sat", "sun"])).toBeNull();
    expect(dayOnlyLabel([])).toBeNull();
  });
});

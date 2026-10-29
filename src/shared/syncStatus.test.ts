import { describe, expect, it } from "vitest";
import type { SharedSyncSnapshot } from "./types.ts";
import { sharedSyncIndicatorLabel } from "./syncStatus.ts";

const synced: SharedSyncSnapshot = {
  state: { revision: 2, budgetYen: null, items: [] },
  status: "idle",
  pendingOperations: [],
  conflict: null,
  error: null,
};

describe("shared sync indicator", () => {
  it("hides the indicator for a personal list", () => {
    expect(sharedSyncIndicatorLabel(synced, false)).toBeNull();
  });

  it("labels a completed sync", () => {
    expect(sharedSyncIndicatorLabel(synced, true)).toBe("共同リスト：同期済み");
  });

  it("shows the number of queued operations", () => {
    expect(sharedSyncIndicatorLabel({
      ...synced,
      pendingOperations: [
        { type: "set-budget", budgetYen: 1_000 },
        { type: "set-budget", budgetYen: 2_000 },
      ],
    }, true)).toBe("共同リスト：未送信2件");
  });

  it("asks the user to review a conflict", () => {
    expect(sharedSyncIndicatorLabel({ ...synced, status: "conflict" }, true)).toBe("共同リスト：要確認");
  });
});

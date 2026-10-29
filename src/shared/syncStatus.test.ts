import { describe, expect, it } from "vitest";
import type { SharedSyncSnapshot } from "./types.ts";
import {
  sharedSyncIndicatorLabel,
  shouldBlockSharedWritesDuringInitialConnection,
  shouldShowSharedRetryButton,
} from "./syncStatus.ts";

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

  it("labels the first connection while its state is loading", () => {
    expect(sharedSyncIndicatorLabel({
      ...synced,
      state: null,
      status: "syncing",
    }, true, true, true)).toBe("共同リスト：接続中");
  });

  it("blocks writes only while the initial shared state is still loading", () => {
    const loading: SharedSyncSnapshot = { ...synced, state: null, status: "syncing" };
    expect(shouldBlockSharedWritesDuringInitialConnection(loading, true)).toBe(true);
    expect(shouldBlockSharedWritesDuringInitialConnection({ ...loading, status: "offline" }, true)).toBe(false);
    expect(shouldBlockSharedWritesDuringInitialConnection({ ...loading, status: "error" }, true)).toBe(false);
    expect(shouldBlockSharedWritesDuringInitialConnection(synced, true)).toBe(false);
    expect(shouldBlockSharedWritesDuringInitialConnection(loading, false)).toBe(false);
  });

  it("shows a retry button for an offline sync with no queued operations", () => {
    expect(shouldShowSharedRetryButton({ ...synced, state: null, status: "offline" })).toBe(true);
    expect(shouldShowSharedRetryButton(synced)).toBe(false);
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

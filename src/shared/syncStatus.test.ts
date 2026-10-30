import { describe, expect, it } from "vitest";
import type { SharedSyncSnapshot } from "./types.ts";
import {
  sharedSyncIndicatorLabel,
  shouldBlockSharedWritesDuringInitialConnection,
  shouldShowSharedRetryButton,
} from "./syncStatus.ts";

const synced: SharedSyncSnapshot = {
  state: { revision: 2, members: [{ id: "member-1", name: "あき", budgetYen: null }], items: [] },
  status: "idle",
  pendingOperations: [],
  conflict: null,
  error: null,
};

describe("共有同期の表示", () => {
  it("個人リストでは同期表示を出さない", () => {
    expect(sharedSyncIndicatorLabel(synced, false)).toBeNull();
  });

  it("同期完了を表示する", () => {
    expect(sharedSyncIndicatorLabel(synced, true)).toBe("共同リスト：同期済み");
  });

  it("初回接続中は読み込み中と表示する", () => {
    expect(sharedSyncIndicatorLabel({
      ...synced,
      state: null,
      status: "syncing",
    }, true, true, true)).toBe("共同リスト：接続中");
  });

  it("初回状態の読み込み中だけ書き込みを止める", () => {
    const loading: SharedSyncSnapshot = { ...synced, state: null, status: "syncing" };
    expect(shouldBlockSharedWritesDuringInitialConnection(loading, true)).toBe(true);
    expect(shouldBlockSharedWritesDuringInitialConnection({ ...loading, status: "offline" }, true)).toBe(false);
    expect(shouldBlockSharedWritesDuringInitialConnection({ ...loading, status: "error" }, true)).toBe(false);
    expect(shouldBlockSharedWritesDuringInitialConnection(synced, true)).toBe(false);
    expect(shouldBlockSharedWritesDuringInitialConnection(loading, false)).toBe(false);
  });

  it("送信待ちがないオフライン状態では再試行を案内する", () => {
    expect(shouldShowSharedRetryButton({ ...synced, state: null, status: "offline" })).toBe(true);
    expect(shouldShowSharedRetryButton(synced)).toBe(false);
  });

  it("送信待ちのメンバー予算操作数を表示する", () => {
    expect(sharedSyncIndicatorLabel({
      ...synced,
      pendingOperations: [
        { type: "set-member-budget", memberId: "member-1", budgetYen: 1_000 },
        { type: "set-member-budget", memberId: "member-1", budgetYen: 2_000 },
      ],
    }, true)).toBe("共同リスト：未送信2件");
  });

  it("競合時は内容の確認を案内する", () => {
    expect(sharedSyncIndicatorLabel({ ...synced, status: "conflict" }, true)).toBe("共同リスト：要確認");
  });
});

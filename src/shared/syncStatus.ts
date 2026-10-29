import type { SharedSyncSnapshot } from "./types.ts";

export function sharedSyncIndicatorLabel(snapshot: SharedSyncSnapshot, active: boolean, writeBlocked = false): string | null {
  if (!active) return null;
  if (writeBlocked || snapshot.status === "conflict" || snapshot.status === "error") return "共同リスト：要確認";
  if (snapshot.pendingOperations.length > 0) {
    return "共同リスト：未送信" + snapshot.pendingOperations.length + "件";
  }
  if (snapshot.status === "offline") return "共同リスト：接続なし";
  if (snapshot.status === "syncing" || snapshot.state === null) return "共同リスト：同期中";
  return "共同リスト：同期済み";
}

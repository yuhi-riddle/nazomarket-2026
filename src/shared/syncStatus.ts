import type { SharedSyncSnapshot } from "./types.ts";

export function shouldBlockSharedWritesDuringInitialConnection(
  snapshot: SharedSyncSnapshot,
  initialConnectionPending: boolean,
): boolean {
  return initialConnectionPending
    && snapshot.state === null
    && snapshot.status !== "offline"
    && snapshot.status !== "error";
}

export function shouldShowSharedRetryButton(snapshot: SharedSyncSnapshot): boolean {
  return snapshot.status === "offline";
}

export function sharedSyncIndicatorLabel(
  snapshot: SharedSyncSnapshot,
  active: boolean,
  writeBlocked = false,
  connecting = false,
): string | null {
  if (!active) return null;
  if (connecting) return "共同リスト：接続中";
  if (writeBlocked || snapshot.status === "conflict" || snapshot.status === "error") return "共同リスト：要確認";
  if (snapshot.pendingOperations.length > 0) {
    return "共同リスト：未送信" + snapshot.pendingOperations.length + "件";
  }
  if (snapshot.status === "offline") return "共同リスト：接続なし";
  if (snapshot.status === "syncing" || snapshot.state === null) return "共同リスト：同期中";
  return "共同リスト：同期済み";
}

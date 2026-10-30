import { parseSharedOperation, parseSharedState } from "../../shared-worker/src/domain.ts";
import type { SharedListState, SharedOperation } from "../../shared-worker/src/domain.ts";

export type { SharedListItem, SharedMember, SharedListState, SharedOperation } from "../../shared-worker/src/domain.ts";

export type SharedRoomCredentials = {
  roomId: string;
  roomKey: string;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SharedClientError = {
  code: string;
  message: string;
  status?: number;
};

export type SharedSyncConflict = {
  baseRevision: number;
  currentRevision: number;
  operations: SharedOperation[];
};

export type SharedSyncSnapshot = {
  state: SharedListState | null;
  status: "idle" | "syncing" | "offline" | "conflict" | "error";
  pendingOperations: SharedOperation[];
  pendingOperationIds?: string[];
  conflict: SharedSyncConflict | null;
  error: SharedClientError | null;
};

export function isRoomId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

export function isRoomKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/iu.test(value);
}

export function normalizeSharedState(value: unknown): SharedListState | null {
  try {
    return parseSharedState(value);
  } catch {
    return null;
  }
}

export function normalizeSharedOperation(value: unknown): SharedOperation | null {
  try {
    return parseSharedOperation(value);
  } catch {
    return null;
  }
}

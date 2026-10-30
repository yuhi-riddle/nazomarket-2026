import type { SharedMember } from "../../shared-worker/src/domain.ts";
import type { StorageLike } from "./types.ts";

const ME_KEY_PREFIX = "nazomarket2026:shared:me:v1:";
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MEMBER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

function keyFor(roomId: string): string | null {
  return ROOM_ID_PATTERN.test(roomId) ? ME_KEY_PREFIX + roomId : null;
}

export function readSharedMe(storage: StorageLike, roomId: string): string | null {
  const key = keyFor(roomId);
  if (!key) return null;
  try {
    const memberId = storage.getItem(key);
    return memberId !== null && MEMBER_ID_PATTERN.test(memberId) ? memberId : null;
  } catch {
    return null;
  }
}

export function writeSharedMe(storage: StorageLike, roomId: string, memberId: string): void {
  const key = keyFor(roomId);
  if (!key || !MEMBER_ID_PATTERN.test(memberId)) return;
  try {
    storage.setItem(key, memberId);
  } catch {
    // Choosing a local member should remain usable when browser storage is unavailable.
  }
}

export function clearSharedMeIfRemoved(
  storage: StorageLike,
  roomId: string,
  members: ReadonlyArray<Pick<SharedMember, "id">>,
): void {
  const key = keyFor(roomId);
  if (!key) return;
  const memberId = readSharedMe(storage, roomId);
  if (memberId === null || members.some((member) => member.id === memberId)) return;
  try {
    storage.removeItem(key);
  } catch {
    // A stale choice is treated as unselected for this session even if storage is read-only.
  }
}

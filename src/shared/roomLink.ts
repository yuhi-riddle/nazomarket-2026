import type { SharedRoomCredentials } from "./types.ts";
import { isRoomId, isRoomKey } from "./types.ts";
import type { StorageLike } from "./types.ts";

const SESSION_KEY_PREFIX = "nazomarket2026:shared:v1:room:";

function sessionKey(roomId: string): string {
  return SESSION_KEY_PREFIX + roomId + ":key";
}

export function captureSharedRoomLink(
  url: URL,
  storage: Pick<StorageLike, "getItem" | "setItem">,
  replaceUrl: (url: string) => void,
): SharedRoomCredentials | null {
  const roomId = url.searchParams.get("room");
  if (roomId === null) return null;

  const roomKey = url.hash.slice(1);
  let credentials: SharedRoomCredentials | null = null;
  let storageFailed = false;
  if (isRoomId(roomId) && isRoomKey(roomKey)) {
    try {
      storage.setItem(sessionKey(roomId), roomKey);
      credentials = { roomId, roomKey };
    } catch {
      storageFailed = true;
    }
  }

  replaceUrl(url.pathname + url.search);
  if (storageFailed) {
    throw new Error("Shared room credentials could not be stored for this tab.");
  }
  return credentials;
}

export function readSharedRoomCredentials(
  roomId: string,
  storage: Pick<StorageLike, "getItem">,
): SharedRoomCredentials | null {
  if (!isRoomId(roomId)) return null;
  const roomKey = storage.getItem(sessionKey(roomId));
  return isRoomKey(roomKey) ? { roomId, roomKey } : null;
}

export function createSharedRoomRouteUrl(pageUrl: string | URL, roomId: string | null): string {
  const url = new URL(pageUrl);
  if (roomId !== null) {
    if (!isRoomId(roomId)) throw new Error("Shared room ID is invalid.");
    url.searchParams.set("room", roomId);
  } else {
    url.searchParams.delete("room");
  }

  if (!["#catalog", "#list", "#map", "#insights", "#today"].includes(url.hash)) {
    url.hash = "";
  }
  return url.pathname + url.search + url.hash;
}

export function createSharedRoomUrl(pageUrl: string | URL, credentials: SharedRoomCredentials): string {
  if (!isRoomId(credentials.roomId) || !isRoomKey(credentials.roomKey)) {
    throw new Error("Shared room credentials are invalid.");
  }
  const url = new URL(pageUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Shared room links require an HTTP or HTTPS page URL.");
  }
  url.searchParams.set("room", credentials.roomId);
  url.hash = credentials.roomKey;
  return url.toString();
}

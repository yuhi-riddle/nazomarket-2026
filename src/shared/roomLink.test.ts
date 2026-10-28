import { describe, expect, it } from "vitest";
import { captureSharedRoomLink, createSharedRoomRouteUrl, createSharedRoomUrl, readSharedRoomCredentials } from "./roomLink.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const roomId = "123e4567-e89b-42d3-a456-426614174000";
const roomKey = "b".repeat(64);

describe("shared room links", () => {
  it("stores the fragment key in session storage and removes it from the visible URL", () => {
    const storage = new MemoryStorage();
    const replacedUrls: string[] = [];
    const url = new URL(`https://market.example/?tab=list&room=${roomId}#${roomKey}`);

    const credentials = captureSharedRoomLink(url, storage, (nextUrl) => replacedUrls.push(nextUrl));

    expect(credentials).toEqual({ roomId, roomKey });
    expect(replacedUrls).toEqual([`/?tab=list&room=${roomId}`]);
    expect(readSharedRoomCredentials(roomId, storage)).toEqual({ roomId, roomKey });
    expect(storage.values.values().next().value).toBe(roomKey);
    expect(replacedUrls.join("")).not.toContain(roomKey);
  });

  it("leaves ordinary tab fragments alone when there is no room query", () => {
    const storage = new MemoryStorage();
    const replacedUrls: string[] = [];

    const credentials = captureSharedRoomLink(
      new URL("https://market.example/?tab=list#list"),
      storage,
      (nextUrl) => replacedUrls.push(nextUrl),
    );

    expect(credentials).toBeNull();
    expect(replacedUrls).toEqual([]);
    expect(storage.values.size).toBe(0);
  });

  it("keeps the room key in the link fragment instead of the query string", () => {
    const result = new URL(createSharedRoomUrl("https://market.example/list", { roomId, roomKey }));

    expect(result.searchParams.get("room")).toBe(roomId);
    expect(result.hash).toBe("#" + roomKey);
    expect(result.search).not.toContain(roomKey);
  });

  it("adds only the room ID to the current URL and keeps the tab fragment", () => {
    const route = createSharedRoomRouteUrl(`https://market.example/?campaign=spring#map`, roomId);

    expect(route).toBe(`/?campaign=spring&room=${roomId}#map`);
    expect(route).not.toContain(roomKey);
  });

  it("removes an opaque fragment instead of carrying a room key into the current URL", () => {
    const route = createSharedRoomRouteUrl(`https://market.example/?room=${roomId}#${roomKey}`, roomId);

    expect(route).toBe(`/?room=${roomId}`);
    expect(route).not.toContain(roomKey);
  });

  it("removes the room query when leaving while keeping other route state", () => {
    const route = createSharedRoomRouteUrl(`https://market.example/?campaign=spring&room=${roomId}#list`, null);

    expect(route).toBe("/?campaign=spring#list");
  });

  it("restores credentials after reload from the room ID route in the same tab", () => {
    const storage = new MemoryStorage();
    const incoming = new URL(`https://market.example/?room=${roomId}#${roomKey}`);
    captureSharedRoomLink(incoming, storage, () => {});
    const route = createSharedRoomRouteUrl(`https://market.example/?tab=map#map`, roomId);
    const reloadedUrl = new URL(route, "https://market.example");

    expect(readSharedRoomCredentials(reloadedUrl.searchParams.get("room")!, storage))
      .toEqual({ roomId, roomKey });
  });
});

import { describe, expect, it } from "vitest";
import { clearSharedMeIfRemoved, readSharedMe, writeSharedMe } from "./me.ts";

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

describe("共有リストの自分メンバー保存", () => {
  it("部屋IDごとに選択したメンバーを保存して読み出す", () => {
    const storage = new MemoryStorage();
    const roomA = "123e4567-e89b-42d3-a456-426614174000";
    const roomB = "123e4567-e89b-42d3-a456-426614174001";

    writeSharedMe(storage, roomA, "member-1");
    writeSharedMe(storage, roomB, "member-2");

    expect(readSharedMe(storage, roomA)).toBe("member-1");
    expect(readSharedMe(storage, roomB)).toBe("member-2");
    expect(readSharedMe(storage, "123e4567-e89b-42d3-a456-426614174002")).toBeNull();
  });

  it("選択したメンバーが状態に残っている間は保存を保つ", () => {
    const storage = new MemoryStorage();
    const roomId = "123e4567-e89b-42d3-a456-426614174000";
    writeSharedMe(storage, roomId, "member-1");

    clearSharedMeIfRemoved(storage, roomId, [{ id: "member-1" }, { id: "member-2" }]);

    expect(readSharedMe(storage, roomId)).toBe("member-1");
  });

  it("状態から自分のメンバーが消えたら選択を解除する", () => {
    const storage = new MemoryStorage();
    const roomId = "123e4567-e89b-42d3-a456-426614174000";
    writeSharedMe(storage, roomId, "member-1");

    clearSharedMeIfRemoved(storage, roomId, [{ id: "member-2" }]);

    expect(readSharedMe(storage, roomId)).toBeNull();
  });
});

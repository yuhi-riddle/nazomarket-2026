import { describe, expect, it } from "vitest";
import { createStore } from "./store.ts";
import { defaultState, STORAGE_KEY } from "./state.ts";

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

describe("shared list store mode", () => {
  it("keeps personal items and budget while shared edits are active", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({
      ...defaultState,
      budget: 12_000,
      items: [{ productId: "p18", qty: 3, bought: true }],
    }));
    const store = createStore(storage);
    store.enterSharedList([{ productId: "p02", qty: 1, bought: false }], 4_000);

    store.update((state) => ({
      ...state,
      budget: 5_000,
      items: [{ productId: "p02", qty: 2, bought: true }],
    }));

    expect(store.getState()).toMatchObject({
      budget: 5_000,
      items: [{ productId: "p02", qty: 2, bought: true }],
    });
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toMatchObject({
      budget: 12_000,
      items: [{ productId: "p18", qty: 3, bought: true }],
    });

    store.leaveSharedList();

    expect(store.getState()).toMatchObject({
      budget: 12_000,
      items: [{ productId: "p18", qty: 3, bought: true }],
    });
  });

  it("routes shared changes to the handler without saving them as personal data", () => {
    const storage = new MemoryStorage();
    const store = createStore(storage);
    const changes: Array<[number | null, number | null]> = [];
    store.setSharedChangeHandler((previous, next) => changes.push([previous.budget, next.budget]));
    store.enterSharedList([], null);

    store.update((state) => ({ ...state, budget: 2_500 }));

    expect(changes).toEqual([[null, 2_500]]);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toMatchObject({ budget: null, items: [] });
  });

  it("blocks list edits while the shared room is in a non-editable state", () => {
    const store = createStore(new MemoryStorage());
    store.enterSharedList([{ productId: "p18", qty: 1, bought: false }], 3_000);
    store.setSharedWriteBlocked(true);

    store.update((state) => ({ ...state, budget: 0, items: [] }));

    expect(store.getState()).toMatchObject({
      budget: 3_000,
      items: [{ productId: "p18", qty: 1, bought: false }],
    });
  });
});

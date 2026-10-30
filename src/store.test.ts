import { describe, expect, it } from "vitest";
import { createStore, type SharedStoreState } from "./store.ts";
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

const shared = {
  members: [
    { id: "member-1", name: "あき", budgetYen: 5000 },
    { id: "member-2", name: "れん", budgetYen: null },
  ],
  ownerByProductId: new Map<string, string | null>([["p02", "member-1"]]),
  meId: "member-1",
};

describe("共有リスト中のstore", () => {
  it("個人リストの保存失敗を呼び出し側へ知らせる", () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error("storage is full"); },
    };
    const store = createStore(storage);

    store.update((state) => ({ ...state, budget: 3_000 }));

    expect(store.hasPersonalSaveFailure()).toBe(true);
  });

  it("共有members・担当・自分のIDを通知し、退出時にsharedを捨てる", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({
      ...defaultState,
      budget: 12_000,
      items: [{ productId: "p18", qty: 3, bought: true }],
    }));
    const store = createStore(storage);
    const received: Array<SharedStoreState | null> = [];
    store.subscribe((_state, _previous, currentShared) => received.push(currentShared));
    store.enterSharedList([{ productId: "p02", qty: 1, bought: false }], 5000, shared);

    expect(received.at(-1)).toEqual(shared);
    expect(store.getState()).toMatchObject({
      budget: 5000,
      items: [{ productId: "p02", qty: 1, bought: false }],
    });
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toMatchObject({
      budget: 12_000,
      items: [{ productId: "p18", qty: 3, bought: true }],
    });

    const otherMember = { ...shared, meId: "member-2" };
    store.applySharedList([{ productId: "p02", qty: 2, bought: false }], null, otherMember);
    expect(received.at(-1)).toEqual(otherMember);
    expect(store.getState().budget).toBeNull();

    store.leaveSharedList();

    expect(received.at(-1)).toBeNull();
    expect(store.getState()).toMatchObject({
      budget: 12_000,
      items: [{ productId: "p18", qty: 3, bought: true }],
    });
  });

  it("共有中のbudget変更は操作にせず元へ戻し、アイテム変更だけを共有へ送る", () => {
    const storage = new MemoryStorage();
    const store = createStore(storage);
    const changes: Array<[AppStateSnapshot, AppStateSnapshot]> = [];
    store.setSharedChangeHandler((previous, next) => changes.push([previous, next]));
    store.enterSharedList([{ productId: "p02", qty: 1, bought: false }], 5000, shared);

    store.update((state) => ({ ...state, budget: 2500 }));

    expect(store.getState().budget).toBe(5000);
    expect(changes).toEqual([]);

    store.update((state) => ({
      ...state,
      items: [{ productId: "p02", qty: 2, bought: false }],
    }));

    expect(store.getState()).toMatchObject({
      budget: 5000,
      items: [{ productId: "p02", qty: 2, bought: false }],
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.[0].items).toEqual([{ productId: "p02", qty: 1, bought: false }]);
    expect(changes[0]?.[1].items).toEqual([{ productId: "p02", qty: 2, bought: false }]);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).budget).toBeNull();
  });

  it("共有書き込み停止中はアイテム編集を反映しない", () => {
    const store = createStore(new MemoryStorage());
    store.enterSharedList([{ productId: "p18", qty: 1, bought: false }], 3000, shared);
    store.setSharedWriteBlocked(true);

    store.update((state) => ({ ...state, budget: 0, items: [] }));

    expect(store.getState()).toMatchObject({
      budget: 3000,
      items: [{ productId: "p18", qty: 1, bought: false }],
    });
  });
});

type AppStateSnapshot = ReturnType<ReturnType<typeof createStore>["getState"]>;

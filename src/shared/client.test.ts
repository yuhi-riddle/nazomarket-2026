import { describe, expect, it, vi } from "vitest";
import { SharedListClient, createSharedRoom } from "./client.ts";
import type { SharedListState, SharedOperation } from "../../shared-worker/src/domain.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

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

class MemoryTabLockManager {
  readonly held = new Set<string>();

  request(
    name: string,
    _options: unknown,
    callback: (lock: Lock | null) => Promise<unknown>,
  ): Promise<unknown> {
    if (this.held.has(name)) return Promise.resolve(callback(null));
    this.held.add(name);
    return Promise.resolve(callback({} as Lock)).finally(() => this.held.delete(name));
  }
}

const tabLockManager = new MemoryTabLockManager() as unknown as LockManager;

const roomId = "123e4567-e89b-42d3-a456-426614174000";
const roomKey = "a".repeat(64);
const initialState: SharedListState = { revision: 0, budgetYen: null, items: [] };
const addItem: SharedOperation = {
  type: "add",
  item: { id: "item-1", productId: "product-1", name: "謎のキット", priceYen: 1200, quantity: 1 },
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stalledJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => new Promise<never>(() => undefined),
  } as unknown as Response;
}

describe("shared room API", () => {
  it("creates a room without sending credentials or a request body", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const createdState: SharedListState = { revision: 0, budgetYen: null, items: [] };

    const room = await createSharedRoom("https://shared.example", async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return jsonResponse({ roomId, roomKey, state: createdState }, 201);
    });

    expect(new URL(requestUrl).pathname).toBe("/api/rooms");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBeUndefined();
    expect(new Headers(requestInit?.headers).has("Authorization")).toBe(false);
    expect(room).toEqual({ roomId, roomKey, state: createdState });
  });

  it("retries a failed state read with no pending operations after clearing a blocked failure", async () => {
    let stateReads = 0;
    const client = new SharedListClient({
      apiUrl: "https://shared.example",
      roomId,
      roomKey,
      storage: new MemoryStorage(),
      tabStorage: new MemoryStorage(),
      tabLockManager,
      fetcher: async () => {
        stateReads += 1;
        if (stateReads === 1) return jsonResponse({ error: "unauthorized" }, 401);
        if (stateReads === 2) return jsonResponse({ error: "rate_limited" }, 429);
        return jsonResponse(initialState);
      },
    });

    await client.sync();
    expect(client.getSnapshot()).toMatchObject({ status: "error", pendingOperations: [] });

    await client.sync();
    expect(client.getSnapshot()).toMatchObject({ status: "offline", pendingOperations: [], error: { status: 429 } });

    await client.retryPending();

    expect(stateReads).toBe(3);
    expect(client.getSnapshot()).toMatchObject({ status: "idle", state: initialState, pendingOperations: [], error: null });
  });

  it("does not send an operation when it cannot save the outbox first", async () => {
    let requestCount = 0;
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error("storage is full"); },
      removeItem: () => undefined,
    };
    const client = new SharedListClient({
      apiUrl: "https://shared.example",
      roomId,
      roomKey,
      storage,
      tabStorage: new MemoryStorage(),
      tabLockManager,
      fetcher: async () => {
        requestCount += 1;
        return jsonResponse(initialState);
      },
    });

    await expect(client.enqueue(addItem)).rejects.toMatchObject({ code: "storage_unavailable" });

    expect(requestCount).toBe(0);
    expect(client.getSnapshot()).toMatchObject({ status: "error", pendingOperations: [] });
  });
});

describe("shared operation outbox", () => {
  it("polls for state until polling is stopped", async () => {
    vi.useFakeTimers();
    try {
      let stateReads = 0;
      const client = new SharedListClient({
        apiUrl: "https://shared.example",
        roomId,
        roomKey,
        storage: new MemoryStorage(),
        tabStorage: new MemoryStorage(),
        tabLockManager,
        fetcher: async () => {
          stateReads += 1;
          return jsonResponse(initialState);
        },
      });
      const stopPolling = client.startPolling(500);

      await vi.advanceTimersByTimeAsync(0);
      expect(stateReads).toBe(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(stateReads).toBe(2);

      stopPolling();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(stateReads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an operation through a disconnect and sends it after a reload", async () => {
    const storage = new MemoryStorage();
    const tabStorage = new MemoryStorage();
    let state = initialState;
    let postCount = 0;
    let firstSavedOperation = "";
    let latestRequestUrl = "";
    let latestAuthorization: string | null = null;

    const fetcher: typeof fetch = async (input, init) => {
      latestRequestUrl = String(input);
      latestAuthorization = new Headers(init?.headers).get("Authorization");
      if (new URL(latestRequestUrl).pathname.endsWith("/operations")) {
        postCount += 1;
        firstSavedOperation = [...storage.values.values()][0] ?? "";
        if (postCount === 1) throw new TypeError("network disconnected");
        state = {
          revision: 1,
          budgetYen: null,
          items: [{ ...addItem.item, purchased: false }],
        };
        return jsonResponse(state);
      }
      return jsonResponse(state);
    };

    const disconnected = new SharedListClient({
      apiUrl: "https://shared.example",
      roomId,
      roomKey,
      storage,
      tabStorage,
      tabLockManager,
      fetcher,
    });
    await disconnected.enqueue(addItem);

    expect(disconnected.getSnapshot().status).toBe("offline");
    expect(firstSavedOperation).toContain("product-1");
    expect(firstSavedOperation).not.toContain(roomKey);
    expect(latestRequestUrl).not.toContain(roomKey);
    expect(latestAuthorization).toBe(`Bearer ${roomKey}`);
    expect([...storage.values.values()]).toHaveLength(1);

    await disconnected.dispose();
    const reloaded = new SharedListClient({
      apiUrl: "https://shared.example",
      roomId,
      roomKey,
      storage,
      tabStorage,
      tabLockManager,
      fetcher,
    });
    await reloaded.sync();

    expect(postCount).toBe(2);
    expect(reloaded.getSnapshot()).toMatchObject({ status: "idle", state, pendingOperations: [] });
    expect(storage.values.size).toBe(0);
  });

  it("keeps each tab's outbox separate and restores it after that tab reloads", async () => {
    const storage = new MemoryStorage();
    const firstTabStorage = new MemoryStorage();
    const secondTabStorage = new MemoryStorage();
    const secondOperation: SharedOperation = {
      type: "add",
      item: { ...addItem.item, id: "item-2", productId: "product-2", name: "別の商品" },
    };
    let online = false;
    let serverState = initialState;
    const fetcher: typeof fetch = async (input, init) => {
      if (!new URL(String(input)).pathname.endsWith("/operations")) return jsonResponse(serverState);
      if (!online) throw new TypeError("network disconnected");
      const envelope = JSON.parse(String(init?.body)) as { operation: SharedOperation };
      if (envelope.operation.type === "add") {
        serverState = {
          revision: serverState.revision + 1,
          budgetYen: serverState.budgetYen,
          items: [...serverState.items, { ...envelope.operation.item, purchased: false }],
        };
      }
      return jsonResponse(serverState);
    };

    const firstTab = new SharedListClient({
      apiUrl: "https://shared.example", roomId, roomKey, storage, tabStorage: firstTabStorage, tabLockManager, fetcher,
    });
    const secondTab = new SharedListClient({
      apiUrl: "https://shared.example", roomId, roomKey, storage, tabStorage: secondTabStorage, tabLockManager, fetcher,
    });
    await firstTab.enqueue(addItem);
    await secondTab.enqueue(secondOperation);

    expect(storage.values.size).toBe(2);
    expect(firstTab.getSnapshot().pendingOperations).toEqual([addItem]);
    expect(secondTab.getSnapshot().pendingOperations).toEqual([secondOperation]);

    online = true;
    await firstTab.dispose();
    const reloadedFirstTab = new SharedListClient({
      apiUrl: "https://shared.example", roomId, roomKey, storage, tabStorage: firstTabStorage, tabLockManager, fetcher,
    });
    await reloadedFirstTab.sync();

    expect(reloadedFirstTab.getSnapshot()).toMatchObject({ status: "idle", pendingOperations: [] });
    expect(storage.values.size).toBe(1);
    await secondTab.dispose();
    const reloadedSecondTab = new SharedListClient({
      apiUrl: "https://shared.example", roomId, roomKey, storage, tabStorage: secondTabStorage, tabLockManager, fetcher,
    });
    await reloadedSecondTab.sync();
    expect(reloadedSecondTab.getSnapshot().pendingOperations).toEqual([secondOperation]);
  });

  it("takes over a closed tab's queued operations while holding its tab lock", async () => {
    const storage = new MemoryStorage();
    const closedTabId = "closed-tab-id-1234";
    const closedQueueKey = `nazomarket2026:shared:v2:outbox:${roomId}:${closedTabId}`;
    storage.values.set(closedQueueKey, JSON.stringify([{
      id: "11111111-1111-4111-8111-111111111111",
      operation: addItem,
      baseRevision: 0,
    }]));
    const tabStorage = new MemoryStorage();
    tabStorage.values.set("nazomarket2026:shared:v2:tab-id", "new-tab-id-12345678");
    let serverState = initialState;
    const sent: SharedOperation[] = [];
    const client = new SharedListClient({
      apiUrl: "https://shared.example",
      roomId,
      roomKey,
      storage,
      tabStorage,
      tabLockManager,
      fetcher: async (input, init) => {
        if (!new URL(String(input)).pathname.endsWith("/operations")) return jsonResponse(serverState);
        const envelope = JSON.parse(String(init?.body)) as { operation: SharedOperation };
        sent.push(envelope.operation);
        serverState = {
          revision: serverState.revision + 1,
          budgetYen: serverState.budgetYen,
          items: [{ ...addItem.item, purchased: false }],
        };
        return jsonResponse(serverState);
      },
    });

    await client.sync();

    expect(sent).toEqual([addItem]);
    expect(client.getSnapshot()).toMatchObject({ status: "idle", pendingOperations: [] });
    expect(storage.values.has(closedQueueKey)).toBe(false);
    expect(storage.values.size).toBe(0);
    await client.dispose();
  });

  it("detects a duplicated sessionStorage identity and forks without taking the source outbox", async () => {
    const storage = new MemoryStorage();
    const sourceTabStorage = new MemoryStorage();
    const duplicateTabStorage = new MemoryStorage();
    const secondOperation: SharedOperation = {
      type: "add",
      item: { ...addItem.item, id: "item-2", productId: "product-2", name: "別の商品" },
    };
    const fetcher: typeof fetch = async (input) => {
      if (!new URL(String(input)).pathname.endsWith("/operations")) return jsonResponse(initialState);
      throw new TypeError("network disconnected");
    };
    const source = new SharedListClient({
      apiUrl: "https://shared.example", roomId, roomKey, storage,
      tabStorage: sourceTabStorage, tabLockManager, fetcher,
    });
    await source.enqueue(addItem);
    for (const [key, value] of sourceTabStorage.values) duplicateTabStorage.values.set(key, value);

    const duplicate = new SharedListClient({
      apiUrl: "https://shared.example", roomId, roomKey, storage,
      tabStorage: duplicateTabStorage, tabLockManager, fetcher,
    });
    await duplicate.sync();

    expect(duplicate.getSnapshot().pendingOperations).toEqual([]);
    expect(storage.values.size).toBe(1);
    await duplicate.enqueue(secondOperation);

    expect(source.getSnapshot().pendingOperations).toEqual([addItem]);
    expect(duplicate.getSnapshot().pendingOperations).toEqual([secondOperation]);
    expect(storage.values.size).toBe(2);
  });

  it("migrates the previous room-wide outbox without dropping its operations", async () => {
    const storage = new MemoryStorage();
    const tabStorage = new MemoryStorage();
    const legacyKey = `nazomarket2026:shared:v1:outbox:${roomId}`;
    storage.values.set(legacyKey, JSON.stringify([{ operation: addItem, baseRevision: 0 }]));

    const client = new SharedListClient({
      apiUrl: "https://shared.example",
      roomId,
      roomKey,
      storage,
      tabStorage,
      tabLockManager,
      fetcher: async (input) => new URL(String(input)).pathname.endsWith("/operations")
        ? Promise.reject(new TypeError("network disconnected"))
        : jsonResponse(initialState),
    });
    await client.sync();

    expect(client.getSnapshot().pendingOperations).toEqual([addItem]);
    expect(storage.values.has(legacyKey)).toBe(false);
    expect(storage.values.size).toBe(1);
  });

  it("does not replay an operation when the server may have committed before disconnect", async () => {
    const storage = new MemoryStorage();
    const tabStorage = new MemoryStorage();
    let serverState = initialState;
    let postCount = 0;
    const fetcher: typeof fetch = async (input) => {
      if (!new URL(String(input)).pathname.endsWith("/operations")) return jsonResponse(serverState);
      postCount += 1;
      if (postCount > 1) return jsonResponse({ error: "duplicate_item" }, 409);
      serverState = {
        revision: 1,
        budgetYen: null,
        items: [{ ...addItem.item, purchased: false }],
      };
      throw new TypeError("connection closed before the response arrived");
    };
    const options = { apiUrl: "https://shared.example", roomId, roomKey, storage, tabStorage, tabLockManager, fetcher };

    const disconnected = new SharedListClient(options);
    await disconnected.enqueue(addItem);
    await disconnected.dispose();
    const recovered = new SharedListClient(options);
    await recovered.sync();

    expect(postCount).toBe(1);
    expect(recovered.getSnapshot()).toMatchObject({
      status: "conflict",
      state: serverState,
      pendingOperations: [addItem],
      conflict: { baseRevision: 0, currentRevision: 1 },
    });

    await recovered.resolveConflict("rebase");
    expect(recovered.getSnapshot()).toMatchObject({
      status: "error",
      pendingOperations: [addItem],
      error: { code: "duplicate_item" },
    });

    await recovered.resolvePendingOperation("mark-applied", recovered.getSnapshot().pendingOperationIds?.[0]);
    expect(recovered.getSnapshot()).toMatchObject({ status: "idle", pendingOperations: [] });
    expect(postCount).toBe(2);
  });

  it("times out while reading a stalled response body and keeps the possibly applied operation", async () => {
    const storage = new MemoryStorage();
    const tabStorage = new MemoryStorage();
    let serverState = initialState;
    const postRequest = { signal: null as AbortSignal | null };
    const fetcher: typeof fetch = async (input, init) => {
      if (!new URL(String(input)).pathname.endsWith("/operations")) return jsonResponse(serverState);
      postRequest.signal = init?.signal as AbortSignal;
      serverState = {
        revision: 1,
        budgetYen: null,
        items: [{ ...addItem.item, purchased: false }],
      };
      return stalledJsonResponse();
    };

    const client = new SharedListClient({
      apiUrl: "https://shared.example",
      roomId,
      roomKey,
      storage,
      tabStorage,
      tabLockManager,
      requestTimeoutMs: 10,
      fetcher,
    });
    await client.enqueue(addItem);

    expect(postRequest.signal?.aborted).toBe(true);
    expect(client.getSnapshot()).toMatchObject({
      status: "offline",
      pendingOperations: [addItem],
      error: { code: "request_timeout" },
    });
    expect(storage.values.size).toBe(1);
  });

  it("serializes concurrent per-operation resolution and rejects a stale target", async () => {
    const storage = new MemoryStorage();
    const tabStorage = new MemoryStorage();
    const secondOperation: SharedOperation = {
      type: "add",
      item: { ...addItem.item, id: "item-2", productId: "product-2", name: "別の商品" },
    };
    let holdReads = false;
    const heldReads: Array<(response: Response) => void> = [];
    const fetcher: typeof fetch = async (input) => {
      if (!new URL(String(input)).pathname.endsWith("/operations")) {
        if (holdReads) return new Promise<Response>((resolve) => heldReads.push(resolve));
        return jsonResponse(initialState);
      }
      throw new TypeError("network disconnected");
    };
    const client = new SharedListClient({
      apiUrl: "https://shared.example", roomId, roomKey, storage,
      tabStorage, tabLockManager, fetcher,
    });
    await client.enqueue(addItem);
    await client.enqueue(secondOperation);
    const operationIds = client.getSnapshot().pendingOperationIds;
    expect(operationIds).toHaveLength(2);
    const selectedId = operationIds?.[0];

    holdReads = true;
    const firstResolution = client.resolvePendingOperation("discard", selectedId);
    const secondResolution = client.resolvePendingOperation("discard", selectedId);
    const normalSync = client.sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const readCount = heldReads.length;
    holdReads = false;
    for (const resolve of heldReads) resolve(jsonResponse(initialState));
    const results = await Promise.allSettled([firstResolution, secondResolution, normalSync]);

    expect(readCount).toBe(1);
    expect(results[1].status).toBe("rejected");
    expect(results[2].status).toBe("fulfilled");
    expect(client.getSnapshot().pendingOperations).toEqual([secondOperation]);
  });

  it("persists a later operation while the first request is waiting and restores both after reload", async () => {
    const storage = new MemoryStorage();
    const tabStorage = new MemoryStorage();
    const reloadedTabStorage = new MemoryStorage();
    const secondOperation: SharedOperation = {
      type: "add",
      item: { ...addItem.item, id: "item-2", productId: "product-2", name: "別の商品" },
    };
    let startFirstPost!: () => void;
    let rejectFirstPost!: (reason: unknown) => void;
    const firstPostStarted = new Promise<void>((resolve) => { startFirstPost = resolve; });
    const firstPostResponse = new Promise<Response>((_, reject) => { rejectFirstPost = reject; });
    let postCount = 0;
    const fetcher: typeof fetch = async (input) => {
      if (!new URL(String(input)).pathname.endsWith("/operations")) return jsonResponse(initialState);
      postCount += 1;
      if (postCount === 1) {
        startFirstPost();
        return firstPostResponse;
      }
      throw new TypeError("network disconnected");
    };
    const client = new SharedListClient({
      apiUrl: "https://shared.example", roomId, roomKey, storage,
      tabStorage, tabLockManager, fetcher,
    });
    const firstEnqueue = client.enqueue(addItem);
    await firstPostStarted;
    const secondEnqueue = client.enqueue(secondOperation);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const savedDuringFirstRequest = [...storage.values.values()].flatMap((raw) => {
      const queue = JSON.parse(raw) as Array<{ operation: SharedOperation }>;
      return queue.map((entry) => entry.operation);
    });
    for (const [key, value] of tabStorage.values) reloadedTabStorage.values.set(key, value);

    let reloadedState = initialState;
    const replayedOperations: SharedOperation[] = [];
    const reloaded = new SharedListClient({
      apiUrl: "https://shared.example",
      roomId,
      roomKey,
      storage,
      tabStorage: reloadedTabStorage,
      tabLockManager: new MemoryTabLockManager() as unknown as LockManager,
      fetcher: async (input, init) => {
        if (!new URL(String(input)).pathname.endsWith("/operations")) return jsonResponse(reloadedState);
        const envelope = JSON.parse(String(init?.body)) as { operation: SharedOperation };
        replayedOperations.push(envelope.operation);
        if (envelope.operation.type === "add") {
          reloadedState = {
            revision: reloadedState.revision + 1,
            budgetYen: reloadedState.budgetYen,
            items: [...reloadedState.items, { ...envelope.operation.item, purchased: false }],
          };
        }
        return jsonResponse(reloadedState);
      },
    });
    await reloaded.sync();
    rejectFirstPost(new TypeError("response lost after reload"));
    await Promise.all([firstEnqueue, secondEnqueue]);

    expect(savedDuringFirstRequest).toEqual([addItem, secondOperation]);
    expect(replayedOperations).toEqual([addItem, secondOperation]);
    expect(reloaded.getSnapshot()).toMatchObject({ status: "idle", state: reloadedState, pendingOperations: [] });
    expect(storage.values.size).toBe(0);
    await client.dispose();
    await reloaded.dispose();
  });

  it("pauses on a revision conflict until the caller chooses to rebase", async () => {
    const storage = new MemoryStorage();
    const remoteState: SharedListState = {
      revision: 1,
      budgetYen: 3000,
      items: [{
        id: "remote-item",
        productId: "product-remote",
        name: "別の人が追加した商品",
        priceYen: 500,
        quantity: 1,
        purchased: false,
      }],
    };
    const appliedState: SharedListState = {
      ...remoteState,
      revision: 2,
      items: [...remoteState.items, { ...addItem.item, purchased: false }],
    };
    const postedRevisions: number[] = [];
    let stateReads = 0;

    const fetcher: typeof fetch = async (input, init) => {
      if (new URL(String(input)).pathname.endsWith("/operations")) {
        const envelope = JSON.parse(String(init?.body)) as { baseRevision: number };
        postedRevisions.push(envelope.baseRevision);
        return postedRevisions.length === 1
          ? jsonResponse({ error: "revision_conflict", currentRevision: 1 }, 409)
          : jsonResponse(appliedState);
      }
      stateReads += 1;
      return jsonResponse(stateReads === 1 ? initialState : remoteState);
    };

    const client = new SharedListClient({
      apiUrl: "https://shared.example",
      roomId,
      roomKey,
      storage,
      tabStorage: new MemoryStorage(),
      tabLockManager,
      fetcher,
    });
    await client.enqueue(addItem);

    expect(postedRevisions).toEqual([0]);
    expect(client.getSnapshot()).toMatchObject({
      status: "conflict",
      state: remoteState,
      pendingOperations: [addItem],
      conflict: { baseRevision: 0, currentRevision: 1 },
    });

    await client.resolveConflict("rebase");

    expect(postedRevisions).toEqual([0, 1]);
    expect(client.getSnapshot()).toMatchObject({ status: "idle", state: appliedState, pendingOperations: [] });
    expect(storage.values.size).toBe(0);
  });

  it("keeps a rejected operation queued until the caller discards it", async () => {
    const storage = new MemoryStorage();
    let postCount = 0;
    const removeMissing: SharedOperation = { type: "remove", itemId: "missing-item" };
    const client = new SharedListClient({
      apiUrl: "https://shared.example",
      roomId,
      roomKey,
      storage,
      tabStorage: new MemoryStorage(),
      tabLockManager,
      fetcher: async (input) => new URL(String(input)).pathname.endsWith("/operations")
        ? (postCount += 1, jsonResponse({ error: "item_not_found" }, 404))
        : jsonResponse(initialState),
    });

    await client.enqueue(removeMissing);
    expect(client.getSnapshot()).toMatchObject({
      status: "error",
      pendingOperations: [removeMissing],
      error: { code: "item_not_found" },
    });

    await client.sync();
    expect(postCount).toBe(1);

    await client.discardPending();
    expect(client.getSnapshot()).toMatchObject({ status: "idle", pendingOperations: [], error: null });
    expect(storage.values.size).toBe(0);
  });
});

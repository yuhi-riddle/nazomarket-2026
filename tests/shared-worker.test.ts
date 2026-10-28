import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import worker, { SharedRoom, type WorkerEnv } from "../shared-worker/src/worker.ts";
import { applyOperation, createInitialState } from "../shared-worker/src/domain.ts";

class TestSqlStorage {
  readonly database = new DatabaseSync(":memory:");
  readonly writes: string[] = [];

  exec(query: string, ...bindings: (string | number | null)[]) {
    if (!/^\s*SELECT\b/i.test(query)) this.writes.push(query.trim());
    const statement = this.database.prepare(query);
    const rows = /^\s*SELECT\b/i.test(query)
      ? statement.all(...bindings) as Record<string, unknown>[]
      : (statement.run(...bindings), []);
    return { toArray: () => rows };
  }
}

class TestDurableStorage {
  readonly sql = new TestSqlStorage();

  transactionSync<T>(callback: () => T): T {
    this.sql.database.exec("BEGIN");
    try {
      const result = callback();
      this.sql.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.sql.database.exec("ROLLBACK");
      throw error;
    }
  }
}

describe("shared shopping list operations", () => {
  it("applies add, quantity, purchased, budget, and removal as single revisions", () => {
    let state = createInitialState();

    state = applyOperation(state, {
      baseRevision: 0,
      operation: {
        type: "add",
        item: { id: "item-1", productId: "p-1", name: "謎のキット", priceYen: 1200, quantity: 1 },
      },
    });
    expect(state).toEqual({
      revision: 1,
      budgetYen: null,
      items: [{ id: "item-1", productId: "p-1", name: "謎のキット", priceYen: 1200, quantity: 1, purchased: false }],
    });

    state = applyOperation(state, {
      baseRevision: 1,
      operation: { type: "set-quantity", itemId: "item-1", quantity: 3 },
    });
    state = applyOperation(state, {
      baseRevision: 2,
      operation: { type: "set-purchased", itemId: "item-1", purchased: true },
    });
    state = applyOperation(state, {
      baseRevision: 3,
      operation: { type: "set-budget", budgetYen: 5000 },
    });
    expect(state.revision).toBe(4);
    expect(state.items[0]).toMatchObject({ quantity: 3, purchased: true });
    expect(state.budgetYen).toBe(5000);

    state = applyOperation(state, {
      baseRevision: 4,
      operation: { type: "remove", itemId: "item-1" },
    });
    expect(state).toEqual({ revision: 5, budgetYen: 5000, items: [] });
  });

  it("rejects a stale revision without changing the current snapshot", () => {
    const state = createInitialState();

    expect(() => applyOperation(state, {
      baseRevision: 1,
      operation: { type: "set-budget", budgetYen: 3000 },
    })).toThrowError(/revision/i);
    expect(state).toEqual({ revision: 0, budgetYen: null, items: [] });
  });

  it.each([
    { baseRevision: 0, operation: { type: "set-budget", budgetYen: -1 } },
    { baseRevision: 0, operation: { type: "set-quantity", itemId: "item-1", quantity: 0 } },
    { baseRevision: 0, operation: { type: "add", item: { id: "item-1", productId: null, name: "  ", priceYen: null, quantity: 1 } } },
    { baseRevision: 0, operation: { type: "unknown" } },
  ])("rejects malformed or out-of-range operation %#", (input) => {
    expect(() => applyOperation(createInitialState(), input)).toThrow();
  });
});

describe("shared worker CORS boundary", () => {
  const env = {
    ALLOWED_ORIGINS: "https://shopping.example",
    ROOMS: {} as WorkerEnv["ROOMS"],
  } satisfies WorkerEnv;

  it("answers allowed preflight with the exact origin and required headers", async () => {
    const response = await worker.fetch(new Request("https://api.example/api/rooms", {
      method: "OPTIONS",
      headers: {
        Origin: "https://shopping.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    }), env);

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://shopping.example");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response.headers.get("Vary")).toMatch(/origin/i);
  });

  it("rejects unconfigured origins without reflecting them", async () => {
    const response = await worker.fetch(new Request("https://api.example/api/rooms", {
      method: "OPTIONS",
      headers: { Origin: "https://shopping.example.attacker.test", "Access-Control-Request-Method": "POST" },
    }), env);

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("accepts only the configured preflight headers", async () => {
    const response = await worker.fetch(new Request("https://api.example/api/rooms", {
      method: "OPTIONS",
      headers: {
        Origin: "https://shopping.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,x-unexpected",
      },
    }), env);

    expect(response.status).toBe(403);
  });
});

describe("shared room authentication and storage", () => {
  it("rejects a GET without a room key before resolving the Durable Object", async () => {
    const rooms: WorkerEnv["ROOMS"] = {
      idFromName: () => { throw new Error("room id should not be resolved"); },
      get: () => { throw new Error("room stub should not be requested"); },
    };
    const response = await worker.fetch(new Request("https://api.example/api/rooms/123e4567-e89b-42d3-a456-426614174000", {
      method: "GET",
      headers: { Origin: "https://shopping.example" },
    }), { ALLOWED_ORIGINS: "https://shopping.example", ROOMS: rooms });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("does not write SQL when a credential targets an uninitialized room", async () => {
    const storage = new TestDurableStorage();
    try {
      const room = new SharedRoom({ storage });
      const response = await room.fetch(new Request("https://room.internal/api/rooms/123e4567-e89b-42d3-a456-426614174000", {
        method: "GET",
        headers: { Authorization: `Bearer ${"a".repeat(64)}` },
      }));

      expect(response.status).toBe(401);
      expect(storage.sql.writes).toEqual([]);
    } finally {
      storage.sql.database.close();
    }
  });

  it("keeps an initialized room usable after its Durable Object is recreated", async () => {
    const storage = new TestDurableStorage();
    const roomId = "123e4567-e89b-42d3-a456-426614174000";
    const roomKey = "b".repeat(64);
    const keyHash = createHash("sha256").update(roomKey).digest("hex");
    const headers = { Authorization: `Bearer ${roomKey}` };
    try {
      const room = new SharedRoom({ storage });
      expect(storage.sql.writes).toEqual([]);

      const initialized = await room.fetch(new Request("https://room.internal/internal/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyHash }),
      }));
      expect(initialized.status).toBe(201);
      expect(storage.sql.writes.filter((query) => /^CREATE TABLE/i.test(query))).toHaveLength(2);

      const operation = await room.fetch(new Request(`https://room.internal/api/rooms/${roomId}/operations`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: 0, operation: { type: "set-budget", budgetYen: 9000 } }),
      }));
      expect(operation.status).toBe(200);

      const recreatedRoom = new SharedRoom({ storage });
      const state = await recreatedRoom.fetch(new Request(`https://room.internal/api/rooms/${roomId}`, {
        method: "GET",
        headers,
      }));
      expect(state.status).toBe(200);
      expect(await state.json()).toEqual({ revision: 1, budgetYen: 9000, items: [] });
      expect(storage.sql.writes.filter((query) => /^CREATE TABLE/i.test(query))).toHaveLength(2);
    } finally {
      storage.sql.database.close();
    }
  });
});

describe("shared room creation", () => {
  it("returns a random room key and sends only its SHA-256 verifier to storage", async () => {
    let initializationRequest: Request | undefined;
    const rooms: WorkerEnv["ROOMS"] = {
      idFromName: (name) => name as unknown as ReturnType<WorkerEnv["ROOMS"]["idFromName"]>,
      get: () => ({
        fetch: async (request) => {
          initializationRequest = request;
          return new Response(null, { status: 201 });
        },
      }),
    };
    const response = await worker.fetch(new Request("https://api.example/api/rooms", {
      method: "POST",
      headers: { Origin: "https://shopping.example" },
    }), { ALLOWED_ORIGINS: "https://shopping.example", ROOMS: rooms });
    const body = await response.json() as { roomId: string; roomKey: string; state: { revision: number } };

    expect(response.status).toBe(201);
    expect(body.roomId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.roomKey).toMatch(/^[0-9a-f]{64}$/);
    expect(body.state).toEqual({ revision: 0, budgetYen: null, items: [] });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(initializationRequest).toBeDefined();
    expect(new URL(initializationRequest!.url).pathname).toBe("/internal/init");
    expect(await initializationRequest!.json()).toEqual({
      keyHash: createHash("sha256").update(body.roomKey).digest("hex"),
    });
  });
});

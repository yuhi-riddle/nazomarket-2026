import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import worker, { SharedRoom, type WorkerEnv } from "../shared-worker/src/worker.ts";
import { applyOperation, createInitialState, type SharedOperation } from "../shared-worker/src/domain.ts";

function mockRateLimiter(decide: (key: string) => boolean | Promise<boolean> = () => true) {
  const keys: string[] = [];
  return {
    keys,
    binding: {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: await decide(key) };
      },
    },
  };
}

function workerEnv(
  rooms: WorkerEnv["ROOMS"] = {} as WorkerEnv["ROOMS"],
  createLimiter = mockRateLimiter(),
  readLimiter = mockRateLimiter(),
  operationLimiter = mockRateLimiter(),
) {
  return {
    env: {
      ALLOWED_ORIGINS: "https://shopping.example",
      ROOMS: rooms,
      ROOM_CREATE_RATE_LIMIT: createLimiter.binding,
      ROOM_READ_RATE_LIMIT: readLimiter.binding,
      ROOM_OPERATION_RATE_LIMIT: operationLimiter.binding,
    } as unknown as WorkerEnv,
    createLimiter,
    readLimiter,
    operationLimiter,
  };
}

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

async function postRoomOperation(
  room: SharedRoom,
  roomId: string,
  roomKey: string,
  baseRevision: number,
  operation: SharedOperation,
): Promise<Response> {
  return room.fetch(new Request(`https://room.internal/api/rooms/${roomId}/operations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${roomKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ baseRevision, operation }),
  }));
}

describe("shared shopping list operations", () => {
  it("メンバー・担当の各操作でrevisionを1つ進める", () => {
    let state = createInitialState();
    expect(state).toEqual({ revision: 0, members: [], items: [] });

    const apply = (operation: SharedOperation) => {
      state = applyOperation(state, { baseRevision: state.revision, operation });
    };
    apply({ type: "add-member", member: { id: "member-1", name: "  あき  " } });
    expect(state.members).toEqual([{ id: "member-1", name: "あき", budgetYen: null }]);
    apply({ type: "add-member", member: { id: "member-2", name: "れん" } });
    apply({ type: "rename-member", memberId: "member-2", name: "  蓮  " });
    apply({ type: "set-member-budget", memberId: "member-1", budgetYen: 5000 });
    apply({
      type: "add",
      item: { id: "item-1", productId: "p-1", name: "謎のキット", priceYen: 1200, quantity: 1, ownerId: "member-1" },
    });
    apply({ type: "set-owner", itemId: "item-1", ownerId: "member-2" });
    apply({ type: "set-owner", itemId: "item-1", ownerId: null });
    apply({ type: "set-quantity", itemId: "item-1", quantity: 3 });
    apply({ type: "set-purchased", itemId: "item-1", purchased: true });
    expect(state).toEqual({
      revision: 9,
      members: [
        { id: "member-1", name: "あき", budgetYen: 5000 },
        { id: "member-2", name: "蓮", budgetYen: null },
      ],
      items: [{ id: "item-1", productId: "p-1", name: "謎のキット", priceYen: 1200, quantity: 3, purchased: true, ownerId: null }],
    });
  });

  it("最初のメンバーを登録でき、名前の前後の空白を除く", () => {
    const state = createInitialState();
    const next = applyOperation(state, {
      baseRevision: 0,
      operation: { type: "add-member", member: { id: "member-1", name: "  みな  " } },
    });

    expect(next).toEqual({
      revision: 1,
      members: [{ id: "member-1", name: "みな", budgetYen: null }],
      items: [],
    });
  });

  it.each([
    ["空の名前", "  "],
    ["21文字の名前", "あ".repeat(21)],
    ["制御文字を含む名前", "あ\nき"],
  ])("%sメンバーを拒否する", (_label, name) => {
    expect(() => applyOperation(createInitialState(), {
      baseRevision: 0,
      operation: { type: "add-member", member: { id: "member-1", name } },
    } as never)).toThrow();
  });

  it("前後空白と大文字小文字を無視して重複名を拒否する", () => {
    let state = applyOperation(createInitialState(), {
      baseRevision: 0,
      operation: { type: "add-member", member: { id: "member-1", name: " Mika " } },
    });

    expect(() => applyOperation(state, {
      baseRevision: state.revision,
      operation: { type: "add-member", member: { id: "member-2", name: "mIkA" } },
    })).toThrow();
  });

  it("メンバー予算はnullまたは上限内の整数だけを受け入れる", () => {
    let state = applyOperation(createInitialState(), {
      baseRevision: 0,
      operation: { type: "add-member", member: { id: "member-1", name: "あき" } },
    });
    state = applyOperation(state, {
      baseRevision: state.revision,
      operation: { type: "set-member-budget", memberId: "member-1", budgetYen: null },
    });
    state = applyOperation(state, {
      baseRevision: state.revision,
      operation: { type: "set-member-budget", memberId: "member-1", budgetYen: 0 },
    });
    expect(state.members[0]?.budgetYen).toBe(0);

    for (const budgetYen of [-1, 1.5, 1_000_000_001]) {
      expect(() => applyOperation(state, {
        baseRevision: state.revision,
        operation: { type: "set-member-budget", memberId: "member-1", budgetYen },
      } as never)).toThrow();
    }
  });

  it("メンバーを20人までに制限し、ID形式も検証する", () => {
    let state = createInitialState();
    for (let index = 1; index <= 20; index += 1) {
      state = applyOperation(state, {
        baseRevision: state.revision,
        operation: { type: "add-member", member: { id: `member-${index}`, name: `名前${index}` } },
      });
    }

    expect(state.members).toHaveLength(20);
    expect(() => applyOperation(state, {
      baseRevision: state.revision,
      operation: { type: "add-member", member: { id: "member-21", name: "21人目" } },
    })).toThrow();
    expect(() => applyOperation(createInitialState(), {
      baseRevision: 0,
      operation: { type: "add-member", member: { id: "not valid", name: "名前" } },
    } as never)).toThrow();
  });

  it("存在しないメンバーやアイテムを参照する操作を拒否する", () => {
    const state = applyOperation(createInitialState(), {
      baseRevision: 0,
      operation: { type: "add-member", member: { id: "member-1", name: "あき" } },
    });
    const withItem = applyOperation(state, {
      baseRevision: state.revision,
      operation: { type: "add", item: { id: "item-1", productId: "p-1", name: "品", priceYen: 100, quantity: 1, ownerId: "member-1" } },
    });

    for (const operation of [
      { type: "rename-member", memberId: "missing", name: "れん" },
      { type: "remove-member", memberId: "missing" },
      { type: "set-member-budget", memberId: "missing", budgetYen: 1000 },
      { type: "set-owner", itemId: "item-1", ownerId: "missing" },
      { type: "set-owner", itemId: "missing", ownerId: "member-1" },
      { type: "add", item: { id: "item-2", productId: "p-2", name: "別の品", priceYen: 100, quantity: 1, ownerId: "missing" } },
    ]) {
      expect(() => applyOperation(withItem, {
        baseRevision: withItem.revision,
        operation,
      } as never)).toThrow();
    }
  });

  it("メンバー削除で担当を未定に戻し、古いrevisionの担当変更を拒否する", () => {
    let state = applyOperation(createInitialState(), {
      baseRevision: 0,
      operation: { type: "add-member", member: { id: "member-1", name: "あき" } },
    });
    state = applyOperation(state, {
      baseRevision: 1,
      operation: { type: "add", item: { id: "item-1", productId: "p-1", name: "品", priceYen: 100, quantity: 1, ownerId: "member-1" } },
    });
    const staleRevision = state.revision;
    state = applyOperation(state, { baseRevision: state.revision, operation: { type: "remove-member", memberId: "member-1" } });

    expect(state).toMatchObject({ revision: 3, members: [], items: [{ id: "item-1", ownerId: null }] });
    expect(() => applyOperation(state, {
      baseRevision: staleRevision,
      operation: { type: "set-owner", itemId: "item-1", ownerId: "member-1" },
    })).toThrowError(/revision/i);
  });

  it("部屋全体の予算と旧set-budget操作を拒否する", () => {
    expect(createInitialState()).not.toHaveProperty("budgetYen");
    expect(() => applyOperation(createInitialState(), {
      baseRevision: 0,
      operation: { type: "set-budget", budgetYen: 3000 },
    } as never)).toThrow();
    expect(() => applyOperation(createInitialState(), {
      baseRevision: 0,
      operation: { type: "set-member-budget", memberId: "missing", budgetYen: -1 },
    } as never)).toThrow();
  });

  it("古いrevisionを拒否し、状態を変更しない", () => {
    const state = applyOperation(createInitialState(), {
      baseRevision: 0,
      operation: { type: "add-member", member: { id: "member-1", name: "あき" } },
    });

    expect(() => applyOperation(state, {
      baseRevision: 0,
      operation: { type: "set-member-budget", memberId: "member-1", budgetYen: 3000 },
    })).toThrowError(/revision/i);
    expect(state).toEqual({ revision: 1, members: [{ id: "member-1", name: "あき", budgetYen: null }], items: [] });
  });
});

describe("shared worker CORS boundary", () => {
  const { env } = workerEnv();

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
      headers: { Origin: "https://shopping.example", "CF-Connecting-IP": "192.0.2.10" },
    }), workerEnv(rooms).env);

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

  it("Durable Object再生成後もメンバー順・予算・担当状態を保つ", async () => {
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
      expect(storage.sql.writes.filter((query) => /^CREATE TABLE/i.test(query))).toHaveLength(3);
      const roomMetaColumns = storage.sql.database.prepare("PRAGMA table_info(room_meta)").all().map((row) => String(row.name));
      const memberColumns = storage.sql.database.prepare("PRAGMA table_info(members)").all().map((row) => String(row.name));
      const itemColumns = storage.sql.database.prepare("PRAGMA table_info(items)").all().map((row) => String(row.name));
      expect(roomMetaColumns).not.toContain("budget_yen");
      expect(memberColumns).toEqual(["id", "name", "budget_yen", "position"]);
      expect(itemColumns).toContain("owner_id");

      const operations: SharedOperation[] = [
        { type: "add-member", member: { id: "member-1", name: "あき" } },
        { type: "add-member", member: { id: "member-2", name: "れん" } },
        { type: "add-member", member: { id: "member-3", name: "みな" } },
        { type: "set-member-budget", memberId: "member-1", budgetYen: 9000 },
        { type: "add", item: { id: "item-1", productId: "p-1", name: "謎のキット", priceYen: 1200, quantity: 1, ownerId: "member-2" } },
        { type: "remove-member", memberId: "member-2" },
      ];
      for (const [baseRevision, operation] of operations.entries()) {
        const response = await postRoomOperation(room, roomId, roomKey, baseRevision, operation);
        expect(response.status).toBe(200);
      }

      const recreatedRoom = new SharedRoom({ storage });
      const state = await recreatedRoom.fetch(new Request(`https://room.internal/api/rooms/${roomId}`, {
        method: "GET",
        headers,
      }));
      expect(state.status).toBe(200);
      expect(await state.json()).toEqual({
        revision: 6,
        members: [
          { id: "member-1", name: "あき", budgetYen: 9000 },
          { id: "member-3", name: "みな", budgetYen: null },
        ],
        items: [{ id: "item-1", productId: "p-1", name: "謎のキット", priceYen: 1200, quantity: 1, purchased: false, ownerId: null }],
      });
      expect(storage.sql.writes.filter((query) => /^CREATE TABLE/i.test(query))).toHaveLength(3);
    } finally {
      storage.sql.database.close();
    }
  });
});

describe("shared room creation", () => {
  it("accepts a present but empty request body stream", async () => {
    let initialized = false;
    const rooms: WorkerEnv["ROOMS"] = {
      idFromName: (name) => name as unknown as ReturnType<WorkerEnv["ROOMS"]["idFromName"]>,
      get: () => ({
        fetch: async () => {
          initialized = true;
          return new Response(null, { status: 201 });
        },
      }),
    };
    const request = new Request("https://api.example/api/rooms", {
      method: "POST",
      headers: { Origin: "https://shopping.example", "CF-Connecting-IP": "192.0.2.11" },
      body: "",
    });

    expect(request.body).not.toBeNull();
    const response = await worker.fetch(request, workerEnv(rooms).env);
    expect(response.status).toBe(201);
    expect(initialized).toBe(true);
  });

  it("rejects non-empty request bodies without creating a room", async () => {
    let initialized = false;
    const rooms: WorkerEnv["ROOMS"] = {
      idFromName: (name) => name as unknown as ReturnType<WorkerEnv["ROOMS"]["idFromName"]>,
      get: () => ({
        fetch: async () => {
          initialized = true;
          return new Response(null, { status: 201 });
        },
      }),
    };
    const response = await worker.fetch(new Request("https://api.example/api/rooms", {
      method: "POST",
      headers: { Origin: "https://shopping.example", "CF-Connecting-IP": "192.0.2.11" },
      body: "unexpected",
    }), workerEnv(rooms).env);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "request_body_not_allowed" });
    expect(initialized).toBe(false);
  });

  it("rejects oversized request bodies at the small body limit", async () => {
    let initialized = false;
    const rooms: WorkerEnv["ROOMS"] = {
      idFromName: (name) => name as unknown as ReturnType<WorkerEnv["ROOMS"]["idFromName"]>,
      get: () => ({
        fetch: async () => {
          initialized = true;
          return new Response(null, { status: 201 });
        },
      }),
    };
    const response = await worker.fetch(new Request("https://api.example/api/rooms", {
      method: "POST",
      headers: { Origin: "https://shopping.example", "CF-Connecting-IP": "192.0.2.11" },
      body: "x".repeat(8 * 1024 + 1),
    }), workerEnv(rooms).env);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "body_too_large" });
    expect(initialized).toBe(false);
  });

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
      headers: { Origin: "https://shopping.example", "CF-Connecting-IP": "192.0.2.11" },
    }), workerEnv(rooms).env);
    const body = await response.json() as { roomId: string; roomKey: string; state: { revision: number } };

    expect(response.status).toBe(201);
    expect(body.roomId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.roomKey).toMatch(/^[0-9a-f]{64}$/);
    expect(body.state).toEqual({ revision: 0, members: [], items: [] });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(initializationRequest).toBeDefined();
    expect(new URL(initializationRequest!.url).pathname).toBe("/internal/init");
    expect(await initializationRequest!.json()).toEqual({
      keyHash: createHash("sha256").update(body.roomKey).digest("hex"),
    });
  });
});

describe("shared worker rate limits", () => {
  it("returns a CORS-enabled 429 with Retry-After when room creation exceeds its limit", async () => {
    const createLimiter = mockRateLimiter(() => false);
    const { env } = workerEnv(undefined, createLimiter);
    const response = await worker.fetch(new Request("https://api.example/api/rooms", {
      method: "POST",
      headers: { Origin: "https://shopping.example", "CF-Connecting-IP": "198.51.100.10" },
    }), env);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://shopping.example");
    expect(createLimiter.keys).toEqual(["198.51.100.10"]);
  });

  it("keys room access by CF-Connecting-IP and ignores forwarded IP headers", async () => {
    const readLimiter = mockRateLimiter();
    const { env } = workerEnv({
      idFromName: () => { throw new Error("unauthorized requests should not resolve a room"); },
      get: () => { throw new Error("unauthorized requests should not request a room stub"); },
    }, undefined, readLimiter);
    for (const ip of ["198.51.100.20", "198.51.100.21"]) {
      const response = await worker.fetch(new Request("https://api.example/api/rooms/123e4567-e89b-42d3-a456-426614174000", {
        method: "GET",
        headers: {
          Origin: "https://shopping.example",
          "CF-Connecting-IP": ip,
          "X-Forwarded-For": "203.0.113.99",
          "X-Real-IP": "203.0.113.99",
        },
      }), env);
      expect(response.status).toBe(401);
    }

    expect(readLimiter.keys).toEqual(["198.51.100.20", "198.51.100.21"]);
  });

  it("fails closed when CF-Connecting-IP is missing or invalid", async () => {
    const createLimiter = mockRateLimiter();
    const rooms: WorkerEnv["ROOMS"] = {
      idFromName: () => { throw new Error("room creation must not start without a client IP"); },
      get: () => { throw new Error("room creation must not start without a client IP"); },
    };
    const { env } = workerEnv(rooms, createLimiter);
    for (const cfIp of [undefined, "203.0.113.999"]) {
      const headers = new Headers({
        Origin: "https://shopping.example",
        "X-Forwarded-For": "203.0.113.99",
        "X-Real-IP": "203.0.113.99",
      });
      if (cfIp) headers.set("CF-Connecting-IP", cfIp);
      const response = await worker.fetch(new Request("https://api.example/api/rooms", {
        method: "POST",
        headers,
      }), env);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "client_ip_unavailable" });
    }
    expect(createLimiter.keys).toEqual([]);
  });

  it("fails closed when the rate-limit binding throws", async () => {
    const createLimiter = mockRateLimiter(() => { throw new Error("binding unavailable"); });
    const rooms: WorkerEnv["ROOMS"] = {
      idFromName: () => { throw new Error("room creation must not start after limiter failure"); },
      get: () => { throw new Error("room creation must not start after limiter failure"); },
    };
    const { env } = workerEnv(rooms, createLimiter);
    const response = await worker.fetch(new Request("https://api.example/api/rooms", {
      method: "POST",
      headers: { Origin: "https://shopping.example", "CF-Connecting-IP": "198.51.100.30" },
    }), env);

    expect(response.status).toBe(503);
    expect(createLimiter.keys).toEqual(["198.51.100.30"]);
  });

  it.each([
    ["GET", ""],
    ["POST", "/operations"],
  ])("limits unknown room IDs before resolving a stub (%s %s)", async (method, suffix) => {
    const readLimiter = mockRateLimiter(() => method === "GET" ? false : true);
    const operationLimiter = mockRateLimiter(() => method === "POST" ? false : true);
    const rooms: WorkerEnv["ROOMS"] = {
      idFromName: () => { throw new Error("rate-limited room requests must not resolve an ID"); },
      get: () => { throw new Error("rate-limited room requests must not request a stub"); },
    };
    const { env } = workerEnv(rooms, undefined, readLimiter, operationLimiter);
    const response = await worker.fetch(new Request(`https://api.example/api/rooms/123e4567-e89b-42d3-a456-426614174000${suffix}`, {
      method,
      headers: { Origin: "https://shopping.example", "CF-Connecting-IP": "198.51.100.40" },
    }), env);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(readLimiter.keys).toEqual(method === "GET" ? ["198.51.100.40"] : []);
    expect(operationLimiter.keys).toEqual(method === "POST" ? ["198.51.100.40"] : []);
  });

  it("fails closed when a room rate-limit binding throws", async () => {
    const readLimiter = mockRateLimiter(() => { throw new Error("binding unavailable"); });
    const rooms: WorkerEnv["ROOMS"] = {
      idFromName: () => { throw new Error("room lookup must not start after limiter failure"); },
      get: () => { throw new Error("room lookup must not start after limiter failure"); },
    };
    const { env } = workerEnv(rooms, undefined, readLimiter);
    const response = await worker.fetch(new Request("https://api.example/api/rooms/123e4567-e89b-42d3-a456-426614174000", {
      method: "GET",
      headers: { Origin: "https://shopping.example", "CF-Connecting-IP": "198.51.100.50" },
    }), env);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "rate_limit_unavailable" });
    expect(readLimiter.keys).toEqual(["198.51.100.50"]);
  });
});

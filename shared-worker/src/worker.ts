import {
  applyOperation,
  createInitialState,
  parseOperationEnvelope,
  SharedListError,
  type OperationEnvelope,
  type SharedListState,
  type SharedOperation,
} from "./domain.ts";
import { constantTimeEqual, createCorsHeaders } from "./security.ts";

type SqlValue = string | number | null;
type SqlRow = Record<string, unknown>;

interface SqlCursor {
  toArray(): SqlRow[];
}

interface SqlStorage {
  exec(query: string, ...bindings: SqlValue[]): SqlCursor;
}

interface DurableStorage {
  sql: SqlStorage;
  transactionSync<T>(callback: () => T): T;
}

interface DurableObjectId {}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface WorkerEnv {
  ALLOWED_ORIGINS: string;
  ROOM_CREATE_RATE_LIMIT: RateLimitBinding;
  ROOM_READ_RATE_LIMIT: RateLimitBinding;
  ROOM_OPERATION_RATE_LIMIT: RateLimitBinding;
  ROOMS: {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
  };
}

interface RoomContext {
  storage: DurableStorage;
}

interface RoomMeta {
  keyHash: string;
  revision: number;
  budgetYen: number | null;
}

class RequestFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

class RoomNotFound extends Error {}

const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOM_KEY_PATTERN = /^[0-9a-f]{64}$/;
const MAX_REQUEST_BODY_BYTES = 8 * 1024;
const CREATE_RATE_LIMIT_PERIOD_SECONDS = 60;
const ROOM_RATE_LIMIT_PERIOD_SECONDS = 60;

const IPV4_SEGMENT_PATTERN = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_PATTERN = new RegExp(`^${IPV4_SEGMENT_PATTERN}(?:\\.${IPV4_SEGMENT_PATTERN}){3}$`);

function isIpAddress(value: string): boolean {
  if (IPV4_PATTERN.test(value)) return true;
  if (!value.includes(":") || value.includes("%")) return false;

  const sections = value.split("::");
  if (sections.length > 2) return false;
  const compressed = sections.length === 2;
  const groups = sections.flatMap((section) => section ? section.split(":") : []);
  let groupCount = 0;

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (group.includes(".")) {
      if (index !== groups.length - 1 || !IPV4_PATTERN.test(group)) return false;
      groupCount += 2;
    } else if (/^[0-9a-f]{1,4}$/i.test(group)) {
      groupCount += 1;
    } else {
      return false;
    }
  }

  return compressed ? groupCount < 8 : groupCount === 8;
}

function clientIpFromRequest(request: Request): string | null {
  const ip = request.headers.get("CF-Connecting-IP");
  return ip && isIpAddress(ip) ? ip : null;
}

function roomKeyFromRequest(request: Request): string | null {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get("Authorization") ?? "");
  return match?.[1] ?? null;
}

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

function withHeaders(response: Response, extra: Headers): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of extra) {
    if (name.toLowerCase() === "vary") {
      const existing = headers.get("Vary");
      const values = new Set((existing ? existing.split(",") : []).map((entry) => entry.trim().toLowerCase()));
      values.add("origin");
      headers.set("Vary", [...values].join(", "));
    } else {
      headers.set(name, value);
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function routeFor(pathname: string): { kind: "create" } | { kind: "state" | "operations"; roomId: string } | null {
  if (pathname === "/api/rooms") return { kind: "create" };
  const match = /^\/api\/rooms\/([^/]+)(\/operations)?$/.exec(pathname);
  if (!match || !ROOM_ID_PATTERN.test(match[1])) return null;
  return { kind: match[2] ? "operations" : "state", roomId: match[1] };
}

function methodFor(route: NonNullable<ReturnType<typeof routeFor>>): string {
  if (route.kind === "state") return "GET";
  return "POST";
}

function randomRoomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requestedHeadersAllowed(request: Request): boolean {
  const value = request.headers.get("Access-Control-Request-Headers");
  if (!value) return true;
  const allowed = new Set(["authorization", "content-type"]);
  return value.split(",").map((header) => header.trim().toLowerCase()).every((header) => allowed.has(header));
}

function domainErrorResponse(error: SharedListError, currentRevision?: number): Response {
  const status = error.code === "invalid_input" ? 400
    : error.code === "item_not_found" ? 404
      : error.code === "revision_conflict" || error.code === "duplicate_item" ? 409
        : error.code === "list_full" ? 422
          : 409;
  return jsonResponse({ error: error.code, ...(currentRevision === undefined ? {} : { currentRevision }) }, status);
}

async function readJsonLimited(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.body) throw new RequestFailure(400, "invalid_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new RequestFailure(413, "body_too_large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new RequestFailure(400, "invalid_json");
  }
}

async function validateEmptyRequestBody(request: Request): Promise<Response | null> {
  if (request.body === null) return null;

  const reader = request.body.getReader();
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return jsonResponse({ error: "body_too_large" }, 413);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return length === 0 ? null : jsonResponse({ error: "request_body_not_allowed" }, 400);
}

function operationContentTypeIsJson(request: Request): boolean {
  return request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

export class SharedRoom {
  private readonly storage: DurableStorage;
  private readonly sql: SqlStorage;
  private initialized: boolean | null = null;

  constructor(context: RoomContext) {
    this.storage = context.storage;
    this.sql = context.storage.sql;
  }

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/internal/init" && request.method === "POST") return this.initialize(request);

    const route = routeFor(pathname);
    if (!route || route.kind === "create") return jsonResponse({ error: "not_found" }, 404);
    if (request.method !== methodFor(route)) {
      return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: methodFor(route) });
    }

    if (!await this.authorized(request)) {
      return jsonResponse({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
    }

    if (route.kind === "state") return this.getState();
    return this.applyRequest(request);
  }

  private async initialize(request: Request): Promise<Response> {
    let input: unknown;
    try {
      input = await request.json() as unknown;
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return jsonResponse({ error: "invalid_input" }, 400);
    }
    const keyHash = (input as Record<string, unknown>).keyHash;
    if (typeof keyHash !== "string" || !ROOM_KEY_PATTERN.test(keyHash)) {
      return jsonResponse({ error: "invalid_input" }, 400);
    }

    let createdTables = false;
    const created = this.storage.transactionSync(() => {
      if (!this.hasRoomTables()) {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS room_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          key_hash TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          budget_yen INTEGER CHECK (budget_yen IS NULL OR (budget_yen >= 0 AND budget_yen <= 1000000000))
        )`);
        this.sql.exec(`CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY,
          product_id TEXT,
          name TEXT NOT NULL,
          price_yen INTEGER CHECK (price_yen IS NULL OR (price_yen >= 0 AND price_yen <= 1000000000)),
          quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
          purchased INTEGER NOT NULL CHECK (purchased IN (0, 1))
        )`);
        createdTables = true;
      }
      if (this.readMetaFromTables()) return false;
      this.sql.exec("INSERT INTO room_meta (singleton, key_hash, revision, budget_yen) VALUES (1, ?, 0, NULL)", keyHash);
      return true;
    });
    if (createdTables) this.initialized = true;
    return created ? jsonResponse({ revision: 0 }, 201) : jsonResponse({ error: "already_initialized" }, 409);
  }

  private async authorized(request: Request): Promise<boolean> {
    const roomKey = roomKeyFromRequest(request);
    if (!roomKey) return false;
    const candidateHash = await sha256Hex(roomKey);
    const meta = this.readMeta();
    return meta !== null && constantTimeEqual(candidateHash, meta.keyHash);
  }

  private readMeta(): RoomMeta | null {
    if (!this.hasRoomTables()) return null;
    return this.readMetaFromTables();
  }

  private readMetaFromTables(): RoomMeta | null {
    const row = this.sql.exec("SELECT key_hash, revision, budget_yen FROM room_meta WHERE singleton = 1").toArray()[0];
    if (!row) return null;
    if (typeof row.key_hash !== "string" || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision)) {
      throw new Error("stored room metadata is invalid");
    }
    if (row.budget_yen !== null && typeof row.budget_yen !== "number") throw new Error("stored budget is invalid");
    return { keyHash: row.key_hash, revision: row.revision, budgetYen: row.budget_yen as number | null };
  }

  private hasRoomTables(): boolean {
    if (this.initialized !== null) return this.initialized;
    this.initialized = this.sql.exec(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'room_meta'",
    ).toArray().length > 0;
    return this.initialized;
  }

  private readState(): SharedListState | null {
    const meta = this.readMeta();
    if (!meta) return null;
    const items = this.sql.exec("SELECT id, product_id, name, price_yen, quantity, purchased FROM items ORDER BY rowid").toArray();
    return {
      revision: meta.revision,
      budgetYen: meta.budgetYen,
      items: items.map((row) => {
        if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.quantity !== "number" || typeof row.purchased !== "number") {
          throw new Error("stored item is invalid");
        }
        if (row.product_id !== null && typeof row.product_id !== "string") throw new Error("stored product id is invalid");
        if (row.price_yen !== null && typeof row.price_yen !== "number") throw new Error("stored item price is invalid");
        return {
          id: row.id,
          productId: row.product_id as string | null,
          name: row.name,
          priceYen: row.price_yen as number | null,
          quantity: row.quantity,
          purchased: row.purchased === 1,
        };
      }),
    };
  }

  private getState(): Response {
    const state = this.storage.transactionSync(() => this.readState());
    return state ? jsonResponse(state) : jsonResponse({ error: "not_found" }, 404);
  }

  private async applyRequest(request: Request): Promise<Response> {
    if (!operationContentTypeIsJson(request)) return jsonResponse({ error: "content_type_must_be_json" }, 415);

    let envelope: OperationEnvelope;
    try {
      envelope = parseOperationEnvelope(await readJsonLimited(request, MAX_REQUEST_BODY_BYTES));
    } catch (error) {
      if (error instanceof RequestFailure) return jsonResponse({ error: error.code }, error.status);
      if (error instanceof SharedListError) return domainErrorResponse(error);
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    try {
      const updated = this.storage.transactionSync(() => {
        const current = this.readState();
        if (!current) throw new RoomNotFound();
        const next = applyOperation(current, envelope);
        this.persistOperation(envelope.operation, next);
        return next;
      });
      return jsonResponse(updated);
    } catch (error) {
      if (error instanceof RoomNotFound) return jsonResponse({ error: "not_found" }, 404);
      if (error instanceof SharedListError) {
        const current = this.readMeta();
        return domainErrorResponse(error, error.code === "revision_conflict" ? current?.revision : undefined);
      }
      return jsonResponse({ error: "storage_unavailable" }, 503);
    }
  }

  private persistOperation(operation: SharedOperation, state: SharedListState): void {
    this.sql.exec("UPDATE room_meta SET revision = ?, budget_yen = ? WHERE singleton = 1", state.revision, state.budgetYen);
    switch (operation.type) {
      case "add":
        this.sql.exec(
          "INSERT INTO items (id, product_id, name, price_yen, quantity, purchased) VALUES (?, ?, ?, ?, ?, 0)",
          operation.item.id,
          operation.item.productId,
          operation.item.name,
          operation.item.priceYen,
          operation.item.quantity,
        );
        break;
      case "remove":
        this.sql.exec("DELETE FROM items WHERE id = ?", operation.itemId);
        break;
      case "set-quantity":
        this.sql.exec("UPDATE items SET quantity = ? WHERE id = ?", operation.quantity, operation.itemId);
        break;
      case "set-purchased":
        this.sql.exec("UPDATE items SET purchased = ? WHERE id = ?", operation.purchased ? 1 : 0, operation.itemId);
        break;
      case "set-budget":
        break;
    }
  }
}

async function createRoom(env: WorkerEnv, request: Request): Promise<Response> {
  const bodyError = await validateEmptyRequestBody(request);
  if (bodyError) return bodyError;

  const roomId = crypto.randomUUID();
  const roomKey = randomRoomKey();
  const keyHash = await sha256Hex(roomKey);
  const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
  const initialized = await stub.fetch(new Request("https://room.internal/internal/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyHash }),
  }));
  if (!initialized.ok) return jsonResponse({ error: "room_creation_failed" }, 503);

  return jsonResponse({ roomId, roomKey, state: createInitialState() }, 201);
}

async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const origin = request.headers.get("Origin");
  const isPreflight = request.method === "OPTIONS";
  const corsHeaders = createCorsHeaders(origin, env.ALLOWED_ORIGINS, isPreflight);
  if (!corsHeaders) return jsonResponse({ error: "origin_not_allowed" }, 403);

  const route = routeFor(new URL(request.url).pathname);
  if (!route) return withHeaders(jsonResponse({ error: "not_found" }, 404), corsHeaders);

  if (isPreflight) {
    if (!requestedHeadersAllowed(request)) {
      return withHeaders(jsonResponse({ error: "request_headers_not_allowed" }, 403), corsHeaders);
    }
    const requestedMethod = request.headers.get("Access-Control-Request-Method");
    if (requestedMethod && requestedMethod !== methodFor(route)) {
      return withHeaders(jsonResponse({ error: "method_not_allowed" }, 405, { Allow: methodFor(route) }), corsHeaders);
    }
    return withHeaders(new Response(null, { status: 204 }), corsHeaders);
  }

  const expectedMethod = methodFor(route);
  if (request.method !== expectedMethod) {
    return withHeaders(jsonResponse({ error: "method_not_allowed" }, 405, { Allow: expectedMethod }), corsHeaders);
  }

  const clientIp = clientIpFromRequest(request);
  if (!clientIp) {
    return withHeaders(jsonResponse({ error: "client_ip_unavailable" }, 503), corsHeaders);
  }

  const rateLimit = route.kind === "create" ? env.ROOM_CREATE_RATE_LIMIT
    : route.kind === "state" ? env.ROOM_READ_RATE_LIMIT
      : env.ROOM_OPERATION_RATE_LIMIT;
  try {
    const { success } = await rateLimit.limit({ key: clientIp });
    if (!success) {
      const retryAfter = route.kind === "create"
        ? CREATE_RATE_LIMIT_PERIOD_SECONDS
        : ROOM_RATE_LIMIT_PERIOD_SECONDS;
      return withHeaders(jsonResponse({ error: "rate_limited" }, 429, { "Retry-After": String(retryAfter) }), corsHeaders);
    }
  } catch {
    return withHeaders(jsonResponse({ error: "rate_limit_unavailable" }, 503), corsHeaders);
  }

  if (route.kind !== "create" && !roomKeyFromRequest(request)) {
    return withHeaders(jsonResponse({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" }), corsHeaders);
  }

  try {
    if (route.kind === "create") return withHeaders(await createRoom(env, request), corsHeaders);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(route.roomId));
    const response = await stub.fetch(request);
    return withHeaders(response, corsHeaders);
  } catch {
    return withHeaders(jsonResponse({ error: "service_unavailable" }, 503), corsHeaders);
  }
}

const worker = {
  fetch: handleRequest,
};

export default worker;

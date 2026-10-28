import type { SharedListState, SharedOperation } from "./types.ts";
import {
  isRoomId,
  isRoomKey,
  normalizeSharedOperation,
  normalizeSharedState,
  type SharedClientError,
  type SharedRoomCredentials,
  type SharedSyncSnapshot,
  type StorageLike,
} from "./types.ts";

type QueueEntry = {
  id: string;
  operation: SharedOperation;
  baseRevision: number | null;
};

export type SharedListClientOptions = {
  apiUrl: string | URL;
  roomId: string;
  roomKey: string;
  storage?: StorageLike;
  tabStorage?: StorageLike;
  tabLockManager?: LockManager;
  requestTimeoutMs?: number;
  fetcher?: typeof fetch;
};

export type SharedRoomResult = SharedRoomCredentials & { state: SharedListState };
type Listener = (snapshot: SharedSyncSnapshot) => void;

class ClientFailure extends Error {
  readonly code: string;
  readonly status?: number;
  readonly currentRevision?: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, options: { status?: number; currentRevision?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "SharedListClientError";
    this.code = code;
    this.status = options.status;
    this.currentRevision = options.currentRevision;
    this.retryable = options.retryable ?? false;
  }
}

const QUEUE_KEY_PREFIX = "nazomarket2026:shared:v2:outbox:";
const LEGACY_QUEUE_KEY_PREFIX = "nazomarket2026:shared:v1:outbox:";
const TAB_ID_KEY = "nazomarket2026:shared:v2:tab-id";
const TAB_LOCK_PREFIX = "nazomarket2026:shared:tab-owner:";
const LEGACY_MIGRATION_LOCK_PREFIX = "nazomarket2026:shared:legacy-migration:";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const ROOM_PATH = (roomId: string) => "/api/rooms/" + encodeURIComponent(roomId);

type TabLockClaim = {
  context: object;
  name: string;
  result: Promise<"acquired" | "busy" | "failed">;
  state: "acquired" | "busy" | "failed";
  references: number;
  release: () => void;
};

const tabLockClaims = new WeakMap<object, Map<string, TabLockClaim>>();
const tabIdentityForks = new WeakMap<object, Map<string, Promise<string>>>();

function forkTabIdentity(context: object, oldTabId: string, tabStorage: StorageLike): Promise<string> {
  let forks = tabIdentityForks.get(context);
  if (!forks) {
    forks = new Map<string, Promise<string>>();
    tabIdentityForks.set(context, forks);
  }
  const existing = forks.get(oldTabId);
  if (existing) return existing;
  const task = Promise.resolve().then(() => {
    const currentTabId = tabStorage.getItem(TAB_ID_KEY);
    if (currentTabId && currentTabId !== oldTabId && /^[a-z0-9-]{16,64}$/iu.test(currentTabId)) return currentTabId;
    const nextTabId = createTabId();
    tabStorage.setItem(TAB_ID_KEY, nextTabId);
    return nextTabId;
  });
  forks.set(oldTabId, task);
  return task;
}

function acquireTabLockClaim(manager: LockManager, context: object, name: string): TabLockClaim {
  let claims = tabLockClaims.get(context);
  if (!claims) {
    claims = new Map<string, TabLockClaim>();
    tabLockClaims.set(context, claims);
  }
  const current = claims.get(name);
  if (current) {
    current.references += 1;
    return current;
  }

  let resolveResult!: (result: "acquired" | "busy" | "failed") => void;
  const result = new Promise<"acquired" | "busy" | "failed">((resolve) => { resolveResult = resolve; });
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const claim: TabLockClaim = {
    context,
    name,
    result,
    state: "failed",
    references: 1,
    release: () => release(),
  };
  claims.set(name, claim);

  try {
    const request = manager.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        claim.state = "busy";
        resolveResult("busy");
        return;
      }
      claim.state = "acquired";
      resolveResult("acquired");
      await hold;
    });
    void request.then(() => {
      if (claim.state !== "acquired" && claims!.get(name) === claim) claims!.delete(name);
    }, () => {
      if (claim.state !== "acquired") {
        claim.state = "failed";
        resolveResult("failed");
        if (claims!.get(name) === claim) claims!.delete(name);
      }
    });
  } catch {
    resolveResult("failed");
    claims.delete(name);
  }
  return claim;
}

function releaseTabLockClaim(claim: TabLockClaim): void {
  claim.references -= 1;
  if (claim.references > 0) return;
  const claims = tabLockClaims.get(claim.context);
  if (claims?.get(claim.name) === claim) claims.delete(claim.name);
  claim.release();
}

function normalizeApiUrl(value: string | URL): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("A valid shared list API URL is required.");
  }
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && localHost))
    || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error("Use the HTTPS origin of the deployed shared list API (HTTP is allowed for localhost).");
  }
  return url.origin;
}

function cloneState(state: SharedListState | null): SharedListState | null {
  return state === null ? null : { ...state, items: state.items.map((item) => ({ ...item })) };
}

function publicFailure(error: ClientFailure): SharedClientError {
  return {
    code: error.code,
    message: error.message,
    ...(error.status === undefined ? {} : { status: error.status }),
  };
}

function failureMessage(code: string, status?: number): string {
  if (code === "network_error" || code === "request_timeout" || (status !== undefined && status >= 500)) {
    return "共有リストAPIに接続できません。保留中の操作は端末に保存しました。";
  }
  if (code === "unauthorized") return "共有リンクの鍵を確認してください。";
  if (code === "storage_unavailable") return "未送信の操作を端末に保存できませんでした。操作は送信していません。";
  if (code === "tab_identity_unavailable") return "このブラウザーでタブごとのキューを保護できません。操作は送信していません。";
  if (code === "invalid_response") return "共有リストAPIから不正な応答が返りました。";
  return status === undefined
    ? "共有リストの同期に失敗しました。"
    : `共有リストAPIでエラーが発生しました（${status}）。`;
}

async function responseFailure(response: Response): Promise<ClientFailure> {
  let value: unknown;
  try {
    value = await response.json() as unknown;
  } catch {
    value = null;
  }
  const body = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const code = typeof body.error === "string" && /^[a-z_]+$/u.test(body.error) ? body.error : "request_failed";
  const currentRevision = typeof body.currentRevision === "number"
    && Number.isSafeInteger(body.currentRevision) && body.currentRevision >= 0
    ? body.currentRevision
    : undefined;
  return new ClientFailure(code, failureMessage(code, response.status), {
    status: response.status,
    currentRevision,
    retryable: response.status >= 500,
  });
}

function createTabId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function request<T>(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  readResponse: (response: Response) => Promise<T>,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new ClientFailure("request_timeout", failureMessage("request_timeout"), { retryable: true }));
      controller.abort();
    }, timeoutMs);
  });
  const operation = (async () => {
    const response = await fetcher(url, {
      ...init,
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    return readResponse(response);
  })();
  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (error instanceof ClientFailure) throw error;
    if (timedOut) {
      throw new ClientFailure("request_timeout", failureMessage("request_timeout"), { retryable: true });
    }
    throw new ClientFailure("network_error", failureMessage("network_error"), { retryable: true });
  } finally {
    clearTimeout(timer!);
  }
}

function validQueue(raw: unknown): QueueEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const queue: QueueEntry[] = [];
  for (const value of raw) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "id" && key !== "operation" && key !== "baseRevision")) return null;
    const id = record.id;
    if (id !== undefined && (typeof id !== "string" || !/^[a-z0-9-]{16,64}$/iu.test(id))) return null;
    const operation = normalizeSharedOperation(record.operation);
    const baseRevision = record.baseRevision;
    if (!operation || !(baseRevision === null || (typeof baseRevision === "number" && Number.isSafeInteger(baseRevision) && baseRevision >= 0))) return null;
    queue.push({ id: typeof id === "string" ? id : createTabId(), operation, baseRevision });
  }
  return queue;
}

export async function createSharedRoom(apiUrl: string | URL, fetcher: typeof fetch = fetch): Promise<SharedRoomResult> {
  const baseUrl = normalizeApiUrl(apiUrl);
  return request(fetcher, baseUrl + "/api/rooms", {
    method: "POST",
    headers: { Accept: "application/json" },
  }, async (response) => {
    if (response.status !== 201) {
      if (!response.ok) throw await responseFailure(response);
      throw new ClientFailure("invalid_response", failureMessage("invalid_response"));
    }

    let value: unknown;
    try {
      value = await response.json() as unknown;
    } catch {
      throw new ClientFailure("invalid_response", failureMessage("invalid_response"));
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ClientFailure("invalid_response", failureMessage("invalid_response"));
    }
    const body = value as Record<string, unknown>;
    const state = normalizeSharedState(body.state);
    if (!isRoomId(body.roomId) || !isRoomKey(body.roomKey) || !state) {
      throw new ClientFailure("invalid_response", failureMessage("invalid_response"));
    }
    return { roomId: body.roomId, roomKey: body.roomKey, state };
  });
}

export class SharedListClient {
  readonly #apiUrl: string;
  readonly #roomId: string;
  readonly #roomKey: string;
  readonly #storage: StorageLike | null;
  #tabStorage: StorageLike | null = null;
  readonly #tabContext: object;
  readonly #tabLockManager: LockManager | null;
  readonly #fetcher: typeof fetch;
  #storageKey: string;
  #tabId: string | null = null;
  readonly #requestTimeoutMs: number;
  readonly #listeners = new Set<Listener>();
  #state: SharedListState | null = null;
  #queue: QueueEntry[] = [];
  #status: SharedSyncSnapshot["status"] = "idle";
  #error: ClientFailure | null = null;
  #blockedFailure: ClientFailure | null = null;
  #conflict: SharedSyncSnapshot["conflict"] = null;
  #loadFailure: ClientFailure | null = null;
  #syncTask: Promise<void> | null = null;
  #syncRequested = false;
  #ownershipTask: Promise<boolean> | null = null;
  #serialTask: Promise<void> = Promise.resolve();
  #outboxMutationTask: Promise<void> = Promise.resolve();
  #tabLockClaim: TabLockClaim | null = null;
  #disposed = false;
  #pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SharedListClientOptions) {
    if (!isRoomId(options.roomId) || !isRoomKey(options.roomKey)) {
      throw new Error("Shared room credentials are invalid.");
    }
    this.#apiUrl = normalizeApiUrl(options.apiUrl);
    this.#roomId = options.roomId;
    this.#roomKey = options.roomKey;
    this.#fetcher = options.fetcher ?? fetch;
    this.#tabContext = options.tabStorage ?? globalThis;
    this.#tabLockManager = options.tabLockManager
      ?? (typeof navigator === "undefined" ? null : navigator.locks ?? null);
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(this.#requestTimeoutMs) || this.#requestTimeoutMs < 1) {
      throw new Error("Request timeout must be at least 1 millisecond.");
    }

    try {
      const storage = options.storage ?? globalThis.localStorage;
      const tabStorage = options.tabStorage ?? globalThis.sessionStorage;
      if (!storage || !tabStorage) throw new Error("Browser storage is unavailable.");
      let tabId = tabStorage.getItem(TAB_ID_KEY);
      if (!tabId || !/^[a-z0-9-]{16,64}$/iu.test(tabId)) {
        tabId = createTabId();
        tabStorage.setItem(TAB_ID_KEY, tabId);
      }
      this.#storage = storage;
      this.#tabStorage = tabStorage;
      this.#tabId = tabId;
      this.#storageKey = QUEUE_KEY_PREFIX + this.#roomId + ":" + tabId;
    } catch {
      this.#storage = null;
      this.#tabStorage = null;
      this.#tabId = null;
      this.#storageKey = QUEUE_KEY_PREFIX + this.#roomId + ":unavailable";
      this.#loadFailure = new ClientFailure("storage_unavailable", failureMessage("storage_unavailable"));
    }
    if (!this.#tabLockManager && !this.#loadFailure) {
      this.#loadFailure = new ClientFailure("tab_identity_unavailable", failureMessage("tab_identity_unavailable"));
    }
    if (this.#loadFailure) {
      this.#error = this.#loadFailure;
      this.#status = "error";
    }
  }

  getSnapshot(): SharedSyncSnapshot {
    return {
      state: cloneState(this.#state),
      status: this.#status,
      pendingOperations: this.#queue.map((entry) => normalizeSharedOperation(entry.operation)!).filter(Boolean),
      pendingOperationIds: this.#queue.map((entry) => entry.id),
      conflict: this.#conflict === null
        ? null
        : {
          baseRevision: this.#conflict.baseRevision,
          currentRevision: this.#conflict.currentRevision,
          operations: this.#conflict.operations.map((operation) => normalizeSharedOperation(operation)!).filter(Boolean),
        },
      error: this.#error === null ? null : publicFailure(this.#error),
    };
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.#listeners.delete(listener);
  }

  async enqueue(value: SharedOperation): Promise<void> {
    await this.#requireTabOwnership();
    const operation = normalizeSharedOperation(value);
    if (!operation) throw new Error("Shared list operation is invalid.");
    await this.#appendQueueEntry(operation);
    await this.sync();
  }

  sync(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error("The shared list client has been disposed."));
    if (this.#syncTask) {
      this.#syncRequested = true;
      return this.#syncTask;
    }
    const task = this.#runExclusive(async () => {
      const ready = await this.#ensureTabOwnership();
      if (ready || this.#loadFailure) await this.#performSync();
    }).finally(() => {
      if (this.#syncTask === task) {
        this.#syncTask = null;
        const shouldRunAgain = this.#syncRequested
          && !this.#disposed
          && this.#queue.length > 0
          && this.#status === "idle"
          && this.#conflict === null
          && this.#blockedFailure === null;
        this.#syncRequested = false;
        if (shouldRunAgain) void this.sync().catch(() => undefined);
      }
    });
    this.#syncTask = task;
    return task;
  }

  startPolling(intervalMs = 5_000): () => void {
    if (!Number.isFinite(intervalMs) || intervalMs < 250) {
      throw new Error("Polling interval must be at least 250 milliseconds.");
    }
    this.stopPolling();
    void this.sync();
    this.#pollTimer = setInterval(() => { void this.sync(); }, intervalMs);
    return () => this.stopPolling();
  }

  stopPolling(): void {
    if (this.#pollTimer === null) return;
    clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }

  resolveConflict(action: "rebase" | "discard"): Promise<void> {
    return this.#runRecovery(async () => {
      await this.#requireTabOwnership();
      if (!this.#conflict || !this.#state) throw new Error("There is no shared list conflict to resolve.");
      const nextQueue = action === "discard"
        ? []
        : this.#queue.map((entry, index) => ({
          ...entry,
          baseRevision: this.#state!.revision + index,
        }));
      if (nextQueue.some((entry) => entry.baseRevision !== null && !Number.isSafeInteger(entry.baseRevision))) {
        throw new Error("The shared list revision limit has been reached.");
      }
      this.#saveQueue(nextQueue);
      this.#queue = nextQueue;
      this.#conflict = null;
      this.#error = null;
      this.#blockedFailure = null;
      this.#status = "idle";
      this.#publish();
      await this.#performSync();
    });
  }

  resolvePendingOperation(
    action: "mark-applied" | "retry" | "discard",
    expectedOperationId = this.#queue[0]?.id,
  ): Promise<void> {
    return this.#runRecovery(async () => {
      await this.#requireTabOwnership();
      const head = this.#queue[0];
      if (!head || !expectedOperationId || head.id !== expectedOperationId) {
        throw new Error("The pending operation changed. Review the current queue before resolving it.");
      }

      let state: SharedListState;
      try {
        state = await this.#getState();
      } catch (error) {
        this.#handleFailure(error);
        throw error;
      }
      this.#state = state;

      const remaining = action === "retry" ? this.#queue : this.#queue.slice(1);
      const nextQueue = remaining.map((entry, index) => ({
        ...entry,
        baseRevision: state.revision + index,
      }));
      if (nextQueue.some((entry) => !Number.isSafeInteger(entry.baseRevision))) {
        throw new Error("The shared list revision limit has been reached.");
      }
      try {
        this.#saveQueue(nextQueue);
      } catch (error) {
        this.#handleFailure(error);
        throw error;
      }
      this.#queue = nextQueue;
      this.#conflict = null;
      this.#error = null;
      this.#blockedFailure = null;
      this.#status = "idle";
      this.#publish();
      await this.#performSync();
    });
  }

  retryPending(): Promise<void> {
    return this.#runRecovery(async () => {
      await this.#requireTabOwnership();
      this.#blockedFailure = null;
      this.#error = null;
      this.#status = "idle";
      this.#publish();
      await this.#performSync();
    });
  }

  discardPending(): Promise<void> {
    return this.#runRecovery(async () => {
      await this.#requireTabOwnership();
      if (this.#queue.length === 0) return;
      try {
        this.#saveQueue([]);
      } catch (error) {
        this.#handleFailure(error);
        throw error;
      }
      this.#queue = [];
      this.#conflict = null;
      this.#blockedFailure = null;
      this.#error = null;
      this.#status = "idle";
      this.#publish();
      await this.#performSync();
    });
  }

  async dispose(): Promise<void> {
    this.stopPolling();
    this.#disposed = true;
    await this.#serialTask;
    if (this.#tabLockClaim) releaseTabLockClaim(this.#tabLockClaim);
    this.#tabLockClaim = null;
  }

  #runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.#serialTask.then(operation, operation);
    this.#serialTask = task.then(() => undefined, () => undefined);
    return task;
  }

  #runRecovery<T>(operation: () => Promise<T>): Promise<T> {
    return this.#runExclusive(operation);
  }

  #mutateOutbox<T>(mutation: () => T): Promise<T> {
    const task = this.#outboxMutationTask.then(mutation, mutation);
    this.#outboxMutationTask = task.then(() => undefined, () => undefined);
    return task;
  }

  async #appendQueueEntry(operation: SharedOperation): Promise<void> {
    await this.#mutateOutbox(() => {
      if (this.#disposed) throw new Error("The shared list client has been disposed.");
      if (this.#loadFailure) throw this.#loadFailure;
      if (this.#conflict) throw new Error("Resolve the shared list conflict before adding more operations.");

      const lastEntry = this.#queue[this.#queue.length - 1];
      const baseRevision = lastEntry
        ? lastEntry.baseRevision === null ? null : lastEntry.baseRevision + 1
        : this.#state?.revision ?? null;
      const nextQueue = [...this.#queue, { id: createTabId(), operation, baseRevision }];
      try {
        this.#saveQueue(nextQueue);
      } catch (error) {
        this.#handleFailure(error);
        throw error;
      }
      this.#queue = nextQueue;
      this.#publish();
    });
  }

  #ensureTabOwnership(): Promise<boolean> {
    if (this.#disposed) return Promise.resolve(false);
    if (this.#ownershipTask) return this.#ownershipTask;
    const task = this.#initializeTabOwnership();
    this.#ownershipTask = task;
    return task;
  }

  async #requireTabOwnership(): Promise<void> {
    if (this.#disposed) throw new Error("The shared list client has been disposed.");
    if (await this.#ensureTabOwnership()) return;
    throw this.#loadFailure ?? new ClientFailure("tab_identity_unavailable", failureMessage("tab_identity_unavailable"));
  }

  async #initializeTabOwnership(): Promise<boolean> {
    if (this.#loadFailure || this.#disposed || !this.#storage || !this.#tabStorage || !this.#tabLockManager || !this.#tabId) {
      return false;
    }

    let claim: "acquired" | "busy" | "failed" = "busy";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      claim = await this.#claimTabLock();
      if (claim !== "busy" || attempt === 2) break;
      this.#releaseCurrentTabLockClaim();
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    if (claim === "failed") {
      this.#releaseCurrentTabLockClaim();
      this.#setLoadFailure(new ClientFailure("tab_identity_unavailable", failureMessage("tab_identity_unavailable")));
      return false;
    }

    const allowLegacyMigration = claim === "acquired";
    if (claim === "busy") {
      this.#releaseCurrentTabLockClaim();
      try {
        this.#tabId = await forkTabIdentity(this.#tabContext, this.#tabId!, this.#tabStorage);
        this.#storageKey = QUEUE_KEY_PREFIX + this.#roomId + ":" + this.#tabId;
        const forkClaim = await this.#claimTabLock();
        if (forkClaim !== "acquired") {
          this.#releaseCurrentTabLockClaim();
          this.#setLoadFailure(new ClientFailure("tab_identity_unavailable", failureMessage("tab_identity_unavailable")));
          return false;
        }
        this.#queue = [];
        this.#state = null;
        this.#conflict = null;
        this.#blockedFailure = null;
        this.#error = null;
        this.#status = "idle";
        this.#publish();
      } catch {
        this.#setLoadFailure(new ClientFailure("storage_unavailable", failureMessage("storage_unavailable")));
        return false;
      }
    }

    await this.#loadOutbox(allowLegacyMigration);
    return this.#loadFailure === null;
  }

  async #claimTabLock(): Promise<"acquired" | "busy" | "failed"> {
    const manager = this.#tabLockManager;
    if (!manager || !this.#tabId) return "failed";
    const lockName = TAB_LOCK_PREFIX + this.#tabId;
    this.#tabLockClaim = acquireTabLockClaim(manager, this.#tabContext, lockName);
    return this.#tabLockClaim.result;
  }

  #releaseCurrentTabLockClaim(): void {
    if (!this.#tabLockClaim) return;
    releaseTabLockClaim(this.#tabLockClaim);
    this.#tabLockClaim = null;
  }

  async #loadOutbox(allowLegacyMigration: boolean): Promise<void> {
    if (!this.#storage || !this.#tabLockManager) return;
    try {
      let raw = this.#storage.getItem(this.#storageKey);
      if (raw === null && allowLegacyMigration) {
        const legacyKey = LEGACY_QUEUE_KEY_PREFIX + this.#roomId;
        const migratedRaw = await this.#tabLockManager.request(
          LEGACY_MIGRATION_LOCK_PREFIX + this.#roomId,
          { ifAvailable: false },
          async (lock) => {
            if (!lock) return null;
            const existing = this.#storage!.getItem(this.#storageKey);
            if (existing !== null) return existing;
            const legacyRaw = this.#storage!.getItem(legacyKey);
            if (legacyRaw === null) return null;
            const parsed = this.#parseQueue(legacyRaw);
            if (parsed === null) return legacyRaw;
            const serialized = JSON.stringify(parsed);
            this.#storage!.setItem(this.#storageKey, serialized);
            this.#storage!.removeItem(legacyKey);
            return serialized;
          },
        );
        raw = migratedRaw ?? this.#storage.getItem(this.#storageKey);
      }
      if (raw !== null) {
        const queue = this.#parseQueue(raw);
        if (queue === null) {
          this.#setLoadFailure(new ClientFailure("outbox_corrupt", "保留中の操作を読み取れません。保存データは変更していません。"));
          return;
        }
        this.#queue = queue;
        const normalizedRaw = JSON.stringify(queue);
        if (normalizedRaw !== raw) this.#storage.setItem(this.#storageKey, normalizedRaw);
      }
      this.#publish();
    } catch {
      this.#setLoadFailure(new ClientFailure("storage_unavailable", failureMessage("storage_unavailable")));
    }
  }

  #parseQueue(raw: string): QueueEntry[] | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
    return validQueue(parsed);
  }

  #setLoadFailure(failure: ClientFailure): void {
    this.#loadFailure = failure;
    this.#error = failure;
    this.#status = "error";
    this.#publish();
  }

  async #performSync(): Promise<void> {
    if (this.#loadFailure) {
      this.#error = this.#loadFailure;
      this.#status = "error";
      this.#publish();
      return;
    }
    this.#status = "syncing";
    this.#error = null;
    this.#publish();

    let state: SharedListState;
    try {
      state = await this.#getState();
    } catch (error) {
      this.#handleFailure(error);
      return;
    }
    this.#state = state;

    const pendingHead = this.#queue[0];
    if (pendingHead?.baseRevision !== null && pendingHead?.baseRevision !== undefined
      && pendingHead.baseRevision !== state.revision) {
      this.#setConflict(pendingHead.baseRevision, state.revision);
      return;
    }
    this.#conflict = null;
    this.#publish();

    if (this.#blockedFailure) {
      this.#error = this.#blockedFailure;
      this.#status = "error";
      this.#publish();
      return;
    }

    while (this.#queue.length > 0) {
      const head = this.#queue[0];
      const baseRevision = head.baseRevision ?? state.revision;
      if (baseRevision !== state.revision) {
        this.#setConflict(baseRevision, state.revision);
        return;
      }
      if (head.baseRevision === null) {
        try {
          await this.#mutateOutbox(() => {
            if (this.#queue[0]?.id !== head.id) {
              throw new ClientFailure("outbox_changed", "保留中の操作が更新されました。キューを確認してください。");
            }
            const nextQueue = [{ ...this.#queue[0]!, baseRevision }, ...this.#queue.slice(1)];
            this.#saveQueue(nextQueue);
            this.#queue = nextQueue;
          });
        } catch (error) {
          this.#handleFailure(error);
          return;
        }
      }

      let updated: SharedListState;
      try {
        updated = await this.#postOperation(baseRevision, head.operation);
      } catch (error) {
        if (error instanceof ClientFailure && error.status === 409 && error.code === "revision_conflict") {
          try {
            state = await this.#getState();
            this.#state = state;
            this.#setConflict(baseRevision, state.revision);
          } catch (readError) {
            this.#handleFailure(readError);
          }
          return;
        }
        this.#handleFailure(error);
        return;
      }

      state = updated;
      this.#state = updated;
      try {
        await this.#mutateOutbox(() => {
          if (this.#queue[0]?.id !== head.id) {
            throw new ClientFailure("outbox_changed", "保留中の操作が更新されました。キューを確認してください。");
          }
          const nextQueue = this.#queue.slice(1);
          this.#saveQueue(nextQueue);
          this.#queue = nextQueue;
        });
      } catch (error) {
        this.#handleFailure(error);
        return;
      }
      this.#error = null;
      this.#publish();
    }

    this.#status = "idle";
    this.#error = null;
    this.#publish();
  }

  async #getState(): Promise<SharedListState> {
    return request(this.#fetcher, this.#apiUrl + ROOM_PATH(this.#roomId), {
      method: "GET",
      headers: { Accept: "application/json", Authorization: "Bearer " + this.#roomKey },
    }, async (response) => {
      if (!response.ok) throw await responseFailure(response);
      let value: unknown;
      try {
        value = await response.json() as unknown;
      } catch {
        throw new ClientFailure("invalid_response", failureMessage("invalid_response"));
      }
      const state = normalizeSharedState(value);
      if (!state) throw new ClientFailure("invalid_response", failureMessage("invalid_response"));
      return state;
    }, this.#requestTimeoutMs);
  }

  async #postOperation(baseRevision: number, operation: SharedOperation): Promise<SharedListState> {
    return request(this.#fetcher, this.#apiUrl + ROOM_PATH(this.#roomId) + "/operations", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + this.#roomKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ baseRevision, operation }),
    }, async (response) => {
      if (!response.ok) throw await responseFailure(response);
      let value: unknown;
      try {
        value = await response.json() as unknown;
      } catch {
        throw new ClientFailure("invalid_response", failureMessage("invalid_response"));
      }
      const state = normalizeSharedState(value);
      if (!state) throw new ClientFailure("invalid_response", failureMessage("invalid_response"));
      return state;
    }, this.#requestTimeoutMs);
  }

  #saveQueue(queue: QueueEntry[]): void {
    if (!this.#storage || this.#loadFailure) {
      throw this.#loadFailure ?? new ClientFailure("storage_unavailable", failureMessage("storage_unavailable"));
    }
    try {
      if (queue.length === 0) this.#storage.removeItem(this.#storageKey);
      else this.#storage.setItem(this.#storageKey, JSON.stringify(queue));
    } catch {
      throw new ClientFailure("storage_unavailable", failureMessage("storage_unavailable"));
    }
  }

  #setConflict(baseRevision: number, currentRevision: number): void {
    this.#conflict = {
      baseRevision,
      currentRevision,
      operations: this.#queue.map((entry) => entry.operation),
    };
    this.#status = "conflict";
    this.#error = new ClientFailure("revision_conflict", "共有リストが別の端末で更新されました。保留中の操作を確認してください。", {
      status: 409,
      currentRevision,
    });
    this.#publish();
  }

  #handleFailure(error: unknown): void {
    const failure = error instanceof ClientFailure
      ? error
      : new ClientFailure("request_failed", "共有リストの同期に失敗しました。");
    if (!failure.retryable && failure.status !== undefined) this.#blockedFailure = failure;
    this.#error = failure;
    this.#status = failure.retryable ? "offline" : "error";
    this.#publish();
  }

  #publish(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        // UI subscribers must not interrupt the outbox or polling loop.
      }
    }
  }
}

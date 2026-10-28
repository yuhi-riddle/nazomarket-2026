import type { SharedListState, SharedOperation } from "../../shared-worker/src/domain.ts";

export type { SharedListItem, SharedListState, SharedOperation } from "../../shared-worker/src/domain.ts";

export type SharedRoomCredentials = {
  roomId: string;
  roomKey: string;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SharedClientError = {
  code: string;
  message: string;
  status?: number;
};

export type SharedSyncConflict = {
  baseRevision: number;
  currentRevision: number;
  operations: SharedOperation[];
};

export type SharedSyncSnapshot = {
  state: SharedListState | null;
  status: "idle" | "syncing" | "offline" | "conflict" | "error";
  pendingOperations: SharedOperation[];
  pendingOperationIds?: string[];
  conflict: SharedSyncConflict | null;
  error: SharedClientError | null;
};

export function isRoomId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

export function isRoomKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/iu.test(value);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isAmount(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000);
}

function normalizeItem(value: unknown): SharedListState["items"][number] | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "productId", "name", "priceYen", "quantity", "purchased"])) return null;
  if (typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(value.id)) return null;
  if (value.productId !== null && (typeof value.productId !== "string" || value.productId.trim().length === 0 || [...value.productId].length > 128)) return null;
  if (typeof value.name !== "string" || value.name.trim().length === 0 || [...value.name.trim()].length > 100 || /[\u0000-\u001f\u007f]/u.test(value.name)) return null;
  if (!isAmount(value.priceYen) || typeof value.quantity !== "number" || !Number.isSafeInteger(value.quantity) || value.quantity < 1 || value.quantity > 999) return null;
  if (typeof value.purchased !== "boolean") return null;
  return {
    id: value.id,
    productId: value.productId,
    name: value.name.trim(),
    priceYen: value.priceYen,
    quantity: value.quantity,
    purchased: value.purchased,
  };
}

export function normalizeSharedState(value: unknown): SharedListState | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["revision", "budgetYen", "items"])) return null;
  if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0 || !isAmount(value.budgetYen)) return null;
  if (!Array.isArray(value.items) || value.items.length > 500) return null;
  const items = value.items.map(normalizeItem);
  if (items.some((item) => item === null)) return null;
  return { revision: value.revision, budgetYen: value.budgetYen, items: items as SharedListState["items"] };
}

export function normalizeSharedOperation(value: unknown): SharedOperation | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "add": {
      if (!hasOnlyKeys(value, ["type", "item"]) || !isRecord(value.item)
        || !hasOnlyKeys(value.item, ["id", "productId", "name", "priceYen", "quantity"])) return null;
      const item = normalizeItem({ ...value.item, purchased: false });
      if (!item) return null;
      return {
        type: "add",
        item: {
          id: item.id,
          productId: item.productId,
          name: item.name,
          priceYen: item.priceYen,
          quantity: item.quantity,
        },
      };
    }
    case "remove":
      return hasOnlyKeys(value, ["type", "itemId"])
        && typeof value.itemId === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(value.itemId)
        ? { type: "remove", itemId: value.itemId }
        : null;
    case "set-quantity":
      return hasOnlyKeys(value, ["type", "itemId", "quantity"])
        && typeof value.itemId === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(value.itemId)
        && typeof value.quantity === "number" && Number.isSafeInteger(value.quantity) && value.quantity >= 1 && value.quantity <= 999
        ? { type: "set-quantity", itemId: value.itemId, quantity: value.quantity }
        : null;
    case "set-purchased":
      return hasOnlyKeys(value, ["type", "itemId", "purchased"])
        && typeof value.itemId === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(value.itemId)
        && typeof value.purchased === "boolean"
        ? { type: "set-purchased", itemId: value.itemId, purchased: value.purchased }
        : null;
    case "set-budget":
      return hasOnlyKeys(value, ["type", "budgetYen"]) && isAmount(value.budgetYen)
        ? { type: "set-budget", budgetYen: value.budgetYen }
        : null;
    default:
      return null;
  }
}

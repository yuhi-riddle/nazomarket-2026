export interface SharedListItem {
  id: string;
  productId: string | null;
  name: string;
  priceYen: number | null;
  quantity: number;
  purchased: boolean;
}

export interface SharedListState {
  revision: number;
  budgetYen: number | null;
  items: SharedListItem[];
}

export type SharedOperation =
  | { type: "add"; item: Omit<SharedListItem, "purchased"> }
  | { type: "remove"; itemId: string }
  | { type: "set-quantity"; itemId: string; quantity: number }
  | { type: "set-purchased"; itemId: string; purchased: boolean }
  | { type: "set-budget"; budgetYen: number | null };

export interface OperationEnvelope {
  baseRevision: number;
  operation: SharedOperation;
}

export type SharedListErrorCode =
  | "invalid_input"
  | "revision_conflict"
  | "item_not_found"
  | "duplicate_item"
  | "list_full"
  | "revision_limit";

export class SharedListError extends Error {
  readonly code: SharedListErrorCode;

  constructor(code: SharedListErrorCode, message: string) {
    super(message);
    this.name = "SharedListError";
    this.code = code;
  }
}

const MAX_AMOUNT_YEN = 1_000_000_000;
const MAX_ITEMS = 500;
const MAX_QUANTITY = 999;
const MAX_NAME_LENGTH = 100;
const MAX_PRODUCT_ID_LENGTH = 128;
const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function createInitialState(): SharedListState {
  return { revision: 0, budgetYen: null, items: [] };
}

function invalid(message: string): never {
  throw new SharedListError("invalid_input", message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid(`${label} has an unknown field`);
}

function itemId(value: unknown): string {
  if (typeof value !== "string" || !ITEM_ID_PATTERN.test(value)) invalid("item id is invalid");
  return value;
}

function amount(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT_YEN) {
    invalid(`${label} must be a non-negative integer no greater than ${MAX_AMOUNT_YEN}`);
  }
  return value;
}

function positiveQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_QUANTITY) {
    invalid(`quantity must be an integer from 1 to ${MAX_QUANTITY}`);
  }
  return value;
}

function parseAddItem(value: unknown): Omit<SharedListItem, "purchased"> {
  const input = record(value, "item");
  exactKeys(input, ["id", "productId", "name", "priceYen", "quantity"], "item");

  const productId = input.productId;
  if (productId !== null && (typeof productId !== "string" || productId.trim().length === 0 || [...productId].length > MAX_PRODUCT_ID_LENGTH)) {
    invalid(`productId must be null or a string of at most ${MAX_PRODUCT_ID_LENGTH} characters`);
  }

  if (typeof input.name !== "string") invalid("name must be a string");
  const name = input.name.trim();
  if (name.length === 0 || [...name].length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/u.test(name)) {
    invalid(`name must contain 1 to ${MAX_NAME_LENGTH} printable characters`);
  }

  return {
    id: itemId(input.id),
    productId: productId === null ? null : productId.trim(),
    name,
    priceYen: amount(input.priceYen, "priceYen"),
    quantity: positiveQuantity(input.quantity),
  };
}

export function parseOperationEnvelope(value: unknown): OperationEnvelope {
  const input = record(value, "request");
  exactKeys(input, ["baseRevision", "operation"], "request");
  if (typeof input.baseRevision !== "number" || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    invalid("baseRevision must be a non-negative safe integer");
  }

  const operation = record(input.operation, "operation");
  if (typeof operation.type !== "string") invalid("operation type is required");

  switch (operation.type) {
    case "add":
      exactKeys(operation, ["type", "item"], "operation");
      return { baseRevision: input.baseRevision, operation: { type: "add", item: parseAddItem(operation.item) } };
    case "remove":
      exactKeys(operation, ["type", "itemId"], "operation");
      return { baseRevision: input.baseRevision, operation: { type: "remove", itemId: itemId(operation.itemId) } };
    case "set-quantity":
      exactKeys(operation, ["type", "itemId", "quantity"], "operation");
      return {
        baseRevision: input.baseRevision,
        operation: { type: "set-quantity", itemId: itemId(operation.itemId), quantity: positiveQuantity(operation.quantity) },
      };
    case "set-purchased":
      exactKeys(operation, ["type", "itemId", "purchased"], "operation");
      if (typeof operation.purchased !== "boolean") invalid("purchased must be a boolean");
      return {
        baseRevision: input.baseRevision,
        operation: { type: "set-purchased", itemId: itemId(operation.itemId), purchased: operation.purchased },
      };
    case "set-budget":
      exactKeys(operation, ["type", "budgetYen"], "operation");
      return { baseRevision: input.baseRevision, operation: { type: "set-budget", budgetYen: amount(operation.budgetYen, "budgetYen") } };
    default:
      return invalid("operation type is not supported");
  }
}

export function applyOperation(state: SharedListState, value: unknown): SharedListState {
  const envelope = parseOperationEnvelope(value);
  if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.items)) {
    throw new SharedListError("invalid_input", "stored state is invalid");
  }
  if (envelope.baseRevision !== state.revision) {
    throw new SharedListError("revision_conflict", "revision conflict; fetch the latest state before retrying");
  }
  if (state.revision >= Number.MAX_SAFE_INTEGER) {
    throw new SharedListError("revision_limit", "revision limit reached");
  }

  const { operation } = envelope;
  switch (operation.type) {
    case "add": {
      if (state.items.length >= MAX_ITEMS) throw new SharedListError("list_full", "the list has reached its item limit");
      if (state.items.some((item) => item.id === operation.item.id)) {
        throw new SharedListError("duplicate_item", "item id already exists");
      }
      return {
        ...state,
        revision: state.revision + 1,
        items: [...state.items, { ...operation.item, purchased: false }],
      };
    }
    case "remove": {
      if (!state.items.some((item) => item.id === operation.itemId)) {
        throw new SharedListError("item_not_found", "item does not exist");
      }
      return { ...state, revision: state.revision + 1, items: state.items.filter((item) => item.id !== operation.itemId) };
    }
    case "set-quantity":
    case "set-purchased": {
      if (!state.items.some((item) => item.id === operation.itemId)) {
        throw new SharedListError("item_not_found", "item does not exist");
      }
      const items = state.items.map((item) => {
        if (item.id !== operation.itemId) return item;
        return operation.type === "set-quantity"
          ? { ...item, quantity: operation.quantity }
          : { ...item, purchased: operation.purchased };
      });
      return { ...state, revision: state.revision + 1, items };
    }
    case "set-budget":
      return { ...state, revision: state.revision + 1, budgetYen: operation.budgetYen };
  }
}

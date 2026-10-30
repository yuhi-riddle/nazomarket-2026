export interface SharedMember {
  id: string;
  name: string;
  budgetYen: number | null;
}

export interface SharedListItem {
  id: string;
  productId: string | null;
  name: string;
  priceYen: number | null;
  quantity: number;
  purchased: boolean;
  ownerId: string | null;
}

export interface SharedListState {
  revision: number;
  members: SharedMember[];
  items: SharedListItem[];
}

export type SharedOperation =
  | { type: "add-member"; member: { id: string; name: string } }
  | { type: "rename-member"; memberId: string; name: string }
  | { type: "remove-member"; memberId: string }
  | { type: "set-member-budget"; memberId: string; budgetYen: number | null }
  | { type: "set-owner"; itemId: string; ownerId: string | null }
  | { type: "add"; item: Omit<SharedListItem, "purchased"> }
  | { type: "remove"; itemId: string }
  | { type: "set-quantity"; itemId: string; quantity: number }
  | { type: "set-purchased"; itemId: string; purchased: boolean };

export interface OperationEnvelope {
  baseRevision: number;
  operation: SharedOperation;
}

export type SharedListErrorCode =
  | "invalid_input"
  | "revision_conflict"
  | "item_not_found"
  | "member_not_found"
  | "duplicate_item"
  | "duplicate_member"
  | "list_full"
  | "member_limit"
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
const MAX_MEMBERS = 20;
const MAX_QUANTITY = 999;
const MAX_ITEM_NAME_LENGTH = 100;
const MAX_MEMBER_NAME_LENGTH = 20;
const MAX_PRODUCT_ID_LENGTH = 128;
const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function createInitialState(): SharedListState {
  return { revision: 0, members: [], items: [] };
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

function itemId(value: unknown, label = "id"): string {
  if (typeof value !== "string" || !ITEM_ID_PATTERN.test(value)) invalid(`${label} is invalid`);
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

function normalizedName(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string`);
  if (/\p{Cc}/u.test(value)) invalid(`${label} must not contain control characters`);
  const name = value.trim();
  if (name.length === 0 || [...name].length > maxLength) {
    invalid(`${label} must contain 1 to ${maxLength} printable characters`);
  }
  return name;
}

function parseMember(value: unknown): SharedMember {
  const input = record(value, "member");
  exactKeys(input, ["id", "name", "budgetYen"], "member");
  return {
    id: itemId(input.id, "member id"),
    name: normalizedName(input.name, MAX_MEMBER_NAME_LENGTH, "member name"),
    budgetYen: amount(input.budgetYen, "budgetYen"),
  };
}

function parseAddMember(value: unknown): { id: string; name: string } {
  const input = record(value, "member");
  exactKeys(input, ["id", "name"], "member");
  return {
    id: itemId(input.id, "member id"),
    name: normalizedName(input.name, MAX_MEMBER_NAME_LENGTH, "member name"),
  };
}

function parseAddItem(value: unknown): Omit<SharedListItem, "purchased"> {
  const input = record(value, "item");
  exactKeys(input, ["id", "productId", "name", "priceYen", "quantity", "ownerId"], "item");
  const productId = input.productId;
  if (productId !== null && (typeof productId !== "string" || productId.trim().length === 0 || [...productId].length > MAX_PRODUCT_ID_LENGTH)) {
    invalid(`productId must be null or a string of at most ${MAX_PRODUCT_ID_LENGTH} characters`);
  }
  const ownerId = input.ownerId === null ? null : itemId(input.ownerId, "ownerId");
  return {
    id: itemId(input.id),
    productId: productId === null ? null : productId.trim(),
    name: normalizedName(input.name, MAX_ITEM_NAME_LENGTH, "name"),
    priceYen: amount(input.priceYen, "priceYen"),
    quantity: positiveQuantity(input.quantity),
    ownerId,
  };
}

function normalizedMemberName(name: string): string {
  return name.toLocaleLowerCase("en-US");
}

function checkMembers(members: SharedMember[]): void {
  if (members.length > MAX_MEMBERS) throw new SharedListError("member_limit", "the list has reached its member limit");
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const member of members) {
    if (ids.has(member.id)) throw new SharedListError("duplicate_member", "member id already exists");
    const name = normalizedMemberName(member.name);
    if (names.has(name)) throw new SharedListError("duplicate_member", "member name already exists");
    ids.add(member.id);
    names.add(name);
  }
}

export function parseSharedState(value: unknown): SharedListState {
  const input = record(value, "state");
  exactKeys(input, ["revision", "members", "items"], "state");
  if (typeof input.revision !== "number" || !Number.isSafeInteger(input.revision) || input.revision < 0) {
    invalid("revision must be a non-negative safe integer");
  }
  if (!Array.isArray(input.members) || input.members.length > MAX_MEMBERS) invalid("members are invalid");
  if (!Array.isArray(input.items) || input.items.length > MAX_ITEMS) invalid("items are invalid");
  const members = input.members.map(parseMember);
  checkMembers(members);
  const memberIds = new Set(members.map((member) => member.id));
  const items = input.items.map((value): SharedListItem => {
    const item = record(value, "item");
    exactKeys(item, ["id", "productId", "name", "priceYen", "quantity", "purchased", "ownerId"], "item");
    if (typeof item.purchased !== "boolean") invalid("purchased must be a boolean");
    const parsed = parseAddItem({
      id: item.id,
      productId: item.productId,
      name: item.name,
      priceYen: item.priceYen,
      quantity: item.quantity,
      ownerId: item.ownerId,
    });
    if (parsed.ownerId !== null && !memberIds.has(parsed.ownerId)) invalid("item owner does not exist");
    return { ...parsed, purchased: item.purchased };
  });
  const itemIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.id)) throw new SharedListError("duplicate_item", "item id already exists");
    itemIds.add(item.id);
  }
  return { revision: input.revision, members, items };
}

export function parseSharedOperation(value: unknown): SharedOperation {
  const operation = record(value, "operation");
  if (typeof operation.type !== "string") invalid("operation type is required");
  switch (operation.type) {
    case "add-member":
      exactKeys(operation, ["type", "member"], "operation");
      return { type: "add-member", member: parseAddMember(operation.member) };
    case "rename-member":
      exactKeys(operation, ["type", "memberId", "name"], "operation");
      return {
        type: "rename-member",
        memberId: itemId(operation.memberId, "memberId"),
        name: normalizedName(operation.name, MAX_MEMBER_NAME_LENGTH, "member name"),
      };
    case "remove-member":
      exactKeys(operation, ["type", "memberId"], "operation");
      return { type: "remove-member", memberId: itemId(operation.memberId, "memberId") };
    case "set-member-budget":
      exactKeys(operation, ["type", "memberId", "budgetYen"], "operation");
      return {
        type: "set-member-budget",
        memberId: itemId(operation.memberId, "memberId"),
        budgetYen: amount(operation.budgetYen, "budgetYen"),
      };
    case "set-owner":
      exactKeys(operation, ["type", "itemId", "ownerId"], "operation");
      return {
        type: "set-owner",
        itemId: itemId(operation.itemId, "itemId"),
        ownerId: operation.ownerId === null ? null : itemId(operation.ownerId, "ownerId"),
      };
    case "add":
      exactKeys(operation, ["type", "item"], "operation");
      return { type: "add", item: parseAddItem(operation.item) };
    case "remove":
      exactKeys(operation, ["type", "itemId"], "operation");
      return { type: "remove", itemId: itemId(operation.itemId, "itemId") };
    case "set-quantity":
      exactKeys(operation, ["type", "itemId", "quantity"], "operation");
      return { type: "set-quantity", itemId: itemId(operation.itemId, "itemId"), quantity: positiveQuantity(operation.quantity) };
    case "set-purchased":
      exactKeys(operation, ["type", "itemId", "purchased"], "operation");
      if (typeof operation.purchased !== "boolean") invalid("purchased must be a boolean");
      return { type: "set-purchased", itemId: itemId(operation.itemId, "itemId"), purchased: operation.purchased };
    default:
      return invalid("operation type is not supported");
  }
}

export function parseOperationEnvelope(value: unknown): OperationEnvelope {
  const input = record(value, "request");
  exactKeys(input, ["baseRevision", "operation"], "request");
  if (typeof input.baseRevision !== "number" || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    invalid("baseRevision must be a non-negative safe integer");
  }
  return { baseRevision: input.baseRevision, operation: parseSharedOperation(input.operation) };
}

function requireMember(members: SharedMember[], memberId: string): SharedMember {
  const member = members.find((candidate) => candidate.id === memberId);
  if (!member) throw new SharedListError("member_not_found", "member does not exist");
  return member;
}

function requireItem(items: SharedListItem[], targetId: string): SharedListItem {
  const item = items.find((candidate) => candidate.id === targetId);
  if (!item) throw new SharedListError("item_not_found", "item does not exist");
  return item;
}

export function applyOperation(stateValue: SharedListState, value: unknown): SharedListState {
  const state = parseSharedState(stateValue);
  const envelope = parseOperationEnvelope(value);
  if (envelope.baseRevision !== state.revision) {
    throw new SharedListError("revision_conflict", "revision conflict; fetch the latest state before retrying");
  }
  if (state.revision >= Number.MAX_SAFE_INTEGER) {
    throw new SharedListError("revision_limit", "revision limit reached");
  }

  const { operation } = envelope;
  switch (operation.type) {
    case "add-member": {
      if (state.members.length >= MAX_MEMBERS) throw new SharedListError("member_limit", "the list has reached its member limit");
      const member: SharedMember = { ...operation.member, budgetYen: null };
      checkMembers([...state.members, member]);
      return { ...state, revision: state.revision + 1, members: [...state.members, member] };
    }
    case "rename-member": {
      requireMember(state.members, operation.memberId);
      const members = state.members.map((member) => member.id === operation.memberId
        ? { ...member, name: operation.name }
        : member);
      checkMembers(members);
      return { ...state, revision: state.revision + 1, members };
    }
    case "remove-member": {
      requireMember(state.members, operation.memberId);
      return {
        ...state,
        revision: state.revision + 1,
        members: state.members.filter((member) => member.id !== operation.memberId),
        items: state.items.map((item) => item.ownerId === operation.memberId ? { ...item, ownerId: null } : item),
      };
    }
    case "set-member-budget": {
      requireMember(state.members, operation.memberId);
      return {
        ...state,
        revision: state.revision + 1,
        members: state.members.map((member) => member.id === operation.memberId
          ? { ...member, budgetYen: operation.budgetYen }
          : member),
      };
    }
    case "set-owner": {
      requireItem(state.items, operation.itemId);
      if (operation.ownerId !== null) requireMember(state.members, operation.ownerId);
      return {
        ...state,
        revision: state.revision + 1,
        items: state.items.map((item) => item.id === operation.itemId ? { ...item, ownerId: operation.ownerId } : item),
      };
    }
    case "add": {
      if (state.items.length >= MAX_ITEMS) throw new SharedListError("list_full", "the list has reached its item limit");
      if (state.items.some((item) => item.id === operation.item.id)) {
        throw new SharedListError("duplicate_item", "item id already exists");
      }
      if (operation.item.ownerId !== null) requireMember(state.members, operation.item.ownerId);
      return {
        ...state,
        revision: state.revision + 1,
        items: [...state.items, { ...operation.item, purchased: false }],
      };
    }
    case "remove":
      requireItem(state.items, operation.itemId);
      return { ...state, revision: state.revision + 1, items: state.items.filter((item) => item.id !== operation.itemId) };
    case "set-quantity":
    case "set-purchased": {
      requireItem(state.items, operation.itemId);
      const items = state.items.map((item) => {
        if (item.id !== operation.itemId) return item;
        return operation.type === "set-quantity"
          ? { ...item, quantity: operation.quantity }
          : { ...item, purchased: operation.purchased };
      });
      return { ...state, revision: state.revision + 1, items };
    }
    default:
      return invalid("operation type is not supported");
  }
}

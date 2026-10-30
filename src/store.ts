import { defaultState, parseState, serializeState, STORAGE_KEY, type AppState } from "./state.ts";
import { products } from "./data.ts";
import type { SharedMember } from "../shared-worker/src/domain.ts";

export type SharedStoreState = {
  members: SharedMember[];
  ownerByProductId: Map<string, string | null>;
  meId: string | null;
};

type Listener = (state: AppState, previous: AppState, shared: SharedStoreState | null) => void;

export type AppStore = {
  getState: () => AppState;
  update: (change: (state: AppState) => AppState) => void;
  subscribe: (listener: Listener) => () => void;
  enterSharedList: (items: AppState["items"], budget: number | null, shared?: SharedStoreState) => void;
  applySharedList: (items: AppState["items"], budget: number | null, shared?: SharedStoreState) => void;
  leaveSharedList: () => void;
  isShared: () => boolean;
  hasPersonalSaveFailure: () => boolean;
  setSharedWriteBlocked: (blocked: boolean) => void;
  isSharedWriteBlocked: () => boolean;
  setSharedChangeHandler: (handler: ((previous: AppState, next: AppState) => void) | null) => void;
};

type StoreStorage = Pick<Storage, "getItem" | "setItem">;

export function createStore(storage?: StoreStorage): AppStore {
  const knownIds = new Set(products.map((product) => product.id));
  let state = defaultState;
  let persistence: StoreStorage | undefined;
  let personalSaveFailed = false;
  try {
    persistence = storage ?? globalThis.localStorage;
    state = parseState(persistence.getItem(STORAGE_KEY), knownIds);
  } catch {
    state = defaultState;
    personalSaveFailed = true;
  }
  let personalState = state;
  let sharedMode = false;
  let sharedState: SharedStoreState | null = null;
  let sharedWriteBlocked = false;
  let sharedChangeHandler: ((previous: AppState, next: AppState) => void) | null = null;
  const listeners = new Set<Listener>();

  const savePersonalState = (next: AppState) => {
    try {
      if (!persistence) throw new Error("Personal storage is unavailable.");
      persistence.setItem(STORAGE_KEY, serializeState(next));
      personalSaveFailed = false;
    } catch {
      personalSaveFailed = true;
    }
  };
  const notify = (next: AppState, previous: AppState) => {
    for (const listener of listeners) listener(next, previous, sharedState);
  };
  const sameItems = (left: AppState["items"], right: AppState["items"]): boolean =>
    left.length === right.length && left.every((item, index) => {
      const other = right[index];
      return other !== undefined && item.productId === other.productId && item.qty === other.qty && item.bought === other.bought;
    });
  const sameSharedState = (left: SharedStoreState | null, right: SharedStoreState | null): boolean => {
    if (left === right) return true;
    if (left === null || right === null || left.meId !== right.meId
      || left.members.length !== right.members.length || left.ownerByProductId.size !== right.ownerByProductId.size) return false;
    return left.members.every((member, index) => {
      const other = right.members[index];
      return other !== undefined && member.id === other.id && member.name === other.name && member.budgetYen === other.budgetYen;
    }) && [...left.ownerByProductId].every(([productId, ownerId]) => right.ownerByProductId.get(productId) === ownerId);
  };

  return {
    getState: () => state,
    update(change) {
      const previous = state;
      let next = change(previous);
      const sharedItemsChanged = next.items !== previous.items;
      const sharedBudgetChanged = next.budget !== previous.budget;

      if (sharedMode && sharedWriteBlocked && (sharedItemsChanged || sharedBudgetChanged)) {
        next = { ...next, items: previous.items, budget: previous.budget };
      } else if (sharedMode) {
        if (sharedBudgetChanged) next = { ...next, budget: previous.budget };
        if (sharedItemsChanged) sharedChangeHandler?.(previous, next);
      }

      if (sharedMode) {
        personalState = { ...next, items: personalState.items, budget: personalState.budget };
        savePersonalState(personalState);
      } else {
        personalState = next;
        savePersonalState(personalState);
      }
      state = next;
      notify(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enterSharedList(items, budget, shared) {
      if (!sharedMode) personalState = state;
      const previous = state;
      sharedMode = true;
      sharedState = shared ?? null;
      sharedWriteBlocked = false;
      state = { ...state, items: items.map((item) => ({ ...item })), budget };
      notify(state, previous);
    },
    applySharedList(items, budget, shared) {
      if (!sharedMode) return;
      const nextItems = items.map((item) => ({ ...item }));
      const nextShared = shared ?? sharedState;
      if (sameItems(state.items, nextItems) && state.budget === budget && sameSharedState(sharedState, nextShared)) return;
      const previous = state;
      sharedState = nextShared;
      state = { ...state, items: nextItems, budget };
      notify(state, previous);
    },
    leaveSharedList() {
      if (!sharedMode) return;
      const previous = state;
      sharedMode = false;
      sharedState = null;
      sharedWriteBlocked = false;
      state = { ...state, items: personalState.items, budget: personalState.budget };
      savePersonalState(personalState);
      notify(state, previous);
    },
    isShared: () => sharedMode,
    hasPersonalSaveFailure: () => personalSaveFailed,
    setSharedWriteBlocked(blocked) {
      if (sharedWriteBlocked === blocked) return;
      sharedWriteBlocked = blocked;
      const previous = state;
      state = { ...state };
      notify(state, previous);
    },
    isSharedWriteBlocked: () => sharedWriteBlocked,
    setSharedChangeHandler(handler) {
      sharedChangeHandler = handler;
    },
  };
}

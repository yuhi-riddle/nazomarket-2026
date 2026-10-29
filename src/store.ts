import { defaultState, parseState, serializeState, STORAGE_KEY, type AppState } from "./state.ts";
import { products } from "./data.ts";

type Listener = (state: AppState, previous: AppState) => void;

export type AppStore = {
  getState: () => AppState;
  update: (change: (state: AppState) => AppState) => void;
  subscribe: (listener: Listener) => () => void;
  enterSharedList: (items: AppState["items"], budget: number | null) => void;
  applySharedList: (items: AppState["items"], budget: number | null) => void;
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
    for (const listener of listeners) listener(next, previous);
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
      } else if (sharedMode && (sharedItemsChanged || sharedBudgetChanged)) {
        sharedChangeHandler?.(previous, next);
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
    enterSharedList(items, budget) {
      if (!sharedMode) personalState = state;
      const previous = state;
      sharedMode = true;
      sharedWriteBlocked = false;
      state = { ...state, items: items.map((item) => ({ ...item })), budget };
      notify(state, previous);
    },
    applySharedList(items, budget) {
      if (!sharedMode) return;
      const previous = state;
      state = { ...state, items: items.map((item) => ({ ...item })), budget };
      notify(state, previous);
    },
    leaveSharedList() {
      if (!sharedMode) return;
      const previous = state;
      sharedMode = false;
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

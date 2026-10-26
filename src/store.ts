import { defaultState, parseState, serializeState, STORAGE_KEY, type AppState } from "./state.ts";
import { products } from "./data.ts";

type Listener = (state: AppState, previous: AppState) => void;

export type AppStore = {
  getState: () => AppState;
  update: (change: (state: AppState) => AppState) => void;
  subscribe: (listener: Listener) => () => void;
};

export function createStore(): AppStore {
  const knownIds = new Set(products.map((product) => product.id));
  let state = defaultState;
  try {
    state = parseState(localStorage.getItem(STORAGE_KEY), knownIds);
  } catch {
    state = defaultState;
  }
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    update(change) {
      const previous = state;
      state = change(previous);
      try {
        localStorage.setItem(STORAGE_KEY, serializeState(state));
      } catch {
        // 保存できない環境でも画面はそのまま使える
      }
      for (const listener of listeners) listener(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

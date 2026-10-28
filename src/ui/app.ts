import type { TabId, AppState } from "../state.ts";
import type { CartItem } from "../logic/cart.ts";
import { captureSharedRoomLink, readSharedRoomCredentials, type SharedRoomCredentials } from "../shared/index.ts";
import { createStore } from "../store.ts";
import { dataGeneratedAt } from "../data.ts";
import { budgetMeter } from "./budgetMeter.ts";
import { catalogView } from "./catalogView.ts";
import { cartView } from "./cartView.ts";
import { mapView } from "./mapView.ts";
import { button, el, safeExternalLink } from "./dom.ts";
import type { SharedListViewOptions } from "./sharedListView.ts";

const tabNames: Record<TabId, string> = {
  catalog: "一覧",
  cart: "リスト",
  map: "マップ",
};
const tabOrder: TabId[] = ["catalog", "cart", "map"];
const hashNames: Record<TabId, string> = {
  catalog: "catalog",
  cart: "list",
  map: "map",
};

function configuredSharedApiUrl(): string | null {
  const configured = import.meta.env.VITE_SHARED_LIST_API_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && localHost))
      || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function captureInitialSharedRoom(): {
  credentials: SharedRoomCredentials | null;
  error: string | null;
  needsPaste: boolean;
} {
  const url = new URL(window.location.href);
  const roomId = url.searchParams.get("room");
  if (!roomId) return { credentials: null, error: null, needsPaste: false };

  try {
    const storage = window.sessionStorage;
    const fragment = url.hash.slice(1);
    const tabFragments = new Set(["catalog", "list", "map", "insights", "today"]);
    let credentials: SharedRoomCredentials | null;
    if (fragment && !tabFragments.has(fragment)) {
      credentials = captureSharedRoomLink(url, storage, (cleanUrl) => window.history.replaceState(null, "", cleanUrl));
    } else {
      credentials = readSharedRoomCredentials(roomId, storage);
    }
    return { credentials, error: null, needsPaste: credentials === null };
  } catch {
    return {
      credentials: null,
      error: "共有リンクの鍵をこのタブに保存できませんでした。共有リンクをもう一度貼り付けてください。",
      needsPaste: true,
    };
  }
}

function tabFromHash(): TabId | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "catalog" || hash === "list") return hash === "list" ? "cart" : "catalog";
  if (hash === "map") return "map";
  if (hash === "insights") return "catalog";
  if (hash === "today") return "cart";
  return null;
}

export function app(root: HTMLElement): void {
  const sharedApiUrl = configuredSharedApiUrl();
  const initialRoom = captureInitialSharedRoom();
  const store = createStore();
  if ((initialRoom.credentials || initialRoom.needsPaste) && store.getState().tab !== "cart") {
    store.update((state) => ({ ...state, tab: "cart" }));
  }
  const header = el("header", "app-header");
  const headerMain = el("div", "header-main");
  const brand = el("div", "brand");
  const title = el("h1", "", "ナゾマ買い物メモ 2026");
  const unofficial = el("span", "unofficial-label", "非公式");
  brand.append(title, unofficial);
  const brandMark = el("span", "brand-mark", "?");
  brandMark.setAttribute("aria-hidden", "true");
  const brandCopy = el("div", "brand-copy");
  title.replaceChildren(
    el("span", "brand-title-mobile", "買い物メモ"),
    el("span", "brand-title-desktop", "ナゾトキマーケット 買い物メモ"),
  );
  const eventMeta = el("span", "brand-event-meta", "11/7 土・11/8 日 東京ドームシティ プリズムホール ／ 非公式");
  brandCopy.append(title, eventMeta, unofficial);
  brand.replaceChildren(brandMark, brandCopy);

  headerMain.append(brand);

  const tablist = el("nav", "tab-list");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "画面");
  const tabButtons = new Map<TabId, HTMLButtonElement>();
  for (const tab of tabOrder) {
    const tabButton = button("", "tab-button");
    tabButton.id = "tab-" + tab;
    tabButton.setAttribute("role", "tab");
    tabButton.setAttribute("aria-controls", "panel-" + tab);
    tabButton.setAttribute("aria-selected", "false");
    tabButton.tabIndex = -1;
    const label = el("span", "tab-label");
    if (tab === "cart") {
      label.append(
        el("span", "tab-label-text", tabNames[tab]),
        el("span", "tab-count", String(store.getState().items.length)),
      );
    } else {
      label.textContent = tabNames[tab];
    }
    tabButton.setAttribute("aria-label", tab === "cart"
      ? tabNames[tab] + " " + store.getState().items.length
      : tabNames[tab]);
    tabButton.append(label);
    tabButton.addEventListener("click", () => store.update((state) => ({ ...state, tab })));
    tabButton.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = tabOrder.indexOf(tab);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabOrder.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : tabOrder.length - 1)) % tabOrder.length;
      const nextTab = tabOrder[nextIndex];
      store.update((state) => ({ ...state, tab: nextTab }));
      tabButtons.get(nextTab)?.focus();
    });
    tabButtons.set(tab, tabButton);
    tablist.append(tabButton);
  }
  header.append(headerMain, tablist);

  const main = el("main", "app-main");
  const panels = new Map<TabId, HTMLElement>();
  type LazyPage = {
    element: HTMLElement;
    sync: (state: AppState) => void;
    updateItems?: (items: CartItem[], state: AppState) => void;
    setActive?: (active: boolean) => void;
  };
  const pages = new Map<TabId, LazyPage>();
  for (const tab of tabOrder) {
    const panel = el("section", "tab-panel");
    panel.id = "panel-" + tab;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "tab-" + tab);
    panel.tabIndex = 0;
    panels.set(tab, panel);
    main.append(panel);
  }

  const pageFor = (tab: TabId): LazyPage => {
    const existing = pages.get(tab);
    if (existing) return existing;
    const page = tab === "catalog"
      ? catalogView(store)
      : tab === "cart"
        ? cartView(store, sharedApiUrl ? {
          apiUrl: sharedApiUrl,
          initialCredentials: initialRoom.credentials,
          initialError: initialRoom.error,
          roomLinkNeedsPaste: initialRoom.needsPaste,
        } satisfies SharedListViewOptions : undefined)
        : mapView(store);
    pages.set(tab, page);
    panels.get(tab)?.append(page.element);
    return page;
  };

  const meter = budgetMeter(() => store.update((state) => ({ ...state, tab: "cart" })));
  const footer = el("footer", "app-footer");
  const footerText = el("p", "", "非公式の個人用ツールです。出典の最新取得日：" + (dataGeneratedAt || "不明") + "（取得日は商品ごとに異なります）。正確な情報は公式サイト・各団体の告知で確認してください。");
  const rights = el("p", "image-rights", "掲載画像の権利は各権利者に帰属します。画像は各提供元のURLを参照しています。");
  const officialLink = safeExternalLink("https://www.scrapmagazine.com/s/nazomarket/", "ナゾトキマーケット公式サイト");
  footer.append(footerText, rights);
  if (officialLink) footer.append(officialLink);

  root.replaceChildren(header, main, meter.element, footer);

  const rootStyle = document.documentElement.style;
  const overlayObserver = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      if (target === meter.element) {
        const height = meter.element.getBoundingClientRect().height;
        if (height > 0) rootStyle.setProperty("--measured-meter-height", height + "px");
      } else if (target === tablist) {
        if (window.matchMedia("(max-width: 767px)").matches) {
          rootStyle.setProperty("--measured-tabs-height", tablist.getBoundingClientRect().height + "px");
        }
      }
    }
  });
  overlayObserver.observe(meter.element);
  overlayObserver.observe(tablist);

  const setHash = (tab: TabId) => {
    const nextHash = "#" + hashNames[tab];
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search + nextHash);
    }
  };
  const syncHeader = (state: AppState) => {
    for (const tab of tabOrder) {
      const selected = state.tab === tab;
      const tabButton = tabButtons.get(tab);
      if (tabButton) {
        tabButton.setAttribute("aria-selected", String(selected));
        tabButton.tabIndex = selected ? 0 : -1;
        const label = tabButton.firstElementChild;
        const labelText = tab === "cart" ? tabNames[tab] + " " + state.items.length : tabNames[tab];
        if (tab === "cart") {
          const count = label?.querySelector(".tab-count");
          if (count && count.textContent !== String(state.items.length)) count.textContent = String(state.items.length);
        }
        tabButton.setAttribute("aria-label", labelText);
      }
      const panel = panels.get(tab);
      if (panel) panel.hidden = !selected;
    }
    meter.update(state.items, state.budget, true);
  };
  let renderedTab: TabId | undefined;
  const sameCartPlan = (a: CartItem[], b: CartItem[]): boolean => {
    if (a.length !== b.length) return false;
    const previous = new Map(a.map((item): [string, number] => [item.productId, item.qty]));
    return b.every((item) => previous.get(item.productId) === item.qty);
  };
  const render = (state: AppState, previous?: AppState) => {
    syncHeader(state);
    const tabChanged = renderedTab !== state.tab;
    const page = pageFor(state.tab);
    for (const [tab, lazyPage] of pages) lazyPage.setActive?.(tab === state.tab);
    if (!previous || tabChanged) {
      page.sync(state);
    } else if (state.tab === "catalog") {
      const listPlanChanged = !sameCartPlan(state.items, previous.items);
      const preferenceBudgetChanged = state.prefs.budgetFromCart
        && (state.budget !== previous.budget || listPlanChanged);
      if (state.filters !== previous.filters || state.sort !== previous.sort || state.day !== previous.day
        || state.prefs !== previous.prefs || (state.sort === "recommended" && (listPlanChanged || preferenceBudgetChanged))) {
        page.sync(state);
      } else if (state.items !== previous.items || state.budget !== previous.budget) {
        page.updateItems?.(state.items, state);
      } else {
        page.sync(state);
      }
    } else {
      page.sync(state);
    }
    renderedTab = state.tab;
    if (!previous || state.tab !== previous.tab) setHash(state.tab);
    if (previous && tabChanged) window.scrollTo({ top: 0, behavior: "instant" });
  };

  window.addEventListener("hashchange", () => {
    const tab = tabFromHash();
    const oldInsightsHash = window.location.hash.replace(/^#/, "") === "insights";
    if (tab && (tab !== store.getState().tab || (oldInsightsHash && store.getState().sort !== "recommended"))) {
      store.update((state) => ({ ...state, tab, ...(oldInsightsHash ? { sort: "recommended" as const } : {}) }));
    }
  });
  const fromHash = tabFromHash();
  const oldInsightsHash = window.location.hash.replace(/^#/, "") === "insights";
  if (fromHash && (fromHash !== store.getState().tab || (oldInsightsHash && store.getState().sort !== "recommended"))) {
    store.update((state) => ({ ...state, tab: fromHash, ...(oldInsightsHash ? { sort: "recommended" as const } : {}) }));
  } else {
    setHash(store.getState().tab);
  }
  store.subscribe(render);
  render(store.getState());
}

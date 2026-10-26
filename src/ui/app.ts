import type { TabId, AppState } from "../state.ts";
import type { CartItem } from "../logic/cart.ts";
import { createStore } from "../store.ts";
import { dataGeneratedAt } from "../data.ts";
import { budgetMeter } from "./budgetMeter.ts";
import { catalogView } from "./catalogView.ts";
import { cartView } from "./cartView.ts";
import { mapView } from "./mapView.ts";
import { insightsView } from "./insightsView.ts";
import { todayView } from "./todayView.ts";
import { button, el, safeExternalLink } from "./dom.ts";

const tabNames: Record<TabId, string> = {
  catalog: "一覧",
  cart: "リスト",
  map: "マップ",
  insights: "傾向・おすすめ",
  today: "当日",
};
const tabOrder: TabId[] = ["catalog", "cart", "map", "insights", "today"];
const hashNames: Record<TabId, string> = {
  catalog: "catalog",
  cart: "list",
  map: "map",
  insights: "insights",
  today: "today",
};

function tabFromHash(): TabId | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "catalog" || hash === "list") return hash === "list" ? "cart" : "catalog";
  if (hash === "map") return "map";
  if (hash === "insights") return "insights";
  if (hash === "today") return "today";
  return null;
}

export function app(root: HTMLElement): void {
  const store = createStore();
  const header = el("header", "app-header");
  const headerMain = el("div", "header-main");
  const brand = el("div", "brand");
  const title = el("h1", "", "ナゾマ買い物メモ 2026");
  const unofficial = el("span", "unofficial-label", "非公式");
  brand.append(title, unofficial);

  const dayGroup = el("div", "day-picker");
  dayGroup.setAttribute("role", "group");
  dayGroup.setAttribute("aria-label", "行く日");
  const dayButtons = new Map<"sat" | "sun", HTMLButtonElement>();
  for (const [day, labelText] of [["sat", "土 11/7"], ["sun", "日 11/8"]] as const) {
    const dayButton = button(labelText, "day-button");
    dayButton.setAttribute("aria-pressed", "false");
    dayButton.addEventListener("click", () => {
      store.update((state) => ({ ...state, day }));
    });
    dayButtons.set(day, dayButton);
    dayGroup.append(dayButton);
  }
  headerMain.append(brand, dayGroup);

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
    const label = el("span", "", tabNames[tab]);
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
    updateItems?: (items: CartItem[]) => void;
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
        ? cartView(store)
        : tab === "map"
          ? mapView(store)
          : tab === "insights"
            ? insightsView(store)
            : todayView(store);
    pages.set(tab, page);
    panels.get(tab)?.append(page.element);
    if (tab === "today") {
      const summary = page.element.querySelector<HTMLElement>(".today-summary");
      if (summary) overlayObserver.observe(summary);
    }
    return page;
  };

  const meter = budgetMeter(() => store.update((state) => ({ ...state, tab: "cart" })));
  const footer = el("footer", "app-footer");
  const footerText = el("p", "", "非公式の個人用ツールです。商品情報は" + (dataGeneratedAt || "日付不明") + "時点のもの（データ生成日）。正確な情報は公式サイト・各団体の告知で確認してください。");
  const officialLink = safeExternalLink("https://www.scrapmagazine.com/s/nazomarket/", "ナゾトキマーケット公式サイト");
  footer.append(footerText);
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
      } else if (target instanceof HTMLElement && target.classList.contains("today-summary")) {
        rootStyle.setProperty("--measured-today-summary-height", target.getBoundingClientRect().height + "px");
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
    document.documentElement.classList.toggle("is-today-tab", state.tab === "today");
    for (const [day, dayButton] of dayButtons) {
      const selected = state.day === day;
      dayButton.setAttribute("aria-pressed", String(selected));
    }
    for (const tab of tabOrder) {
      const selected = state.tab === tab;
      const tabButton = tabButtons.get(tab);
      if (tabButton) {
        tabButton.setAttribute("aria-selected", String(selected));
        tabButton.tabIndex = selected ? 0 : -1;
        const label = tabButton.firstElementChild;
        const labelText = tab === "cart" ? tabNames[tab] + " " + state.items.length : tabNames[tab];
        if (label && label.textContent !== labelText) label.textContent = labelText;
      }
      const panel = panels.get(tab);
      if (panel) panel.hidden = !selected;
    }
    meter.update(state.items, state.budget, state.tab !== "today");
  };
  let renderedTab: TabId | undefined;
  const render = (state: AppState, previous?: AppState) => {
    syncHeader(state);
    const tabChanged = renderedTab !== state.tab;
    const page = pageFor(state.tab);
    if (!previous || tabChanged) {
      page.sync(state);
    } else if (state.tab === "catalog") {
      if (state.filters !== previous.filters || state.sort !== previous.sort || state.day !== previous.day) {
        page.sync(state);
      } else if (state.items !== previous.items) {
        page.updateItems?.(state.items);
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
    if (tab && tab !== store.getState().tab) store.update((state) => ({ ...state, tab }));
  });
  const fromHash = tabFromHash();
  if (fromHash && fromHash !== store.getState().tab) {
    store.update((state) => ({ ...state, tab: fromHash }));
  } else {
    setHash(store.getState().tab);
  }
  store.subscribe(render);
  render(store.getState());
}

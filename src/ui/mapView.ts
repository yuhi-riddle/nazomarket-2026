import "./mapEnhancements.css";
import { booths, catalog, venueLayout } from "../data.ts";
import {
  setQty,
  toggleBought,
  toggleItem,
  type CartItem,
} from "../logic/cart.ts";
import { boothListStatus, listedItemsForBooth } from "../logic/mapBooths.ts";
import type { ProductView } from "../logic/catalog.ts";
import { xTagsOf } from "../logic/tags.ts";
import type { AppState } from "../state.ts";
import type { Day } from "../types.ts";
import type { AppStore } from "../store.ts";
import { button, el, safeExternalLink } from "./dom.ts";
import { mapSelectionSummary } from "./mapSelectionSummary.ts";
import { productCard, type ProductCardHandle } from "./productCard.ts";
import { productDialog } from "./productDialog.ts";
import { xHashtagLinks } from "./xHashtagLinks.ts";
import { venueMap, type BoothPaint, type VenueMapScale, type VenueMapUpdate } from "./venueMap.ts";

const viewsByCode = new Map<string, ProductView[]>();
for (const view of catalog) {
  const code = view.booth.boothCode;
  if (!code) continue;
  const group = viewsByCode.get(code) ?? [];
  group.push(view);
  viewsByCode.set(code, group);
}
const boothByCode = new Map(booths.flatMap((booth) => booth.boothCode ? [[booth.boothCode, booth] as const] : []));
const boothByCodeForDay = new Map<string, Record<Day, ProductView["booth"] | undefined>>();
for (const { code } of venueLayout.booths) {
  const dayBooths = {} as Record<Day, ProductView["booth"] | undefined>;
  for (const day of ["sat", "sun"] as const) {
    const sellingView = viewsByCode.get(code)?.find((view) =>
      view.product.days.includes(day) && view.booth.days.includes(day));
    dayBooths[day] = sellingView?.booth
      ?? booths.find((booth) => booth.boothCode === code && booth.days.includes(day))
      ?? boothByCode.get(code);
  }
  boothByCodeForDay.set(code, dayBooths);
}
type MapProduct = { view: ProductView; card: ProductCardHandle };

function boothForDay(code: string, day: AppState["day"]): ProductView["booth"] | undefined {
  return boothByCodeForDay.get(code)?.[day];
}

function boothPaints(state: AppState): Map<string, BoothPaint> {
  const statuses = boothListStatus(state.items, catalog, venueLayout, state.day);

  const paints = new Map<string, BoothPaint>();
  for (const booth of venueLayout.booths) {
    const status = statuses.get(booth.code);
    const vendor = boothForDay(booth.code, state.day)?.name ?? booth.labels[state.day] ?? "出展なし";
    const stateLabel = status?.status === "todo"
      ? "未購入" + status.unboughtQty + "点"
      : status?.status === "clear"
        ? "すべて購入済み"
        : "";
    paints.set(booth.code, {
      listStatus: status?.status,
      unboughtQty: status?.unboughtQty,
      title: booth.labels[state.day] === null ? "出展なし" : vendor,
      ariaLabel: [booth.code, booth.labels[state.day] === null ? "出展なし" : vendor, stateLabel]
        .filter(Boolean)
        .join(" "),
    });
  }
  return paints;
}

function organizationLinks(booth: ProductView["booth"] | undefined): HTMLElement | undefined {
  if (!booth) return undefined;
  const links = el("div", "map-organization-links");
  const entries = [
    ...booth.links.site.map((url) => ["団体サイト", url] as const),
    ...booth.links.x.map((url) => ["X", url] as const),
    ...booth.links.instagram.map((url) => ["Instagram", url] as const),
  ];
  for (const [label, url] of entries) {
    const link = safeExternalLink(url, label);
    if (link) links.append(link);
  }
  return links.childElementCount ? links : undefined;
}

export type MapView = {
  element: HTMLElement;
  sync: (state: AppState) => void;
  setActive: (active: boolean) => void;
  selectBooth: (code: string) => void;
};

export function mapView(store: AppStore, onMapBooth?: (boothCode: string) => void): MapView {
  const page = el("section", "map-page");
  page.append(el("h2", "section-title", "会場マップ"));

  const dayGroup = el("div", "day-picker");
  dayGroup.setAttribute("role", "group");
  dayGroup.setAttribute("aria-label", "地図の表示日");
  const dayButtons = new Map<Day, HTMLButtonElement>();
  for (const [day, label] of [["sat", "土 11/7"], ["sun", "日 11/8"]] as const) {
    const dayButton = button(label, "day-button");
    dayButton.setAttribute("aria-pressed", "false");
    dayButton.addEventListener("click", () => store.update((state) => ({ ...state, day })));
    dayButtons.set(day, dayButton);
    dayGroup.append(dayButton);
  }
  page.append(dayGroup);

  const workspace = el("div", "map-workspace");
  const mapColumn = el("section", "map-column");
  mapColumn.setAttribute("aria-label", "会場マップ");
  const toolbar = el("div", "map-toolbar");
  const zoomControls = el("div", "map-zoom-controls");
  zoomControls.setAttribute("role", "group");
  zoomControls.setAttribute("aria-label", "地図の拡大");
  const zoomOut = button("−", "button button-secondary map-zoom-button");
  zoomOut.setAttribute("aria-label", "地図を縮小");
  const zoomIn = button("+", "button button-secondary map-zoom-button");
  zoomIn.setAttribute("aria-label", "地図を拡大");
  const zoomFit = button("全体", "button button-secondary map-zoom-fit");
  zoomFit.setAttribute("aria-label", "地図全体を表示");
  zoomControls.append(zoomOut, zoomFit, zoomIn);
  toolbar.append(zoomControls);

  const boothPicker = el("label", "map-booth-picker");
  const boothSelect = el("select", "map-booth-select");
  boothPicker.append(el("span", "", "番号・出展者からブースを選ぶ"), boothSelect);

  const mapFrame = el("div", "map-frame");
  mapFrame.tabIndex = 0;
  mapFrame.setAttribute("role", "region");
  mapFrame.setAttribute("aria-label", "会場マップ");
  mapFrame.setAttribute("aria-describedby", "map-scroll-help");
  const mapScrollHelp = el("p", "map-scroll-help", "「＋」で拡大、スワイプ（スマホ）／スクロール（PC）で移動。「全体」で戻せます。下の欄から番号・出展者でも選べます。");
  mapScrollHelp.id = "map-scroll-help";
  const panel = el("aside", "map-product-panel");
  panel.setAttribute("aria-label", "選択したブースのアイテム");
  panel.tabIndex = -1;

  const selectionSummary = el("div", "map-selection-summary");
  selectionSummary.hidden = true;
  const selectionSummaryText = el("p", "map-selection-summary-text");
  selectionSummaryText.setAttribute("aria-live", "polite");
  const seeProductsButton = button("アイテムを見る", "button button-secondary map-selection-summary-action");
  seeProductsButton.addEventListener("click", () => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    panel.focus({ preventScroll: true });
  });
  selectionSummary.append(selectionSummaryText, seeProductsButton);

  let selectedCode: string | null = null;
  let panelKey = "";
  let productsInPanel: MapProduct[] = [];
  let panelProductList: HTMLElement | null = null;
  let renderedPanelOrderKey = "";
  let renderedPanelItems: CartItem[] | undefined;
  let renderedPanelWriteBlocked: boolean | undefined;
  const details = productDialog("map", onMapBooth);
  const map = venueMap({
    layout: venueLayout,
    day: "sat",
    onViewReset() {
      isFullVenue = true;
      updateZoomButtons();
    },
    onBoothPress(booth) {
      selectBooth(booth.code, false);
    },
  });
  let scale: VenueMapScale = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches ? 2 : 1;
  let isFullVenue = true;
  let initialRangeSet = false;

  function selectBooth(code: string | null, scroll: boolean, focus = false): void {
    if (code && !venueLayout.booths.some((booth) => booth.code === code)) return;
    selectedCode = code;
    map.setSelectedBooth(code);
    boothSelect.value = code ?? "";
    syncPanel(store.getState());
    if (!code || !scroll) return;
    requestAnimationFrame(() => {
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (focus) {
        mapFrame.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion ? "auto" : "smooth" });
      }
      if (map.ensureBoothVisible(code)) {
        isFullVenue = true;
        updateZoomButtons();
      }
      const boothNode = map.querySelector<SVGGElement>('[data-booth-code="' + code + '"]');
      if (!boothNode) return;
      const boothBounds = boothNode.getBoundingClientRect();
      const frameBounds = mapFrame.getBoundingClientRect();
      mapFrame.scrollLeft += boothBounds.left + boothBounds.width / 2
        - frameBounds.left - mapFrame.clientLeft - mapFrame.clientWidth / 2;
      mapFrame.scrollTop += boothBounds.top + boothBounds.height / 2
        - frameBounds.top - mapFrame.clientTop - mapFrame.clientHeight / 2;
      if (focus) boothNode.focus({ preventScroll: true });
    });
  }
  boothSelect.addEventListener("change", () => selectBooth(boothSelect.value || null, true));
  mapFrame.append(map);
  mapColumn.append(toolbar, mapFrame, selectionSummary, mapScrollHelp, boothPicker);

  const legend = el("div", "map-legend");
  legend.setAttribute("role", "group");
  legend.setAttribute("aria-label", "地図の凡例");
  const listedEntry = el("span", "map-legend-entry");
  listedEntry.append(el("span", "map-legend-swatch list"), el("span", "", "リストに未購入のアイテムがある"));
  legend.append(listedEntry);
  const clearedEntry = el("span", "map-legend-entry");
  clearedEntry.append(el("span", "map-legend-swatch clear"), el("span", "", "リストのアイテムは購入済み"));
  legend.append(clearedEntry);
  const noShowEntry = el("span", "map-legend-entry");
  noShowEntry.append(el("span", "map-legend-swatch map-no-show-swatch"), el("span", "", "出展なし"));
  legend.append(noShowEntry);
  mapColumn.append(legend);
  workspace.append(mapColumn, panel);

  page.append(workspace, details.element);

  map.setScale(scale);
  const updateZoomButtons = () => {
    zoomOut.disabled = scale === 1;
    zoomIn.disabled = scale === 3;
    zoomFit.disabled = scale === 1 && isFullVenue;
  };
  const setScale = (next: VenueMapScale) => {
    const centerX = (mapFrame.scrollLeft + mapFrame.clientWidth / 2) / mapFrame.scrollWidth;
    const centerY = (mapFrame.scrollTop + mapFrame.clientHeight / 2) / mapFrame.scrollHeight;
    scale = next;
    map.setScale(next);
    updateZoomButtons();
    requestAnimationFrame(() => {
      mapFrame.scrollLeft = centerX * mapFrame.scrollWidth - mapFrame.clientWidth / 2;
      mapFrame.scrollTop = centerY * mapFrame.scrollHeight - mapFrame.clientHeight / 2;
    });
  };
  zoomOut.addEventListener("click", () => {
    if (scale === "fit") setScale(1);
    else if (scale > 1) setScale((scale - 1) as VenueMapScale);
  });
  zoomIn.addEventListener("click", () => {
    if (scale === "fit") setScale(2);
    else if (scale < 3) setScale((scale + 1) as VenueMapScale);
  });
  zoomFit.addEventListener("click", () => {
    map.resetViewBox();
    isFullVenue = true;
    setScale(1);
  });
  updateZoomButtons();

  function syncSelectionSummary(state: AppState): void {
    if (selectedCode === null) {
      selectionSummary.hidden = true;
      selectionSummaryText.textContent = "";
      return;
    }

    const layoutBooth = venueLayout.booths.find((booth) => booth.code === selectedCode);
    const isNoShow = layoutBooth?.labels[state.day] === null;
    const allViews = viewsByCode.get(selectedCode) ?? [];
    const dayViews = isNoShow
      ? []
      : allViews.filter((view) => view.product.days.includes(state.day) && view.booth.days.includes(state.day));
    const booth = boothForDay(selectedCode, state.day);
    const organizationName = isNoShow
      ? "出展なし"
      : booth?.name ?? layoutBooth?.labels[state.day] ?? "出展なし";
    const summary = mapSelectionSummary(
      selectedCode,
      organizationName,
      listedItemsForBooth(dayViews, state.items),
    );

    selectionSummary.hidden = false;
    if (selectionSummaryText.textContent !== summary) selectionSummaryText.textContent = summary;
  }

  function syncPanel(state: AppState): void {
    syncSelectionSummary(state);
    if (selectedCode === null) {
      if (panelKey === "empty") return;
      panel.replaceChildren(
        el("h3", "map-panel-title", "ブースを選んでください"),
        el("p", "map-panel-empty", "地図のブースを押すと、アイテムとリストの操作が表示されます。"),
      );
      productsInPanel = [];
      panelProductList = null;
      renderedPanelOrderKey = "";
      renderedPanelItems = state.items;
      panelKey = "empty";
      return;
    }

    const key = selectedCode + ":" + state.day;
    if (panelKey !== key) {
      panel.replaceChildren();
      productsInPanel = [];
      panelProductList = null;
      renderedPanelOrderKey = "";
      renderedPanelItems = state.items;
      const layoutBooth = venueLayout.booths.find((booth) => booth.code === selectedCode);
      const isNoShow = layoutBooth?.labels[state.day] === null;
      const booth = boothForDay(selectedCode, state.day);
      const title = isNoShow ? "出展なし" : booth?.name ?? layoutBooth?.labels[state.day] ?? "出展なし";
      const organizationHeading = el("div", "map-organization-heading");
      const organizationCopy = el("div", "map-organization-copy");
      organizationCopy.append(
        el("span", "map-panel-booth-code", selectedCode),
        el("h3", "map-panel-title", title),
      );
      organizationHeading.append(organizationCopy);
      if (!isNoShow && booth?.logoUrl.trim()) {
        const logo = el("img", "map-organization-logo");
        logo.src = booth.logoUrl;
        logo.alt = title + "のロゴ";
        logo.loading = "lazy";
        logo.decoding = "async";
        logo.addEventListener("error", () => logo.remove(), { once: true });
        organizationHeading.append(logo);
      }
      panel.append(organizationHeading);

      const allViews = viewsByCode.get(selectedCode) ?? [];
      const dayViews = isNoShow
        ? []
        : allViews.filter((view) => view.product.days.includes(state.day) && view.booth.days.includes(state.day));
      if (isNoShow) {
        panel.append(el("p", "map-panel-empty", "この日は出展していません。"));
      } else if (!allViews.length) {
        panel.append(el("p", "map-panel-empty", "このブースのアイテムはまだ分かっていません。"));
      } else if (!dayViews.length) {
        panel.append(el("p", "map-panel-empty", "この日は売っていません。"));
      }

      if (dayViews.length) {
        const productList = el("div", "map-product-list");
        const itemById = new Map(listedItemsForBooth(dayViews, state.items)
          .map((item): [string, CartItem] => [item.productId, item]));
        const orderedViews = [...dayViews].sort((a, b) =>
          Number(itemById.has(b.product.id)) - Number(itemById.has(a.product.id)));
        for (const view of orderedViews) {
          const card = productCard(view, itemById.get(view.product.id), {
            onDetail: (selected) => details.open(selected),
            canChangeList: () => !store.isSharedWriteBlocked(),
            onToggle(productId) {
              store.update((current) => ({ ...current, items: toggleItem(current.items, productId) }));
              productsInPanel.find(({ view: panelView }) => panelView.product.id === productId)
                ?.card.element.querySelector<HTMLButtonElement>(".list-toggle")?.focus();
            },
            onToggleBought(productId) {
              store.update((current) => ({ ...current, items: toggleBought(current.items, productId) }));
              productsInPanel.find(({ view: panelView }) => panelView.product.id === productId)
                ?.card.element.querySelector<HTMLInputElement>(".map-bought-check input")?.focus();
            },
            onQty(productId, qty) {
              store.update((current) => ({ ...current, items: setQty(current.items, productId, qty) }));
            },
          });
          productsInPanel.push({ view, card });
          productList.append(card.element);
        }
        panel.append(productList);
        panelProductList = productList;
        renderedPanelOrderKey = orderedViews.map((view) => view.product.id).join("|");
      }
      const hashtags = new Set(booth?.hashtags?.map(({ tag }) => tag) ?? []);
      for (const view of dayViews) {
        for (const tag of xTagsOf(view.product, view.booth)) hashtags.add(tag);
      }
      const hashtagLinks = xHashtagLinks([...hashtags], "map-x-hashtags");
      if (hashtagLinks) panel.append(hashtagLinks);
      const links = organizationLinks(booth);
      if (links) panel.append(links);
      panelKey = key;
      renderedPanelWriteBlocked = store.isSharedWriteBlocked();
      return;
    }

    if (renderedPanelItems === state.items && renderedPanelWriteBlocked === store.isSharedWriteBlocked()) return;
    const itemById = new Map(state.items.map((item): [string, CartItem] => [item.productId, item]));
    for (const { view, card } of productsInPanel) card.update(itemById.get(view.product.id));
    const orderedProducts = [...productsInPanel].sort((a, b) =>
      Number(itemById.has(b.view.product.id)) - Number(itemById.has(a.view.product.id)));
    const orderKey = orderedProducts.map(({ view }) => view.product.id).join("|");
    if (panelProductList && orderKey !== renderedPanelOrderKey) {
      const activeElement = document.activeElement;
      const focusedPanelElement = activeElement instanceof HTMLElement && panel.contains(activeElement)
        ? activeElement
        : null;
      for (const { card } of orderedProducts) panelProductList.append(card.element);
      if (focusedPanelElement && panel.contains(focusedPanelElement)) {
        focusedPanelElement.focus({ preventScroll: true });
      }
      renderedPanelOrderKey = orderKey;
    }
    renderedPanelItems = state.items;
    renderedPanelWriteBlocked = store.isSharedWriteBlocked();
  }

  let previousPaintDay: Day | undefined;
  let previousPaintItems: CartItem[] | undefined;
  let pickerDay: Day | undefined;
  const sync = (state: AppState) => {
    for (const [day, dayButton] of dayButtons) dayButton.setAttribute("aria-pressed", String(day === state.day));
    if (pickerDay !== state.day) {
      const placeholder = el("option", "", "ブースを選択");
      placeholder.value = "";
      boothSelect.replaceChildren(placeholder, ...venueLayout.booths.map((booth) => {
        const name = booth.labels[state.day] === null
          ? "出展なし"
          : boothForDay(booth.code, state.day)?.name ?? booth.labels[state.day];
        const option = el("option", "", booth.code + " " + name);
        option.value = booth.code;
        return option;
      }));
      boothSelect.value = selectedCode ?? "";
      pickerDay = state.day;
    }
    const update: VenueMapUpdate = {};
    const paintsChanged = previousPaintDay !== state.day || previousPaintItems !== state.items;
    if (paintsChanged) {
      const paints = boothPaints(state);
      update.day = state.day;
      update.paintBooth = (booth) => paints.get(booth.code);
      previousPaintDay = state.day;
      previousPaintItems = state.items;
    }
    if (paintsChanged) map.update(update);
    syncPanel(state);
  };

  const setActive = (active: boolean) => {
    if (!active || initialRangeSet) return;
    initialRangeSet = true;
    const state = store.getState();
    const statuses = boothListStatus(state.items, catalog, venueLayout, state.day);
    if (statuses.size) {
      const aspectRatio = venueLayout.viewBox.w / venueLayout.viewBox.h;
      isFullVenue = !map.fitToBooths([...statuses.keys()], aspectRatio);
    } else {
      map.resetViewBox();
      isFullVenue = true;
    }
    scale = 1;
    map.setScale(scale);
    updateZoomButtons();
  };

  return {
    element: page,
    sync,
    setActive,
    selectBooth(code) {
      selectBooth(code, true, true);
    },
  };
}

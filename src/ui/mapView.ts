import "./mapEnhancements.css";
import { booths, catalog, venueLayout } from "../data.ts";
import {
  setQty,
  toggleItem,
  type CartItem,
} from "../logic/cart.ts";
import { unboughtItemsByBooth } from "../logic/mapBooths.ts";
import type { ProductView } from "../logic/catalog.ts";
import { xTagsOf } from "../logic/tags.ts";
import type { AppState } from "../state.ts";
import type { Day } from "../types.ts";
import type { AppStore } from "../store.ts";
import { button, el, safeExternalLink } from "./dom.ts";
import { productCard, type ProductCardHandle } from "./productCard.ts";
import { productDialog } from "./productDialog.ts";
import { xHashtagLinks } from "./xHashtagLinks.ts";
import { venueMap, type BoothPaint, type VenueMapScale, type VenueMapUpdate } from "./venueMap.ts";

const viewsByCode = new Map<string, ProductView[]>();
const viewsById = new Map(catalog.map((view): [string, ProductView] => [view.product.id, view]));
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
  const itemsByCode = unboughtItemsByBooth(state.items, catalog, venueLayout, state.day);

  const paints = new Map<string, BoothPaint>();
  for (const booth of venueLayout.booths) {
    const items = itemsByCode.get(booth.code) ?? [];
    const vendor = boothForDay(booth.code, state.day)?.name ?? booth.labels[state.day] ?? "出展なし";
    const status = items.length
      ? " 未購入" + items.length + "件"
      : " 未購入0件";
    paints.set(booth.code, {
      color: items.length ? "must" : undefined,
      title: booth.labels[state.day] === null ? "出展なし" : vendor,
      ariaLabel: booth.code + " " + (booth.labels[state.day] === null ? "出展なし" : vendor) + status,
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

export type MapView = { element: HTMLElement; sync: (state: AppState) => void };

export function mapView(store: AppStore): MapView {
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
  mapFrame.setAttribute("aria-label", "会場マップ。拡大時は枠の中をスクロールできます");
  const panel = el("aside", "map-product-panel");
  panel.setAttribute("aria-label", "選択したブースの商品");

  let selectedCode: string | null = null;
  let panelKey = "";
  let productsInPanel: MapProduct[] = [];
  let renderedPanelItems: CartItem[] | undefined;
  let renderedPanelWriteBlocked: boolean | undefined;
  const details = productDialog("map");
  const map = venueMap({
    layout: venueLayout,
    day: "sat",
    onBoothPress(booth) {
      if (selectedCode === booth.code) {
        syncPanel(store.getState());
        return;
      }
      selectedCode = booth.code;
      map.setSelectedBooth(booth.code);
      boothSelect.value = booth.code;
      syncPanel(store.getState());
    },
  });
  boothSelect.addEventListener("change", () => {
    selectedCode = boothSelect.value || null;
    map.setSelectedBooth(selectedCode);
    syncPanel(store.getState());
  });
  mapFrame.append(map);
  mapColumn.append(boothPicker, toolbar, mapFrame, el("p", "map-scroll-help", "拡大した地図は左右に動かせます。"));

  const legend = el("div", "map-legend");
  legend.setAttribute("role", "group");
  legend.setAttribute("aria-label", "地図の凡例");
  const listedEntry = el("span", "map-legend-entry");
  listedEntry.append(el("span", "map-legend-swatch list"), el("span", "", "リストに未購入の商品がある"));
  legend.append(listedEntry);
  const noShowEntry = el("span", "map-legend-entry");
  noShowEntry.append(el("span", "map-legend-swatch map-no-show-swatch"), el("span", "", "出展なし"));
  legend.append(noShowEntry);
  mapColumn.append(legend);
  const remainingSection = el("section", "map-remaining");
  const remainingHeading = el("h3", "map-remaining-heading");
  const remainingList = el("div", "map-remaining-list");
  const remainingNote = el("p", "map-remaining-note");
  remainingSection.append(remainingHeading, remainingList, remainingNote);
  mapColumn.append(remainingSection);
  workspace.append(mapColumn, panel);

  page.append(workspace, details.element);

  let scale: VenueMapScale = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches ? 2 : 1;
  map.setScale(scale);
  const updateZoomButtons = () => {
    zoomOut.disabled = scale === 1;
    zoomIn.disabled = scale === 3;
    zoomFit.disabled = scale === 1;
  };
  const setScale = (next: VenueMapScale) => {
    scale = next;
    map.setScale(next);
    updateZoomButtons();
  };
  zoomOut.addEventListener("click", () => {
    if (scale === "fit") setScale(1);
    else if (scale > 1) setScale((scale - 1) as VenueMapScale);
  });
  zoomIn.addEventListener("click", () => {
    if (scale === "fit") setScale(2);
    else if (scale < 3) setScale((scale + 1) as VenueMapScale);
  });
  zoomFit.addEventListener("click", () => setScale(1));
  updateZoomButtons();

  function syncPanel(state: AppState): void {
    if (selectedCode === null) {
      if (panelKey === "empty") return;
      panel.replaceChildren(
        el("h3", "map-panel-title", "ブースを選んでください"),
        el("p", "map-panel-empty", "地図のブースを押すと、商品とリストの操作が表示されます。"),
      );
      productsInPanel = [];
      renderedPanelItems = state.items;
      panelKey = "empty";
      return;
    }

    const key = selectedCode + ":" + state.day;
    if (panelKey !== key) {
      panel.replaceChildren();
      productsInPanel = [];
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
        panel.append(el("p", "map-panel-empty", "このブースの商品はまだ分かっていません。"));
      } else if (!dayViews.length) {
        panel.append(el("p", "map-panel-empty", "この日は売っていません。"));
      }

      if (dayViews.length) {
        const productList = el("div", "map-product-list");
        const itemById = new Map(state.items.map((item): [string, CartItem] => [item.productId, item]));
        for (const view of dayViews) {
          const card = productCard(view, itemById.get(view.product.id), {
            onDetail: (selected) => details.open(selected),
            canChangeList: () => !store.isSharedWriteBlocked(),
            onToggle(productId) {
              store.update((current) => ({ ...current, items: toggleItem(current.items, productId) }));
              productsInPanel.find(({ view: panelView }) => panelView.product.id === productId)
                ?.card.element.querySelector<HTMLButtonElement>(".list-toggle")?.focus();
            },
            onQty(productId, qty) {
              store.update((current) => ({ ...current, items: setQty(current.items, productId, qty) }));
            },
          });
          productsInPanel.push({ view, card });
          productList.append(card.element);
        }
        panel.append(productList);
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
      const remaining = new Map<string, { booth: ProductView["booth"]; count: number }>();
      let otherDay = 0;
      for (const item of state.items) {
        if (item.bought) continue;
        const view = viewsById.get(item.productId);
        if (!view) continue;
        if (!view.product.days.includes(state.day) || !view.booth.days.includes(state.day)) {
          otherDay += 1;
          continue;
        }
        const entry = remaining.get(view.booth.id) ?? { booth: view.booth, count: 0 };
        entry.count += 1;
        remaining.set(view.booth.id, entry);
      }
      remainingHeading.textContent = "買い物予定の団体（" + (state.day === "sat" ? "土曜" : "日曜") + "）";
      remainingList.replaceChildren();
      for (const { booth, count } of remaining.values()) {
        const text = booth.name + " " + (booth.boothCode ?? "場所未定") + " 未購入" + count + "件";
        if (!booth.boothCode) {
          remainingList.append(el("p", "map-remaining-unplaced", text));
          continue;
        }
        const code = booth.boothCode;
        const selectBooth = button(text, "map-remaining-button");
        selectBooth.addEventListener("click", () => {
          selectedCode = code;
          map.setSelectedBooth(code);
          boothSelect.value = code;
          syncPanel(store.getState());
          panel.scrollIntoView({ block: "start" });
        });
        remainingList.append(selectBooth);
      }
      if (remaining.size === 0) remainingList.append(el("p", "map-remaining-empty", "この日の未購入商品はありません。"));
      remainingNote.textContent = otherDay ? "別の日に出展する未購入商品が" + otherDay + "件あります。" : "";
    }
    if (paintsChanged) map.update(update);
    syncPanel(state);
  };

  return { element: page, sync };
}

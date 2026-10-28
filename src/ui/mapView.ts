import { booths, catalog, venueLayout } from "../data.ts";
import {
  setQty,
  toggleItem,
  type CartItem,
} from "../logic/cart.ts";
import { buildRouteStops } from "../logic/route.ts";
import { unboughtItemsByBooth } from "../logic/mapBooths.ts";
import { getWalkGrid, planWalkingRoute, type WalkingRoute, type WalkingRouteStop } from "../logic/walkingRoute.ts";
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

const viewsById = new Map(catalog.map((view): [string, ProductView] => [view.product.id, view]));
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
type RouteBucket = { stop: WalkingRouteStop; items: CartItem[]; booth: ProductView["booth"] | undefined };
type MapProduct = { view: ProductView; card: ProductCardHandle };
type MapRoutePlan = { route: WalkingRoute; buckets: RouteBucket[]; unplaced: CartItem[]; notSold: CartItem[] };

const emptyWalkingRoute: WalkingRoute = { stops: [], legs: [], unreachable: [] };

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

function routePlan(state: AppState, result: ReturnType<typeof buildRouteStops>, route: WalkingRoute): MapRoutePlan {
  const unplacedBooths = new Set([...result.unplaced, ...route.unreachable]);
  const notSoldIds = new Set(result.notSoldThatDay);
  const stopByBooth = new Map(route.stops.map((stop): [string, WalkingRouteStop] => [stop.boothId, stop]));
  const itemsByBooth = new Map<string, CartItem[]>();
  const unplaced: CartItem[] = [];
  const notSold: CartItem[] = [];

  for (const item of state.items) {
    if (item.bought) continue;
    if (notSoldIds.has(item.productId)) {
      notSold.push(item);
      continue;
    }
    const view = viewsById.get(item.productId);
    if (!view) continue;
    if (unplacedBooths.has(view.booth.id)) {
      unplaced.push(item);
      continue;
    }
    if (!stopByBooth.has(view.booth.id)) continue;
    const items = itemsByBooth.get(view.booth.id) ?? [];
    items.push(item);
    itemsByBooth.set(view.booth.id, items);
  }

  const buckets = route.stops.map((stop) => {
    const first = itemsByBooth.get(stop.boothId)?.[0];
    return {
      stop,
      items: itemsByBooth.get(stop.boothId) ?? [],
      booth: first ? viewsById.get(first.productId)?.booth : undefined,
    };
  });
  return { route, buckets, unplaced, notSold };
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
  page.append(el("h2", "section-title", "会場マップと回る順番"));

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
      boothSelect.value = booth.code;
      syncPanel(store.getState());
    },
  });
  boothSelect.addEventListener("change", () => {
    selectedCode = boothSelect.value || null;
    syncPanel(store.getState());
  });
  mapFrame.append(map);
  mapColumn.append(boothPicker, toolbar, mapFrame);

  const legend = el("div", "map-legend");
  legend.setAttribute("role", "group");
  legend.setAttribute("aria-label", "地図の凡例");
  const listedEntry = el("span", "map-legend-entry");
  listedEntry.append(el("span", "map-legend-swatch list"), el("span", "", "リストに未購入の商品がある"));
  legend.append(listedEntry);
  const noShowEntry = el("span", "map-legend-entry");
  noShowEntry.append(el("span", "map-legend-swatch map-no-show-swatch"), el("span", "", "出展なし"));
  legend.append(noShowEntry);
  const routeEntry = el("span", "map-legend-entry");
  routeEntry.append(el("span", "map-route-swatch"), el("span", "", "回る順番"));
  legend.append(routeEntry);
  mapColumn.append(legend);
  workspace.append(mapColumn, panel);

  const routeSection = el("section", "map-route-section");
  routeSection.append(el("h3", "map-section-title", "回る順番"));
  const routeOptions = el("div", "map-route-options");
  const showRouteLabel = el("label", "check-option");
  const showRouteInput = el("input");
  showRouteInput.type = "checkbox";
  showRouteInput.addEventListener("change", () => {
    store.update((state) => ({ ...state, route: { ...state.route, show: showRouteInput.checked } }));
  });
  showRouteLabel.append(showRouteInput, el("span", "", "回る順番を表示"));
  const specialLabel = el("label", "check-option");
  const specialInput = el("input");
  specialInput.type = "checkbox";
  specialInput.addEventListener("change", () => {
    store.update((state) => ({ ...state, route: { ...state.route, frontLoadSpecial: specialInput.checked } }));
  });
  specialLabel.append(specialInput, el("span", "", "新作・限定のあるブースを先に回る"));
  routeOptions.append(showRouteLabel, specialLabel);

  const routeSummary = el("div", "map-route-summary");
  const routeEmpty = el("p", "map-route-empty", "回るブースはありません。リストに未購入の商品を入れると順番を表示します。");
  const routeList = el("ol", "map-route-list");
  routeList.setAttribute("aria-label", "回る順番");
  const routeNotices = el("div", "map-route-notices");
  routeSummary.append(routeEmpty, routeList, routeNotices);
  routeSection.append(routeOptions, routeSummary);
  page.append(workspace, routeSection, details.element);

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
      panel.append(el("h3", "map-panel-title", selectedCode + " " + title));

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
      return;
    }

    if (renderedPanelItems === state.items) return;
    const itemById = new Map(state.items.map((item): [string, CartItem] => [item.productId, item]));
    for (const { view, card } of productsInPanel) card.update(itemById.get(view.product.id));
    renderedPanelItems = state.items;
  }

  let routeViewKey = "";
  let previousPaintDay: Day | undefined;
  let previousPaintItems: CartItem[] | undefined;
  let previousRouteKey = "";
  let previousShowRoute: boolean | undefined;
  let pickerDay: Day | undefined;
  let currentRoute = emptyWalkingRoute;
  const sync = (state: AppState) => {
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
    const routeInput = buildRouteStops(state.items, catalog, venueLayout, state.day, { onlyUnbought: true });
    const nextRouteKey = JSON.stringify([
      state.day,
      state.route.frontLoadSpecial,
      routeInput.stops.map(({ boothId, code, special }) => [boothId, code, special]),
    ]);
    const routePlanChanged = previousRouteKey !== nextRouteKey;
    const routeVisibilityChanged = previousShowRoute !== state.route.show;
    const routeChanged = routePlanChanged || routeVisibilityChanged;
    if (routePlanChanged) {
      currentRoute = routeInput.stops.length
        ? planWalkingRoute(getWalkGrid(venueLayout), routeInput.stops, {
          frontLoadSpecial: state.route.frontLoadSpecial,
        })
        : emptyWalkingRoute;
      previousRouteKey = nextRouteKey;
    }
    const plan = routePlan(state, routeInput, currentRoute);
    if (routeChanged) {
      update.route = state.route.show ? plan.route : emptyWalkingRoute;
      previousShowRoute = state.route.show;
    }
    if (paintsChanged || routeChanged) map.update(update);
    showRouteInput.checked = state.route.show;
    specialInput.checked = state.route.frontLoadSpecial;
    routeSummary.hidden = !state.route.show;
    const nextRouteViewKey = JSON.stringify([
      state.route.show,
      plan.buckets.map(({ stop, items, booth }) => [stop.code, booth?.name, items.length]),
      plan.unplaced.map((item) => item.productId),
      plan.notSold.map((item) => item.productId),
    ]);
    if (nextRouteViewKey !== routeViewKey) {
      routeViewKey = nextRouteViewKey;
      routeEmpty.hidden = plan.buckets.length > 0;
      routeList.hidden = plan.buckets.length === 0;
      routeList.replaceChildren(...plan.buckets.map(({ stop, items, booth }, index) => {
        const name = booth?.name ?? stop.code;
        const entry = el("li", "map-route-item");
        entry.append(
          el("span", "map-route-number", (index + 1) + "."),
          el("strong", "map-route-organization", name),
          el("small", "map-route-booth", stop.code),
          el("span", "map-route-count", items.length + "件"),
        );
        return entry;
      }));

      const notices: HTMLElement[] = [];
      if (plan.unplaced.length) {
        const section = el("section", "map-route-notice");
        section.append(el("h4", "", "場所が未定"));
        const list = el("ul");
        for (const item of plan.unplaced) {
          const view = viewsById.get(item.productId);
          if (view) list.append(el("li", "", view.product.name + " — " + view.booth.name));
        }
        section.append(list);
        notices.push(section);
      }
      if (plan.notSold.length) {
        const section = el("section", "map-route-notice");
        section.append(el("h4", "", "この日は売っていません"));
        const list = el("ul");
        for (const item of plan.notSold) {
          const view = viewsById.get(item.productId);
          if (view) list.append(el("li", "", view.product.name + " — " + view.booth.name));
        }
        section.append(list);
        notices.push(section);
      }
      routeNotices.replaceChildren(...notices);
    }
    syncPanel(state);
  };

  return { element: page, sync };
}

import { catalog, venueLayout } from "../data.ts";
import {
  daySummary,
  nazocolleProgress,
  toggleBought,
  type CartItem,
  type Priority,
} from "../logic/cart.ts";
import { buildRouteStops, planRoute, type RouteStop } from "../logic/route.ts";
import type { ProductView } from "../logic/catalog.ts";
import type { AppState } from "../state.ts";
import type { AppStore } from "../store.ts";
import { button, el } from "./dom.ts";

const viewById = new Map(catalog.map((view): [string, ProductView] => [view.product.id, view]));
const boothById = new Map(catalog.map((view): [string, ProductView["booth"]] => [view.booth.id, view.booth]));
const priorityNames: Record<Priority, string> = { must: "絶対", want: "できれば", maybe: "余裕があれば" };

type TodayRow = {
  element: HTMLLabelElement;
  update: (item: CartItem, hideBought: boolean) => void;
};

type TodaySection = { element: HTMLElement; heading: HTMLElement; rows: HTMLElement };
type RouteBucket = { key: string; title: string; ids: string[] };

export type TodayView = { element: HTMLElement; sync: (state: AppState) => void };

function todayRow(view: ProductView, initial: CartItem, store: AppStore): TodayRow {
  const row = el("label", "today-item");
  const checkbox = el("input");
  checkbox.type = "checkbox";
  checkbox.addEventListener("change", () => {
    store.update((state) => ({ ...state, items: toggleBought(state.items, view.product.id) }));
  });

  const description = el("span", "today-item-description");
  const name = el("span", "today-item-name", view.product.name);
  const amount = el("span", "today-item-amount");
  description.append(name, amount);
  const priority = el("span", "today-item-priority");
  const bought = el("span", "today-item-status");
  row.append(checkbox, description, priority, bought);

  let currentItem: CartItem | undefined;
  let currentHideBought: boolean | undefined;
  const update = (item: CartItem, hideBought: boolean) => {
    const itemUnchanged = currentItem !== undefined
      && currentItem.productId === item.productId
      && currentItem.priority === item.priority
      && currentItem.qty === item.qty
      && currentItem.bought === item.bought;
    if (itemUnchanged && currentHideBought === hideBought) {
      currentItem = item;
      return;
    }
    currentItem = item;
    currentHideBought = hideBought;
    checkbox.checked = item.bought;
    checkbox.setAttribute("aria-label", view.product.name + (item.bought ? "、買った" : "、買う"));
    const unit = view.product.price === null
      ? "価格未確認"
      : view.product.price.toLocaleString("ja-JP") + "円";
    const subtotal = view.product.price === null
      ? ""
      : " = " + (view.product.price * item.qty).toLocaleString("ja-JP") + "円";
    amount.textContent = unit + " × " + item.qty + subtotal;
    priority.textContent = priorityNames[item.priority];
    priority.className = "today-item-priority priority-" + item.priority;
    row.classList.toggle("is-bought", item.bought);
    row.classList.toggle("priority-must", item.priority === "must");
    row.classList.toggle("priority-want", item.priority === "want");
    row.classList.toggle("priority-maybe", item.priority === "maybe");
    row.hidden = hideBought && item.bought;
    bought.textContent = item.bought ? "✓ 買った" : "買う";
  };

  update(initial, false);
  return { element: row, update };
}

function routeBuckets(state: AppState): RouteBucket[] {
  const { stops, unplaced, notSoldThatDay } = buildRouteStops(
    state.items,
    catalog,
    venueLayout,
    state.day,
    { onlyUnbought: true },
  );
  const ordered = planRoute(stops, venueLayout.entrance, { frontLoadSpecial: state.route.frontLoadSpecial });
  const placedByBooth = new Map<string, string[]>();
  for (const stop of ordered) placedByBooth.set(stop.boothId, []);
  const unplacedIds = new Set<string>();
  const notSoldIds = new Set(notSoldThatDay);
  const unplacedBooths = new Set(unplaced);
  const boughtIds: string[] = [];

  for (const item of state.items) {
    const view = viewById.get(item.productId);
    if (!view || notSoldIds.has(item.productId)) continue;
    if (unplacedBooths.has(view.booth.id)) {
      unplacedIds.add(item.productId);
      continue;
    }
    const bucket = placedByBooth.get(view.booth.id);
    if (bucket) {
      bucket.push(item.productId);
    } else if (item.bought) {
      boughtIds.push(item.productId);
    }
  }

  const buckets: RouteBucket[] = [];
  ordered.forEach((stop: RouteStop, index) => {
    const ids = placedByBooth.get(stop.boothId) ?? [];
    const booth = boothById.get(stop.boothId);
    if (!booth || !ids.length) return;
    buckets.push({ key: "booth:" + stop.boothId, title: (index + 1) + ". " + stop.code + " " + booth.name, ids });
  });
  if (boughtIds.length) {
    buckets.push({ key: "bought", title: "買ったもの", ids: boughtIds });
  }
  if (unplacedIds.size) {
    buckets.push({
      key: "unplaced",
      title: "場所が未定",
      ids: state.items.filter((item) => unplacedIds.has(item.productId)).map((item) => item.productId),
    });
  }
  if (notSoldIds.size) {
    buckets.push({
      key: "not-sold",
      title: "この日は売っていません",
      ids: state.items.filter((item) => notSoldIds.has(item.productId)).map((item) => item.productId),
    });
  }
  return buckets;
}

export function todayView(store: AppStore): TodayView {
  const page = el("section", "today-page");
  const heading = el("h2", "section-title", "当日");

  const summary = el("section", "today-summary");
  summary.setAttribute("aria-label", "購入状況");
  summary.setAttribute("aria-live", "polite");
  summary.setAttribute("aria-atomic", "true");
  const spentTile = el("div", "today-summary-tile");
  const spentValue = el("strong", "today-summary-value", "0円");
  spentTile.append(el("span", "today-summary-label", "使った金額"), spentValue);
  const remainingTile = el("div", "today-summary-tile");
  const remainingValue = el("strong", "today-summary-value", "—");
  remainingTile.append(el("span", "today-summary-label", "残り予算"), remainingValue);
  const pointsTile = el("div", "today-summary-tile");
  const pointsValue = el("strong", "today-summary-value", "0点");
  pointsTile.append(el("span", "today-summary-label", "購入点数"), pointsValue);
  summary.append(spentTile, remainingTile, pointsTile);

  const unknownBought = el("p", "today-unknown-price");
  const nazocolle = el("section", "today-nazocolle");
  nazocolle.append(el("h3", "cart-section-title", "ナゾコレ"));
  const nazocolleIntro = el("p", "today-nazocolle-intro");
  const pointsLabel = el("label", "today-points-field");
  const pointsInput = el("input", "text-input today-points-input");
  pointsInput.type = "number";
  pointsInput.min = "1";
  pointsInput.max = "20";
  pointsInput.step = "1";
  pointsInput.inputMode = "numeric";
  pointsInput.setAttribute("aria-label", "何点で1回？。1から20の整数。空欄で未設定");
  pointsInput.setAttribute("aria-describedby", "today-points-error");
  pointsLabel.append(el("span", "field-label", "何点で1回？"), pointsInput);
  const nazocolleResult = el("p", "today-nazocolle-result");
  nazocolleResult.setAttribute("aria-live", "polite");
  const pointsError = el("p", "today-points-error");
  pointsError.id = "today-points-error";
  pointsError.setAttribute("role", "status");
  nazocolle.append(nazocolleIntro, pointsLabel, nazocolleResult, pointsError);

  const hideBoughtLabel = el("label", "check-option today-hide-bought");
  const hideBoughtInput = el("input");
  hideBoughtInput.type = "checkbox";
  hideBoughtInput.addEventListener("change", () => {
    store.update((state) => ({ ...state, today: { ...state.today, hideBought: hideBoughtInput.checked } }));
  });
  hideBoughtLabel.append(hideBoughtInput, el("span", "", "買ったものを隠す"));

  const allBought = el("p", "today-all-bought");
  allBought.setAttribute("role", "status");
  const empty = el("div", "empty-state today-empty");
  empty.append(el("p", "", "リストに商品がありません。一覧で『絶対』『できれば』『余裕あれば』を押すと、ここに表示されます"));
  const goCart = button("リストを見る", "button button-primary");
  goCart.addEventListener("click", () => store.update((state) => ({ ...state, tab: "cart" })));
  empty.append(goCart);

  const routeTitle = el("h3", "today-route-title", "回る順番");
  const groupsRoot = el("div", "today-route-groups");
  page.append(
    heading,
    summary,
    unknownBought,
    nazocolle,
    hideBoughtLabel,
    allBought,
    empty,
    routeTitle,
    groupsRoot,
  );

  const rows = new Map<string, TodayRow>();
  const sections = new Map<string, TodaySection>();
  let previousItems: CartItem[] | undefined;
  let previousBudget: number | null | undefined;
  let previousPointsPerDraw: number | null | undefined;
  let previousHideBought: boolean | undefined;
  let previousRouteKey = "";
  let previousStructure = "";

  const setRouteHeading = (heading: HTMLElement, title: string) => {
    const match = title.match(/^(\d+\.\s+)(\S+)(.*)$/);
    if (!match) {
      heading.removeAttribute("aria-label");
      heading.textContent = title;
      return;
    }
    const boothCode = el("span", "today-route-booth", match[2]);
    boothCode.setAttribute("aria-hidden", "true");
    heading.replaceChildren(document.createTextNode(match[1]), boothCode, document.createTextNode(match[3]));
    heading.setAttribute("aria-label", title);
  };

  const getSection = (key: string): TodaySection => {
    const existing = sections.get(key);
    if (existing) return existing;
    const section = el("section", "today-route-group");
    const groupHeading = el("h4", "today-route-heading");
    const groupRows = el("div", "today-route-rows");
    section.append(groupHeading, groupRows);
    const created = { element: section, heading: groupHeading, rows: groupRows };
    sections.set(key, created);
    return created;
  };

  const updateTotals = (state: AppState) => {
    const totals = daySummary(state.items, (id) => viewById.get(id)?.product.price ?? null, state.budget);
    const format = (amount: number) => amount.toLocaleString("ja-JP") + "円";
    spentValue.textContent = format(totals.spent);
    remainingTile.hidden = state.budget === null;
    remainingTile.classList.toggle("is-over-budget", totals.remaining !== null && totals.remaining < 0);
    remainingValue.textContent = totals.remaining === null
      ? ""
      : totals.remaining < 0
        ? format(-totals.remaining) + "オーバー"
        : format(totals.remaining);
    pointsValue.textContent = totals.boughtQty + "点";
    unknownBought.textContent = totals.unknownPriceBought
      ? "価格不明 " + totals.unknownPriceBought + "件は合計に含まれていません"
      : "";
    nazocolleIntro.textContent = "購入" + totals.boughtQty + "点。福引は購入数に応じて最大5回";
    const pointsPerDraw = state.nazocolle.pointsPerDraw;
    const progress = nazocolleProgress(totals.boughtQty, { pointsPerDraw, maxDraws: 5 });
    nazocolleResult.textContent = pointsPerDraw === null
      ? "点数を入力すると福引の回数を表示します"
      : progress.maxed
        ? "福引は最大の5回分です"
        : "福引" + progress.draws + "回分・あと" + progress.nextIn + "点で次の1回";
    allBought.textContent = state.items.length > 0 && totals.leftToBuy === 0
      ? "リストの商品はすべて買いました"
      : "";
    allBought.hidden = !allBought.textContent;
    empty.hidden = state.items.length > 0;
    routeTitle.hidden = state.items.length === 0;
    groupsRoot.hidden = state.items.length === 0;
  };

  pointsInput.addEventListener("input", () => {
    const value = pointsInput.value;
    if (value === "") {
      pointsError.textContent = "";
      pointsInput.setAttribute("aria-invalid", "false");
      if (store.getState().nazocolle.pointsPerDraw !== null) {
        store.update((state) => ({ ...state, nazocolle: { pointsPerDraw: null } }));
      }
      return;
    }
    const pointsPerDraw = Number(value);
    if (!Number.isInteger(pointsPerDraw) || pointsPerDraw < 1 || pointsPerDraw > 20) {
      pointsError.textContent = "1〜20の整数を入力してください";
      pointsInput.setAttribute("aria-invalid", "true");
      return;
    }
    pointsError.textContent = "";
    pointsInput.setAttribute("aria-invalid", "false");
    if (store.getState().nazocolle.pointsPerDraw !== pointsPerDraw) {
      store.update((state) => ({ ...state, nazocolle: { pointsPerDraw } }));
    }
  });

  const sync = (state: AppState) => {
    const itemById = new Map(state.items.map((item): [string, CartItem] => [item.productId, item]));
    for (const [id, row] of rows) {
      if (itemById.has(id)) continue;
      row.element.remove();
      rows.delete(id);
    }
    for (const item of state.items) {
      const view = viewById.get(item.productId);
      if (!view) continue;
      let row = rows.get(item.productId);
      if (!row) {
        row = todayRow(view, item, store);
        rows.set(item.productId, row);
      }
      row.update(item, state.today.hideBought);
    }

    const routeKey = JSON.stringify([
      state.day,
      state.route.frontLoadSpecial,
      state.items.map((item) => [item.productId, item.priority, item.bought]),
    ]);
    if (routeKey !== previousRouteKey) {
      const buckets = routeBuckets(state);
      const structure = JSON.stringify(buckets.map((bucket) => [bucket.key, bucket.title, bucket.ids]));
      if (structure !== previousStructure) {
        const orderedSections: HTMLElement[] = [];
        for (const bucket of buckets) {
          const section = getSection(bucket.key);
          setRouteHeading(section.heading, bucket.title);
          section.rows.replaceChildren(...bucket.ids.flatMap((id) => {
            const row = rows.get(id);
            return row ? [row.element] : [];
          }));
          orderedSections.push(section.element);
        }
        groupsRoot.replaceChildren(...orderedSections);
        previousStructure = structure;
      }
      previousRouteKey = routeKey;
    }

    const shouldUpdateTotals = previousItems !== state.items
      || previousBudget !== state.budget
      || previousPointsPerDraw !== state.nazocolle.pointsPerDraw;
    if (shouldUpdateTotals) updateTotals(state);
    if (previousPointsPerDraw !== state.nazocolle.pointsPerDraw) {
      if (document.activeElement !== pointsInput) {
        pointsInput.value = state.nazocolle.pointsPerDraw === null ? "" : String(state.nazocolle.pointsPerDraw);
      }
      previousPointsPerDraw = state.nazocolle.pointsPerDraw;
    }
    previousBudget = state.budget;
    if (previousItems !== state.items) {
      previousItems = state.items;
    }
    if (previousHideBought !== state.today.hideBought) {
      hideBoughtInput.checked = state.today.hideBought;
      previousHideBought = state.today.hideBought;
    }
  };

  return { element: page, sync };
}

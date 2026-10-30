import { CATEGORY_NAMES, type ProductView } from "../logic/catalog.ts";
import type { CartItem } from "../logic/cart.ts";
import { difficultyTier } from "../logic/difficultyTier.ts";
import { formatPlayMinutes } from "../logic/playTime.ts";
import "./catalogPolish.css";
import { button, el } from "./dom.ts";
import { celebrateGet, floatGain } from "./gameFx.ts";

// 一覧とマップに同じ商品のカードが並ぶため、説明文のIDは通し番号で一意にする
let quantityHintCount = 0;

export type ProductCardActions = {
  onDetail: (view: ProductView) => void;
  onToggle: (productId: string) => void;
  onToggleBought?: (productId: string) => void;
  onQty: (productId: string, qty: number) => void;
  canChangeList?: () => boolean;
  showBoothLocation?: boolean;
};

export type ProductCardHandle = {
  element: HTMLElement;
  update: (item: CartItem | undefined, reasons?: string[]) => void;
};

export function productCard(view: ProductView, item: CartItem | undefined, actions: ProductCardActions): ProductCardHandle {
  const product = view.product;
  const card = el("article", "product-card");
  card.dataset.productId = product.id;
  card.dataset.organization = view.booth.name;
  card.dataset.difficulty = difficultyTier(product.difficulty.level);

  const stub = el("div", "ticket-stub");
  if (!view.booth.boothCode) stub.classList.add("is-undecided");
  stub.append(el("strong", "ticket-organization", view.booth.name));
  stub.append(el("span", "ticket-booth", view.booth.boothCode ?? "未定"));
  card.append(stub);

  const media = el("div", "product-media");
  const fallback = el("span", "image-fallback", CATEGORY_NAMES[product.category]);
  if (product.imageUrl) {
    const image = el("img", "product-image");
    image.src = product.imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.width = 640;
    image.height = 480;
    image.addEventListener("error", () => {
      image.hidden = true;
      fallback.hidden = false;
    }, { once: true });
    fallback.hidden = true;
    media.append(image, fallback);
  } else {
    media.append(fallback);
  }
  card.append(media);

  const body = el("div", "product-card-body");
  const name = button(product.name, "product-name");
  name.addEventListener("click", () => actions.onDetail(view));
  const nameHeading = el("h2", "product-name-heading");
  const organization = view.booth.name + (actions.showBoothLocation ? " ・ " + (view.booth.boothCode ?? "未定") : "");
  const organizationElement = el("span", "product-organization", organization);
  if (actions.showBoothLocation) nameHeading.append(organizationElement);
  nameHeading.append(name);
  body.append(nameHeading);

  const price = product.price === null ? "価格未確認" : product.price.toLocaleString("ja-JP") + "円";
  const priceElement = el("p", "product-price");
  if (product.price === null) {
    priceElement.textContent = price;
  } else {
    priceElement.append(
      el("span", "product-price-value", product.price.toLocaleString("ja-JP")),
      el("span", "product-price-unit", "円"),
    );
  }
  const oneLiner = el("p", "product-one-liner", product.oneLiner);

  const difficulty = el("div", "difficulty");
  if (!actions.showBoothLocation) difficulty.append(organizationElement);
  if (product.difficulty.level === null) {
    difficulty.append(el("span", "difficulty-unknown", "難易度不明"));
  } else {
    const stars = el("span", "difficulty-stars", "★".repeat(product.difficulty.level) + "☆".repeat(5 - product.difficulty.level));
    stars.setAttribute("aria-hidden", "true");
    difficulty.append(stars, el("span", "sr-only", "難易度 " + product.difficulty.level + " / 5"));
    if (product.difficulty.source === "estimated") difficulty.append(el("span", "tag tag-small", "推定"));
  }
  body.append(difficulty, priceElement, oneLiner);
  if (product.playMinutes !== null) {
    difficulty.append(el("span", "product-duration", "所要時間 " + formatPlayMinutes(product.playMinutes)));
  }

  const tags = el("div", "product-tags");
  for (const tag of view.featureTags) {
    const tagText = el("span", "", tag);
    const hash = el("span", "", "#");
    hash.setAttribute("aria-hidden", "true");
    const tagLabel = el("span", "tag");
    tagLabel.append(hash, tagText);
    tags.append(tagLabel);
  }
  body.append(tags);
  const reasons = el("div", "product-reasons");
  reasons.hidden = true;
  body.append(reasons);

  const actionsArea = el("div", "product-actions");
  let currentItem = item;
  let boughtCheckbox: HTMLInputElement | null = null;
  if (actions.onToggleBought) {
    const boughtLabel = el("label", "today-item-check map-bought-check");
    boughtCheckbox = el("input");
    boughtCheckbox.type = "checkbox";
    boughtCheckbox.setAttribute("aria-label", product.name + "を買えたにする");
    boughtCheckbox.addEventListener("change", () => {
      if (boughtCheckbox?.checked) celebrateGet(product.name);
      actions.onToggleBought?.(product.id);
    });
    boughtLabel.append(boughtCheckbox, el("span", "", "買えた"));
    actionsArea.append(boughtLabel);
  }
  const listToggle = button("", "list-toggle");
  const listToggleMark = el("span", "list-toggle-mark", "+");
  listToggleMark.setAttribute("aria-hidden", "true");
  const listToggleLabel = el("span", "list-toggle-label");
  const listToggleText = el("span", "list-toggle-text");
  const listToggleHint = el("span", "list-toggle-hint");
  listToggleLabel.append(listToggleText, listToggleHint);
  listToggle.append(listToggleMark, listToggleLabel);
  listToggle.addEventListener("click", () => {
    if (!currentItem && product.price !== null) floatGain("+¥" + product.price.toLocaleString("ja-JP"));
    actions.onToggle(product.id);
  });
  actionsArea.append(listToggle);
  const quantity = el("div", "quantity-control");
  const minus = button("−", "quantity-button");
  minus.setAttribute("aria-label", product.name + "の数量を減らす");
  const quantityText = el("span", "quantity-value", "1");
  quantityText.setAttribute("aria-live", "polite");
  const quantityHint = el("span", "quantity-hint", "購入チェックを外すと変更できます");
  quantityHint.hidden = true;
  quantityHint.id = "quantity-hint-" + (quantityHintCount += 1);
  minus.setAttribute("aria-describedby", quantityHint.id);
  const plus = button("+", "quantity-button");
  plus.setAttribute("aria-label", product.name + "の数量を増やす");
  plus.setAttribute("aria-describedby", quantityHint.id);
  minus.addEventListener("click", () => {
    if (currentItem) actions.onQty(product.id, currentItem.qty - 1);
  });
  plus.addEventListener("click", () => {
    if (currentItem) actions.onQty(product.id, currentItem.qty + 1);
  });
  quantity.append(minus, quantityText, plus, quantityHint);
  actionsArea.append(quantity);
  card.append(body, actionsArea);

  const update = (nextItem: CartItem | undefined, nextReasons?: string[], canChangeList = actions.canChangeList?.() ?? true) => {
    currentItem = nextItem;
    listToggle.disabled = !canChangeList;
    minus.disabled = !canChangeList || nextItem?.bought === true || nextItem?.qty === 1;
    plus.disabled = !canChangeList || nextItem?.bought === true || nextItem?.qty === 99;
    listToggle.setAttribute("aria-pressed", String(Boolean(nextItem)));
    listToggleMark.textContent = nextItem ? "✓" : "+";
    listToggleText.textContent = nextItem ? "リストに追加済み" : "リストに入れる";
    listToggleHint.textContent = "タップで外す";
    listToggleHint.hidden = !nextItem;
    quantity.hidden = !nextItem;
    quantityText.textContent = nextItem ? String(nextItem.qty) : "1";
    quantityHint.hidden = nextItem?.bought !== true;
    if (boughtCheckbox) {
      boughtCheckbox.checked = nextItem?.bought === true;
      boughtCheckbox.disabled = !canChangeList;
      const boughtLabel = boughtCheckbox.closest("label");
      if (boughtLabel) boughtLabel.hidden = !nextItem;
    }
    if (nextReasons !== undefined) {
      reasons.replaceChildren(...nextReasons.map((reason) => el("span", "tag", reason)));
      reasons.hidden = nextReasons.length === 0;
    }
  };

  update(item);
  return { element: card, update };
}

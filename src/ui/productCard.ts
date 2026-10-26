import { CATEGORY_NAMES, type ProductView } from "../logic/catalog.ts";
import { PRIORITIES, type CartItem, type Priority } from "../logic/cart.ts";
import { button, el } from "./dom.ts";

export type ProductCardActions = {
  onDetail: (view: ProductView) => void;
  onPriority: (productId: string, priority: Priority) => void;
  onQty: (productId: string, qty: number) => void;
  onFeatureTag?: (tag: string, productId: string) => void;
  selectedTags?: string[];
};

export type ProductCardHandle = {
  element: HTMLElement;
  update: (item: CartItem | undefined) => void;
};

export function productCard(view: ProductView, item: CartItem | undefined, actions: ProductCardActions): ProductCardHandle {
  const product = view.product;
  const card = el("article", "product-card");
  card.dataset.productId = product.id;

  const stub = el("div", "ticket-stub");
  if (!view.booth.boothCode) stub.classList.add("is-undecided");
  stub.append(el("span", "ticket-stub-label", "ブース"));
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
  nameHeading.append(name);
  body.append(nameHeading);

  const boothCode = view.booth.boothCode ?? "番号未定";
  const boothLabel = el("p", "product-booth", boothCode + " " + view.booth.name);
  boothLabel.textContent = view.booth.boothCode ?? "未定";
  stub.append(boothLabel);

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
  difficulty.append(el("span", "product-organization", view.booth.name));
  if (product.difficulty.level === null) {
    difficulty.append(el("span", "difficulty-unknown", "難易度不明"));
  } else {
    const stars = el("span", "difficulty-stars", "★".repeat(product.difficulty.level) + "☆".repeat(5 - product.difficulty.level));
    stars.setAttribute("aria-hidden", "true");
    difficulty.append(stars, el("span", "sr-only", "難易度 " + product.difficulty.level + " / 5"));
    if (product.difficulty.source === "estimated") difficulty.append(el("span", "tag tag-small", "推定"));
  }
  body.append(difficulty, priceElement, oneLiner);

  const tags = el("div", "product-tags");
  for (const tag of view.featureTags) {
    const tagText = el("span", "", tag);
    const hash = el("span", "", "#");
    hash.setAttribute("aria-hidden", "true");
    if (actions.onFeatureTag) {
      const tagButton = button("", "tag tag-button");
      tagButton.append(hash, tagText);
      tagButton.dataset.featureTag = tag;
      tagButton.setAttribute("aria-pressed", String(actions.selectedTags?.includes(tag) ?? false));
      tagButton.addEventListener("click", () => actions.onFeatureTag?.(tag, product.id));
      tags.append(tagButton);
    } else {
      const tagLabel = el("span", "tag");
      tagLabel.append(hash, tagText);
      tags.append(tagLabel);
    }
  }
  body.append(tags);

  const actionsArea = el("div", "product-actions");
  const actionsLabel = el("span", "product-actions-label", "リストに入れる");
  const prioritySwitch = el("div", "priority-switch");
  prioritySwitch.setAttribute("role", "group");
  prioritySwitch.setAttribute("aria-label", "優先度");
  const priorityButtons = new Map<Priority, HTMLButtonElement>();
  for (const priority of PRIORITIES) {
    const action = button(priority.label === "余裕があれば" ? "余裕あれば" : priority.label, "priority-button priority-" + priority.key);
    action.setAttribute("aria-pressed", String(item?.priority === priority.key));
    action.addEventListener("click", () => actions.onPriority(product.id, priority.key));
    priorityButtons.set(priority.key, action);
    prioritySwitch.append(action);
  }
  actionsArea.append(actionsLabel, prioritySwitch);
  const quantity = el("div", "quantity-control");
  let currentItem = item;
  const minus = button("−", "quantity-button");
  minus.setAttribute("aria-label", product.name + "の数量を減らす");
  const quantityText = el("span", "quantity-value", "1");
  quantityText.setAttribute("aria-live", "polite");
  const plus = button("+", "quantity-button");
  plus.setAttribute("aria-label", product.name + "の数量を増やす");
  minus.addEventListener("click", () => {
    if (currentItem) actions.onQty(product.id, currentItem.qty - 1);
  });
  plus.addEventListener("click", () => {
    if (currentItem) actions.onQty(product.id, currentItem.qty + 1);
  });
  quantity.append(minus, quantityText, plus);
  actionsArea.append(quantity);
  card.append(body, actionsArea);

  const update = (nextItem: CartItem | undefined) => {
    currentItem = nextItem;
    for (const [priority, action] of priorityButtons) {
      action.setAttribute("aria-pressed", String(nextItem?.priority === priority));
    }
    quantity.hidden = !nextItem;
    quantityText.textContent = nextItem ? String(nextItem.qty) : "1";
    minus.disabled = nextItem?.qty === 1;
    plus.disabled = nextItem?.qty === 99;
  };

  update(item);
  return { element: card, update };
}

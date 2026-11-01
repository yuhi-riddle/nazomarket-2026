import type { ProductView } from "../logic/catalog.ts";
import { CATEGORY_NAMES } from "../logic/catalog.ts";
import { formatPlayMinutes } from "../logic/playTime.ts";
import { venueLayout } from "../data.ts";
import { xTagsOf } from "../logic/tags.ts";
import { button, el, safeExternalLink } from "./dom.ts";
import { xHashtagLinks } from "./xHashtagLinks.ts";
import { boothLinkLabel, type BoothLinkKind } from "./boothLinkLabel.ts";
import { unconfirmedText } from "./unconfirmedText.ts";
import { limitedPrice } from "../logic/limitedPrice.ts";

export type ProductDialog = { element: HTMLDialogElement; open: (view: ProductView) => void };

let dialogInstance = 0;

function appendLinkGroup(parent: HTMLElement, title: string, urls: string[], kind: BoothLinkKind, organizationName: string): void {
  const seenUrls = new Set<string>();
  const seenLabels = new Set<string>();
  const group = el("div", "dialog-link-group");
  group.append(el("h4", "dialog-link-group-title", title));
  const list = el("div", "dialog-link-list");

  for (const url of urls) {
    let key: string;
    try {
      key = new URL(url).href;
    } catch {
      continue;
    }
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);

    const label = boothLinkLabel(url, kind);
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);
    const link = safeExternalLink(url, label, "dialog-booth-link");
    if (!link) continue;
    link.setAttribute("aria-label", organizationName + "の" + title + ": " + label + "（新しいタブで開く）");
    list.append(link);
  }

  if (list.childElementCount) {
    group.append(list);
    parent.append(group);
  }
}

export function productDialog(
  instance = "dialog-" + (++dialogInstance),
  onMapBooth?: (boothCode: string) => void,
): ProductDialog {
  const dialog = el("dialog", "product-dialog");
  dialog.setAttribute("aria-labelledby", "product-dialog-title-" + instance);
  const content = el("div", "dialog-content");
  const heading = el("h2", "dialog-title");
  heading.id = "product-dialog-title-" + instance;
  const close = button("×", "button button-secondary dialog-close");
  close.addEventListener("click", () => dialog.close());
  content.append(close, heading);
  close.setAttribute("aria-label", "閉じる");
  const details = el("div", "dialog-details");
  content.append(details);
  dialog.append(content);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  return {
    element: dialog,
    open(view) {
      const product = view.product;
      heading.textContent = product.name;
      details.replaceChildren();
      const boothCode = view.booth.boothCode;
      const boothLocation = el("div", "dialog-booth-location");
      boothLocation.append(el("p", "dialog-booth", (boothCode ?? "番号未定") + " " + view.booth.name));
      if (boothCode && onMapBooth && venueLayout.booths.some((booth) => booth.code === boothCode)) {
        const mapButton = button("地図で場所を見る", "button button-secondary dialog-map-link");
        mapButton.setAttribute("aria-label", "地図で場所を見る（" + boothCode + " " + view.booth.name + "）");
        mapButton.addEventListener("click", () => {
          dialog.close();
          onMapBooth(boothCode);
        });
        boothLocation.append(mapButton);
      }
      details.append(boothLocation);
      const boothLinks = el("div", "dialog-booth-links");
      boothLinks.append(el("h3", "dialog-booth-links-title", "団体リンク"));
      appendLinkGroup(boothLinks, "X", view.booth.links.x, "x", view.booth.name);
      appendLinkGroup(boothLinks, "Webサイト", view.booth.links.site, "site", view.booth.name);
      appendLinkGroup(boothLinks, "Instagram", view.booth.links.instagram, "instagram", view.booth.name);
      details.append(el("p", "dialog-price", product.price === null ? "価格未確認" : product.price.toLocaleString("ja-JP") + "円"));
      const limited = limitedPrice(product.price, product.priceNote);
      if (limited) {
        const row = el("p", "product-price-limited");
        row.append(el("span", "product-price-limited-label", limited.label));
        if (limited.regularPrice !== null) row.append(el("s", "product-price-regular", "通常" + limited.regularPrice.toLocaleString("ja-JP") + "円"));
        details.append(row);
      }
      if (product.priceNote) details.append(el("p", "dialog-note", product.priceNote));
      const description = el("p", "dialog-description", product.description);
      details.append(description);
      const facts = el("dl", "dialog-facts");
      const factRows: Array<[string, string]> = [
        ["カテゴリ", CATEGORY_NAMES[product.category]],
        ["所要時間", formatPlayMinutes(product.playMinutes)],
        ["人数", product.players ?? "未確認"],
        ["支払い", product.payment?.join("・") ?? "未確認"],
        ["難易度", product.difficulty.level === null ? "不明" : product.difficulty.level + " / 5" + (product.difficulty.source === "estimated" ? "（推定）" : "")],
      ];
      if (product.limited) factRows.push(["限定", product.limited]);
      for (const [label, value] of factRows) {
        facts.append(el("dt", "", label), el("dd", "", value));
      }
      details.append(facts);
      const hashtags = xHashtagLinks(xTagsOf(product, view.booth), "dialog-x-hashtags");
      if (hashtags) details.append(hashtags);
      const unconfirmed = unconfirmedText(product.unconfirmed);
      if (unconfirmed) details.append(el("p", "unconfirmed", unconfirmed));

      const sources = el("section", "dialog-links");
      sources.append(el("h3", "", "出典"));
      appendLinkGroup(
        sources,
        "アイテム情報",
        product.sources.map((source) => source.url),
        "source",
        view.booth.name,
      );
      if (sources.childElementCount > 1) details.append(sources);
      if (boothLinks.childElementCount > 1) details.append(boothLinks);
      if (!dialog.open) dialog.showModal();
    },
  };
}

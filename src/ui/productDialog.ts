import type { ProductView } from "../logic/catalog.ts";
import { CATEGORY_NAMES } from "../logic/catalog.ts";
import { formatPlayMinutes } from "../logic/playTime.ts";
import { xTagsOf } from "../logic/tags.ts";
import { button, el, safeExternalLink } from "./dom.ts";
import { xHashtagLinks } from "./xHashtagLinks.ts";

const unconfirmedNames: Record<string, string> = {
  price: "価格",
  playMinutes: "所要時間",
  players: "人数",
  payment: "支払い",
};

export type ProductDialog = { element: HTMLDialogElement; open: (view: ProductView) => void };

let dialogInstance = 0;

export function productDialog(instance = "dialog-" + (++dialogInstance)): ProductDialog {
  const dialog = el("dialog", "product-dialog");
  dialog.setAttribute("aria-labelledby", "product-dialog-title-" + instance);
  const content = el("div", "dialog-content");
  const heading = el("h2", "dialog-title");
  heading.id = "product-dialog-title-" + instance;
  const close = button("閉じる", "button button-secondary dialog-close");
  close.addEventListener("click", () => dialog.close());
  content.append(close, heading);
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
      details.append(el("p", "dialog-booth", (view.booth.boothCode ?? "番号未定") + " " + view.booth.name));
      const boothLinks = el("div", "dialog-booth-links");
      for (const [label, urls] of [["X", view.booth.links.x], ["団体サイト", view.booth.links.site]] as const) {
        for (const [index, url] of urls.entries()) {
          const link = safeExternalLink(url, label, "dialog-booth-link");
          if (!link) continue;
          link.setAttribute("aria-label", view.booth.name + "の" + label + (urls.length > 1 ? " " + (index + 1) : "") + "（新しいタブで開く）");
          boothLinks.append(link);
        }
      }
      if (boothLinks.childElementCount) details.append(boothLinks);
      details.append(el("p", "dialog-price", product.price === null ? "価格未確認" : product.price.toLocaleString("ja-JP") + "円"));
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
      if (product.unconfirmed.length) {
        details.append(el("p", "unconfirmed", "未確認: " + product.unconfirmed.map((key) => unconfirmedNames[key] ?? key).join("・")));
      }

      const links = el("section", "dialog-links");
      links.append(el("h3", "", "出典・団体のリンク"));
      for (const [index, source] of product.sources.entries()) {
        const link = safeExternalLink(source.url, "商品情報 " + (index + 1));
        if (link) links.append(link);
      }
      for (const url of view.booth.links.instagram) {
        const link = safeExternalLink(url, "Instagram");
        if (link) links.append(link);
      }
      if (links.childElementCount > 1) details.append(links);
      if (!dialog.open) dialog.showModal();
    },
  };
}

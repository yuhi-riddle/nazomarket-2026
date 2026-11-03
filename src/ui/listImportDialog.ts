import type { ImportedListItem } from "../logic/listLink.ts";
import { boothById, productById } from "../data.ts";
import { button, el } from "./dom.ts";
import "./listImportDialog.css";

export type ListImportDialog = { element: HTMLDialogElement; open: () => void };

export function listImportDialog(
  items: readonly ImportedListItem[],
  skipped: number,
  onAdd: (items: readonly ImportedListItem[]) => void,
): ListImportDialog {
  const dialog = el("dialog", "campaign-dialog list-import-dialog");
  dialog.setAttribute("aria-labelledby", "list-import-dialog-title");
  const content = el("div", "campaign-dialog-content list-import-dialog-content");
  const heading = el("h2", "campaign-dialog-title", "リストを受け取りました");
  heading.id = "list-import-dialog-title";
  content.append(heading);

  const resolved = items.flatMap((item) => {
    const product = productById.get(item.productId);
    if (!product) return [];
    const booth = boothById.get(product.boothId);
    return [{ ...item, product, booth }];
  });

  if (resolved.length === 0) {
    content.append(el("p", "list-import-dialog-empty", "このリンクの商品は見つかりませんでした"));
    const closeButton = button("閉じる", "button button-secondary");
    closeButton.addEventListener("click", () => dialog.close());
    content.append(closeButton);
  } else {
    let total = 0;
    let unknownPrice = 0;
    for (const item of resolved) {
      if (item.product.price === null) unknownPrice += 1;
      else total += item.product.price * item.qty;
    }

    const summary = el("p", "list-import-dialog-summary");
    summary.textContent = `${resolved.length}件・合計${total.toLocaleString("ja-JP")}円${unknownPrice > 0 ? `・価格不明${unknownPrice}件` : ""}`;
    content.append(summary);

    const list = el("ul", "campaign-dialog-list list-import-dialog-list");
    list.setAttribute("aria-label", "受け取った商品");
    for (const item of resolved) {
      const boothCode = item.booth?.boothCode ?? "番号未定";
      const boothName = item.booth?.name ?? "団体不明";
      const price = item.product.price === null
        ? "価格不明"
        : `${item.product.price.toLocaleString("ja-JP")}円`;
      const quantity = item.qty > 1 ? ` ×${item.qty}` : "";
      const row = el("li", "campaign-card list-import-dialog-item");
      row.textContent = `${boothCode} ${boothName}／${item.product.name}／${price}${quantity}`;
      list.append(row);
    }
    content.append(list);

    content.append(el("p", "campaign-meta list-import-dialog-note", "今のリストは消えません。同じ商品は個数の多いほうに合わせます。"));
    if (skipped > 0) {
      content.append(el("p", "campaign-meta list-import-dialog-note", `見つからない商品${skipped}件は除きました`));
    }

    const actions = el("div", "list-import-dialog-actions");
    const addButton = button("自分のリストに追加", "button button-primary");
    addButton.addEventListener("click", () => {
      dialog.close();
      onAdd(resolved.map(({ productId, qty }) => ({ productId, qty })));
    });
    const cancelButton = button("やめる", "button button-secondary");
    cancelButton.addEventListener("click", () => dialog.close());
    actions.append(addButton, cancelButton);
    content.append(actions);
  }

  dialog.append(content);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return { element: dialog, open: () => dialog.showModal() };
}

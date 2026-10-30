import { boothById, campaigns, productById } from "../data.ts";
import { deadlineLabel, listActiveCampaigns } from "../logic/campaigns.ts";
import type { Campaign, Day } from "../types.ts";
import { button, el, safeExternalLink } from "./dom.ts";
import "./campaign.css";

const kindNames: Record<Campaign["kind"], string> = {
  bonus: "購入特典",
  giveaway: "抽選・プレゼント",
  discount: "割引",
  other: "その他",
};

const dayNames: Record<Day, string> = { sat: "土", sun: "日" };

export type CampaignDialog = { element: HTMLDialogElement; open: () => void };

export function campaignDialog(openMapAtBooth: (code: string) => void): CampaignDialog {
  const dialog = el("dialog", "campaign-dialog");
  dialog.setAttribute("aria-labelledby", "campaign-dialog-title");
  const content = el("div", "campaign-dialog-content");
  const close = button("×", "button button-secondary campaign-dialog-close");
  close.setAttribute("aria-label", "閉じる");
  close.addEventListener("click", () => dialog.close());
  const heading = el("h2", "campaign-dialog-title", "キャンペーン情報");
  heading.id = "campaign-dialog-title";
  const list = el("div", "campaign-dialog-list");
  content.append(close, heading, list);
  dialog.append(content);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  const renderCampaign = (campaign: Campaign, now: Date): HTMLElement => {
    const article = el("article", "campaign-card");
    const header = el("div", "campaign-card-heading");
    header.append(el("span", "campaign-kind", kindNames[campaign.kind]));
    const booth = campaign.boothId === null ? null : boothById.get(campaign.boothId) ?? null;
    const organizationName = campaign.boothId === null ? "主催" : booth?.name ?? "";
    if (campaign.endsAt !== null) {
      const deadline = deadlineLabel(campaign.endsAt, now);
      const deadlineNode = el("div", "campaign-deadline");
      deadlineNode.append(el("strong", "campaign-deadline-date", deadline.date));
      deadlineNode.append(el("span", "campaign-deadline-remaining", deadline.remaining));
      header.append(deadlineNode);
    }
    const title = el("h4", "campaign-card-title", campaign.title);
    article.append(header, title, el("p", "campaign-detail", campaign.detail));

    const organization = el("p", "campaign-organization", organizationName + (booth?.boothCode ? `（${booth.boothCode}）` : ""));
    article.append(organization);

    const productNames = campaign.productIds.flatMap((id) => {
      const product = productById.get(id);
      return product ? [product.name] : [];
    });
    if (productNames.length) article.append(el("p", "campaign-meta", "対象：" + productNames.join("、")));
    if (campaign.days.length) {
      article.append(el("p", "campaign-meta", "受けられる日：" + campaign.days.map((day) => dayNames[day]).join("・") + " 会場"));
    }
    if (campaign.limit) article.append(el("p", "campaign-meta", "数量・人数：" + campaign.limit));

    if (campaign.sources.length) {
      const sources = el("div", "campaign-sources");
      campaign.sources.forEach((source, index) => {
        const label = campaign.sources.length === 1 ? "告知を見る" : `告知を見る ${index + 1}`;
        const link = safeExternalLink(source.url, label, "campaign-source-link");
        if (link) {
          link.setAttribute("aria-label", `${organizationName}の${label}（新しいタブで開く）`);
          sources.append(link);
        }
      });
      if (sources.childElementCount) article.append(sources);
    }

    if (booth?.boothCode) {
      const mapButton = button("地図で見る", "button button-secondary campaign-map-button");
      mapButton.addEventListener("click", () => {
        dialog.close();
        openMapAtBooth(booth.boothCode!);
      });
      article.append(mapButton);
    }
    return article;
  };

  return {
    element: dialog,
    open() {
      const now = new Date();
      const active = listActiveCampaigns(campaigns, now);
      list.replaceChildren();
      if (!active.withDeadline.length && !active.noDeadline.length) {
        list.append(el("p", "campaign-empty", "いま受け付けているキャンペーンはありません。"));
      } else {
        const appendGroup = (title: string, items: Campaign[]) => {
          if (!items.length) return;
          const group = el("section", "campaign-group");
          group.append(el("h3", "campaign-group-title", title));
          const cards = el("div", "campaign-cards");
          for (const campaign of items) cards.append(renderCampaign(campaign, now));
          group.append(cards);
          list.append(group);
        };
        appendGroup("締切あり（近い順）", active.withDeadline);
        appendGroup("締切なし・会場で受けられるもの", active.noDeadline);
      }
      if (!dialog.open) dialog.showModal();
    },
  };
}

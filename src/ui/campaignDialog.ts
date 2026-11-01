import { boothById, campaigns, productById } from "../data.ts";
import { countByKind, deadlineLabel, filterActiveByKind, listActiveCampaigns, type CampaignFilter } from "../logic/campaigns.ts";
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

export type CampaignDialog = { element: HTMLDialogElement; open: () => void; refresh: () => void };

export function campaignDialog(openMapAtBooth: (code: string) => void): CampaignDialog {
  const dialog = el("dialog", "campaign-dialog");
  dialog.setAttribute("aria-labelledby", "campaign-dialog-title");
  const content = el("div", "campaign-dialog-content");
  const close = button("×", "button button-secondary campaign-dialog-close");
  close.setAttribute("aria-label", "閉じる");
  close.addEventListener("click", () => dialog.close());
  const heading = el("h2", "campaign-dialog-title", "キャンペーン情報");
  heading.id = "campaign-dialog-title";
  const filters = el("div", "campaign-filter-row");
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "種類で絞り込む");
  const filterStatus = el("p", "campaign-filter-status");
  filterStatus.setAttribute("role", "status");
  const list = el("div", "campaign-dialog-list");
  content.append(close, heading, filters, filterStatus, list);
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

  // 表示中の中身の目印。締切が過ぎる・日付が変わると変わる
  let shownSignature = "";
  let selectedFilter: CampaignFilter = "all";
  let currentActive: ReturnType<typeof listActiveCampaigns> = { withDeadline: [], noDeadline: [] };
  let currentNow = new Date();
  let currentCounts = countByKind(currentActive);
  const signatureOf = (active: ReturnType<typeof listActiveCampaigns>, now: Date) =>
    active.withDeadline.map((campaign) => campaign.id + ":" + deadlineLabel(campaign.endsAt!, now).remaining)
      .concat(active.noDeadline.map((campaign) => campaign.id)).join("|");

  const filterOptions: CampaignFilter[] = ["all", "bonus", "giveaway", "discount", "other"];
  const filterButtons = filterOptions.map((filter) => {
    const control = button("", "button button-secondary campaign-filter-button");
    control.setAttribute("aria-pressed", "false");
    control.addEventListener("click", () => {
      selectedFilter = filter;
      for (let index = 0; index < filterOptions.length; index++) {
        filterButtons[index].setAttribute("aria-pressed", String(filterOptions[index] === selectedFilter));
      }
      filterStatus.textContent = `${currentCounts[selectedFilter]}件を表示`;
      const scrollTop = dialog.scrollTop;
      renderCards(currentNow, currentActive);
      dialog.scrollTop = scrollTop;
    });
    filters.append(control);
    return control;
  });

  const updateFilters = (active: ReturnType<typeof listActiveCampaigns>) => {
    const counts = countByKind(active);
    currentCounts = counts;
    filters.hidden = counts.all === 0;
    filterStatus.hidden = counts.all === 0;
    for (let index = 0; index < filterOptions.length; index++) {
      const filter = filterOptions[index];
      filterButtons[index].textContent = `${filter === "all" ? "すべて" : kindNames[filter]} ${counts[filter]}`;
      filterButtons[index].setAttribute("aria-pressed", String(selectedFilter === filter));
    }
    filterStatus.textContent = `${counts[selectedFilter]}件を表示`;
  };

  const render = (now: Date, active: ReturnType<typeof listActiveCampaigns>) => {
    shownSignature = signatureOf(active, now);
    currentNow = now;
    currentActive = active;
    updateFilters(active);
    renderCards(now, active);
  };

  const renderCards = (now: Date, active: ReturnType<typeof listActiveCampaigns>) => {
    list.replaceChildren();
    const filtered = filterActiveByKind(active, selectedFilter);
    if ((active.withDeadline.length || active.noDeadline.length) && !filtered.withDeadline.length && !filtered.noDeadline.length) {
      list.append(el("p", "campaign-empty", "この種類でいま受け付けているキャンペーンはありません。"));
      return;
    }
    if (!active.withDeadline.length && !active.noDeadline.length) {
      list.append(el("p", "campaign-empty", "いま受け付けているキャンペーンはありません。"));
      return;
    }
    const appendGroup = (title: string, items: Campaign[]) => {
      if (!items.length) return;
      const group = el("section", "campaign-group");
      group.append(el("h3", "campaign-group-title", title));
      const cards = el("div", "campaign-cards");
      for (const campaign of items) cards.append(renderCampaign(campaign, now));
      group.append(cards);
      list.append(group);
    };
    appendGroup("締切あり（近い順）", filtered.withDeadline);
    appendGroup("締切なし・会場で受けられるもの", filtered.noDeadline);
  };

  return {
    element: dialog,
    open() {
      const now = new Date();
      render(now, listActiveCampaigns(campaigns, now));
      if (!dialog.open) dialog.showModal();
    },
    refresh() {
      if (!dialog.open) return;
      const now = new Date();
      const active = listActiveCampaigns(campaigns, now);
      if (signatureOf(active, now) === shownSignature) return;
      const scrollTop = dialog.scrollTop;
      render(now, active);
      dialog.scrollTop = scrollTop;
    },
  };
}

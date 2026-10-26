import type { Product } from "../types.ts";
import { CATEGORY_NAMES } from "../logic/catalog.ts";
import {
  categoryDistribution,
  difficultyDistribution,
  newShare,
  priceDistribution,
} from "../logic/insights.ts";
import { el } from "./dom.ts";

const svgNamespace = "http://www.w3.org/2000/svg";
let nextTooltipId = 0;

type ChartShell = {
  card: HTMLElement;
  plot: HTMLElement;
  svg: SVGSVGElement;
  tooltip: HTMLElement;
};

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(svgNamespace, tag);
}

function numberText(value: number): string {
  return String(Number(value.toFixed(2)));
}

function percent(count: number, total: number): string {
  return (total === 0 ? 0 : Math.round(count / total * 100)) + "%";
}

function shell(title: string, width: number, height: number): ChartShell {
  const card = el("section", "insights-chart-card");
  card.append(el("h3", "insights-chart-title", title));
  const figure = el("figure", "insights-chart-figure");
  const plot = el("div", "insights-chart-wrap");
  const svg = svgElement("svg");
  svg.setAttribute("class", "insights-chart-svg");
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", title);
  const tooltip = el("div", "insights-chart-tooltip");
  tooltip.id = "insights-chart-tooltip-" + (++nextTooltipId);
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  plot.append(svg, tooltip);
  figure.append(plot);
  card.append(figure);
  return { card, plot, svg, tooltip };
}

function addText(
  svg: SVGSVGElement,
  text: string,
  x: number,
  y: number,
  className = "insights-chart-label",
  anchor: "start" | "middle" | "end" = "middle",
): SVGTextElement {
  const node = svgElement("text");
  node.setAttribute("x", numberText(x));
  node.setAttribute("y", numberText(y));
  node.setAttribute("text-anchor", anchor);
  node.setAttribute("class", className);
  node.textContent = text;
  svg.append(node);
  return node;
}

function addGrid(
  svg: SVGSVGElement,
  x: number,
  y: number,
  width: number,
  height: number,
  max: number,
): void {
  const ticks = Math.min(4, max);
  for (let index = 0; index <= ticks; index += 1) {
    const value = max * index / ticks;
    const lineY = y + height - height * index / ticks;
    const line = svgElement("line");
    line.setAttribute("x1", numberText(x));
    line.setAttribute("x2", numberText(x + width));
    line.setAttribute("y1", numberText(lineY));
    line.setAttribute("y2", numberText(lineY));
    line.setAttribute("class", "insights-chart-gridline");
    svg.append(line);
    addText(svg, String(Math.round(value)), x - 8, lineY + 4, "insights-chart-axis-label", "end");
  }
}

function niceMax(value: number): number {
  if (value <= 4) return Math.max(1, value);
  return Math.ceil(value / 4) * 4;
}

function tooltipLeft(plot: HTMLElement, preferred: number): number {
  const width = plot.clientWidth;
  const edge = Math.min(136, width / 2);
  return Math.max(edge, Math.min(width - edge, preferred));
}

function tooltipTop(plot: HTMLElement, preferred: number): number {
  const below = preferred + 8;
  return below + 48 > plot.clientHeight ? Math.max(0, preferred - 48) : below;
}

function roundedTopPath(x: number, y: number, width: number, height: number): string {
  if (height <= 0) return "";
  const radius = Math.min(4, width / 2, height / 2);
  const right = x + width;
  const bottom = y + height;
  return "M" + numberText(x) + " " + numberText(bottom)
    + " L" + numberText(x) + " " + numberText(y + radius)
    + " Q" + numberText(x) + " " + numberText(y) + " " + numberText(x + radius) + " " + numberText(y)
    + " L" + numberText(right - radius) + " " + numberText(y)
    + " Q" + numberText(right) + " " + numberText(y) + " " + numberText(right) + " " + numberText(y + radius)
    + " L" + numberText(right) + " " + numberText(bottom) + " Z";
}

function roundedRightPath(x: number, y: number, width: number, height: number): string {
  if (width <= 0) return "";
  const radius = Math.min(4, height / 2, width / 2);
  const right = x + width;
  const bottom = y + height;
  return "M" + numberText(x) + " " + numberText(y)
    + " L" + numberText(right - radius) + " " + numberText(y)
    + " Q" + numberText(right) + " " + numberText(y) + " " + numberText(right) + " " + numberText(y + radius)
    + " L" + numberText(right) + " " + numberText(bottom - radius)
    + " Q" + numberText(right) + " " + numberText(bottom) + " " + numberText(right - radius) + " " + numberText(bottom)
    + " L" + numberText(x) + " " + numberText(bottom) + " Z";
}

function showTooltip(shell: ChartShell, group: SVGGElement, text: string, clientX?: number, clientY?: number): void {
  shell.tooltip.textContent = text;
  shell.tooltip.hidden = false;
  if (clientX !== undefined && clientY !== undefined) {
    const bounds = shell.plot.getBoundingClientRect();
    shell.tooltip.style.left = tooltipLeft(shell.plot, clientX - bounds.left) + "px";
    shell.tooltip.style.top = tooltipTop(shell.plot, clientY - bounds.top) + "px";
    return;
  }
  const bounds = group.getBoundingClientRect();
  const plotBounds = shell.plot.getBoundingClientRect();
  shell.tooltip.style.left = tooltipLeft(shell.plot, bounds.left - plotBounds.left + bounds.width / 2) + "px";
  shell.tooltip.style.top = tooltipTop(shell.plot, bounds.top - plotBounds.top) + "px";
}

function addFocusableDatum(
  shell: ChartShell,
  group: SVGGElement,
  hitArea: SVGRectElement,
  label: string,
  tooltipText: string,
): void {
  group.setAttribute("role", "img");
  group.setAttribute("aria-label", label);
  group.setAttribute("aria-describedby", shell.tooltip.id);
  group.setAttribute("tabindex", "0");
  hitArea.setAttribute("class", "insights-chart-hit");
  hitArea.setAttribute("fill", "transparent");
  hitArea.setAttribute("pointer-events", "all");
  group.append(hitArea);
  group.addEventListener("pointerenter", (event) => showTooltip(shell, group, tooltipText, event.clientX, event.clientY));
  group.addEventListener("pointerleave", () => { shell.tooltip.hidden = true; });
  group.addEventListener("focus", () => showTooltip(shell, group, tooltipText));
  group.addEventListener("blur", () => { shell.tooltip.hidden = true; });
}

function detailsTable(title: string, headers: string[], rows: string[][]): HTMLElement {
  const details = el("details", "insights-table-details");
  details.append(el("summary", "", "表で見る"));
  const table = document.createElement("table");
  table.className = "insights-data-table";
  table.setAttribute("aria-label", title);
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const value of headers) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = value;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const values of rows) {
    const row = document.createElement("tr");
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  details.append(table);
  return details;
}

function priceChart(products: Product[]): HTMLElement {
  const result = priceDistribution(products);
  const chart = shell("価格の分布", 360, 242);
  const left = 34;
  const top = 14;
  const plotWidth = 314;
  const plotHeight = 156;
  const baseline = top + plotHeight;
  const peak = Math.max(0, ...result.bins.map((bin) => bin.count));
  const max = niceMax(peak + 1);
  addGrid(chart.svg, left, top, plotWidth, plotHeight, max);
  const bandWidth = plotWidth / result.bins.length;
  const barWidth = 26;
  for (let index = 0; index < result.bins.length; index += 1) {
    const bin = result.bins[index];
    const x = left + bandWidth * index + (bandWidth - barWidth) / 2;
    const barHeight = plotHeight * bin.count / max;
    const y = baseline - barHeight;
    const group = svgElement("g");
    const bar = svgElement("path");
    bar.setAttribute("d", roundedTopPath(x, y, barWidth, barHeight));
    bar.setAttribute("class", "insights-chart-bar-1");
    group.append(bar);
    addText(chart.svg, String(bin.count), x + barWidth / 2, Math.max(top + 12, y - 5));
    const label = bin.label.replace("円", "");
    const parts = index === 0 ? ["〜999", "円"]
      : index === 5 ? ["5,000", "円〜"]
        : [label.split("〜")[0] + "〜", label.split("〜")[1]];
    const text = svgElement("text");
    text.setAttribute("x", numberText(x + barWidth / 2));
    text.setAttribute("y", numberText(baseline + 17));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "insights-chart-label insights-chart-x-label");
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const tspan = svgElement("tspan");
      tspan.setAttribute("x", numberText(x + barWidth / 2));
      if (partIndex > 0) tspan.setAttribute("dy", "13");
      tspan.textContent = parts[partIndex];
      text.append(tspan);
    }
    chart.svg.append(text);
    const tooltip = bin.label + "：" + bin.count + "件（" + percent(bin.count, products.length) + "）";
    const hit = svgElement("rect");
    hit.setAttribute("x", numberText(left + bandWidth * index + 8));
    hit.setAttribute("y", numberText(top));
    hit.setAttribute("width", numberText(bandWidth - 16));
    hit.setAttribute("height", numberText(plotHeight + 44));
    addFocusableDatum(chart, group, hit, tooltip, tooltip);
    chart.svg.append(group);
  }
  chart.card.append(el("p", "insights-chart-note", "価格不明 " + result.unknown + "件"));
  chart.card.append(detailsTable("価格の分布", ["価格帯", "商品数", "全体に占める割合"], [
    ...result.bins.map((bin) => [bin.label, bin.count + "件", percent(bin.count, products.length)]),
    ["価格不明", result.unknown + "件", percent(result.unknown, products.length)],
  ]));
  return chart.card;
}

function categoryChart(products: Product[]): HTMLElement {
  const result = categoryDistribution(products);
  const chart = shell("カテゴリの割合", 360, 284);
  const left = 116;
  const top = 12;
  const plotWidth = 140;
  const rowHeight = 48;
  const max = niceMax(Math.max(0, ...result.map((item) => item.count)));
  for (let tick = 0; tick <= Math.min(4, max); tick += 1) {
    const value = max * tick / Math.min(4, max);
    const x = left + plotWidth * tick / Math.min(4, max);
    const line = svgElement("line");
    line.setAttribute("x1", numberText(x));
    line.setAttribute("x2", numberText(x));
    line.setAttribute("y1", numberText(top));
    line.setAttribute("y2", numberText(top + rowHeight * result.length - 10));
    line.setAttribute("class", "insights-chart-gridline");
    chart.svg.append(line);
    addText(chart.svg, String(Math.round(value)), x, 275, "insights-chart-axis-label");
  }
  for (let index = 0; index < result.length; index += 1) {
    const item = result[index];
    const y = top + index * rowHeight + 7;
    const barHeight = 20;
    const barWidth = plotWidth * item.count / max;
    addText(chart.svg, CATEGORY_NAMES[item.category], left - 12, y + 15, "insights-chart-label", "end");
    const group = svgElement("g");
    const bar = svgElement("path");
    bar.setAttribute("d", roundedRightPath(left, y, barWidth, barHeight));
    bar.setAttribute("class", "insights-chart-bar-1");
    group.append(bar);
    addText(chart.svg, item.count + "件 · " + percent(item.count, products.length), left + plotWidth + 8, y + 15, "insights-chart-label", "start");
    const tooltip = CATEGORY_NAMES[item.category] + "：" + item.count + "件（" + percent(item.count, products.length) + "）";
    const hit = svgElement("rect");
    hit.setAttribute("x", "4");
    hit.setAttribute("y", numberText(y - 5));
    hit.setAttribute("width", "352");
    hit.setAttribute("height", "34");
    addFocusableDatum(chart, group, hit, tooltip, tooltip);
    chart.svg.append(group);
  }
  chart.card.append(detailsTable("カテゴリの割合", ["カテゴリ", "商品数", "全体に占める割合"],
    result.map((item) => [CATEGORY_NAMES[item.category], item.count + "件", percent(item.count, products.length)])));
  return chart.card;
}

function difficultyChart(products: Product[]): HTMLElement {
  const result = difficultyDistribution(products);
  const chart = shell("難易度の分布", 360, 242);
  const legend = el("div", "insights-chart-legend");
  legend.setAttribute("role", "group");
  legend.setAttribute("aria-label", "難易度の情報源");
  for (const [className, label] of [["insights-legend-swatch-1", "公式"], ["insights-legend-swatch-2", "推定"]]) {
    const item = el("span", "insights-chart-legend-item");
    item.append(el("span", "insights-chart-legend-swatch " + className), el("span", "", label));
    legend.append(item);
  }
  chart.card.insertBefore(legend, chart.card.querySelector(".insights-chart-figure"));
  const left = 34;
  const top = 14;
  const plotWidth = 314;
  const plotHeight = 156;
  const baseline = top + plotHeight;
  const max = niceMax(Math.max(0, ...result.levels.map((level) => level.official + level.estimated)));
  addGrid(chart.svg, left, top, plotWidth, plotHeight, max);
  const bandWidth = plotWidth / result.levels.length;
  const barWidth = 32;
  for (let index = 0; index < result.levels.length; index += 1) {
    const item = result.levels[index];
    const x = left + bandWidth * index + (bandWidth - barWidth) / 2;
    const officialHeight = plotHeight * item.official / max;
    const estimatedHeight = plotHeight * item.estimated / max;
    const officialY = baseline - officialHeight;
    const estimatedY = officialY - (item.official > 0 && item.estimated > 0 ? 2 : 0) - estimatedHeight;
    const group = svgElement("g");
    if (item.official > 0) {
      const official = svgElement("rect");
      official.setAttribute("x", numberText(x));
      official.setAttribute("y", numberText(officialY));
      official.setAttribute("width", numberText(barWidth));
      official.setAttribute("height", numberText(officialHeight));
      official.setAttribute("class", "insights-chart-bar-1");
      group.append(official);
    }
    if (item.estimated > 0) {
      const estimated = svgElement("path");
      estimated.setAttribute("d", roundedTopPath(x, estimatedY, barWidth, estimatedHeight));
      estimated.setAttribute("class", "insights-chart-bar-2");
      group.append(estimated);
    } else if (item.official > 0) {
      const roundedOfficial = svgElement("path");
      roundedOfficial.setAttribute("d", roundedTopPath(x, officialY, barWidth, officialHeight));
      roundedOfficial.setAttribute("class", "insights-chart-bar-1");
      group.replaceChildren(roundedOfficial);
    }
    const count = item.official + item.estimated;
    addText(chart.svg, String(count), x + barWidth / 2, Math.max(top + 12, estimatedY - 5));
    addText(chart.svg, String(item.level), x + barWidth / 2, baseline + 20);
    const tooltip = "難易度 " + item.level + "：計 " + count + "件（" + percent(count, products.length)
      + "）、公式 " + item.official + "件、推定 " + item.estimated + "件";
    const hit = svgElement("rect");
    hit.setAttribute("x", numberText(left + bandWidth * index + 10));
    hit.setAttribute("y", numberText(top));
    hit.setAttribute("width", numberText(bandWidth - 20));
    hit.setAttribute("height", numberText(plotHeight + 40));
    addFocusableDatum(chart, group, hit, tooltip, tooltip);
    chart.svg.append(group);
  }
  chart.card.append(el("p", "insights-chart-note", "難易度不明 " + result.unknown + "件"));
  chart.card.append(detailsTable("難易度の分布", ["難易度", "公式", "推定", "合計", "全体に占める割合"], [
    ...result.levels.map((item) => {
      const count = item.official + item.estimated;
      return [String(item.level), item.official + "件", item.estimated + "件", count + "件", percent(count, products.length)];
    }),
    ["不明", "—", "—", result.unknown + "件", percent(result.unknown, products.length)],
  ]));
  return chart.card;
}

function newShareChart(products: Product[]): HTMLElement {
  const result = newShare(products);
  const chart = el("section", "insights-chart-card insights-new-card");
  chart.append(el("h3", "insights-chart-title", "新作"));
  chart.append(el("p", "insights-new-summary", "新作と分かっているもの " + result.isNew + "件（全体の "
    + percent(result.isNew, products.length) + "）／不明 " + result.unknown + "件"));
  chart.append(el("p", "insights-chart-note", "新作ではない商品 " + result.notNew + "件"));
  chart.append(detailsTable("新作の情報", ["情報", "商品数", "全体に占める割合"], [
    ["新作", result.isNew + "件", percent(result.isNew, products.length)],
    ["新作ではない", result.notNew + "件", percent(result.notNew, products.length)],
    ["不明", result.unknown + "件", percent(result.unknown, products.length)],
  ]));
  return chart;
}

export function insightsCharts(products: Product[]): HTMLElement {
  const section = el("section", "insights-trends");
  section.append(el("h2", "section-title", "商品の傾向"));
  const grid = el("div", "insights-chart-grid");
  grid.append(priceChart(products), categoryChart(products), difficultyChart(products), newShareChart(products));
  section.append(grid);
  return section;
}

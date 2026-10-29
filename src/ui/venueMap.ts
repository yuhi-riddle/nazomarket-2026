import type { Day, LayoutBooth, VenueLayout } from "../types.ts";

const svgNamespace = "http://www.w3.org/2000/svg";
let mapInstance = 0;

export type BoothPaintColor = "must" | "chart-1" | "chart-2";
export type BoothPaint = {
  color?: BoothPaintColor;
  intensity?: number;
  title?: string;
  ariaLabel?: string;
};

export type VenueMapUpdate = {
  day?: Day;
  paintBooth?: (booth: LayoutBooth) => BoothPaint | undefined;
};

export type VenueMapOptions = Omit<VenueMapUpdate, "day"> & {
  layout: VenueLayout;
  day: Day;
  onBoothPress?: (booth: LayoutBooth) => void;
};

export type VenueMapScale = 1 | 2 | 3 | "fit";
export type VenueMapElement = SVGSVGElement & {
  update: (next: VenueMapUpdate) => void;
  setScale: (scale: VenueMapScale) => void;
  setSelectedBooth: (code: string | null) => void;
};

type BoothNodes = {
  group: SVGGElement;
  rect: SVGRectElement;
  label: SVGTextElement;
  title?: SVGTitleElement;
  ariaLabel: string;
};

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(svgNamespace, tag);
}

function dayName(day: Day): string {
  return day === "sat" ? "土曜 11/7" : "日曜 11/8";
}

export function venueMapLabelText(
  name: string | null,
  boothCode: string,
  capacity: number,
): { text: string; isCode: boolean } {
  if (name === null || capacity < 2) return { text: boothCode, isCode: true };

  const characters = Array.from(name);
  if (characters.length <= capacity) return { text: name, isCode: false };

  const visibleCount = capacity - 1;
  if (visibleCount < 2) return { text: boothCode, isCode: true };
  return { text: characters.slice(0, visibleCount).join("") + "…", isCode: false };
}

function paintLabel(label: SVGTextElement, booth: LayoutBooth, day: Day): void {
  label.replaceChildren();
  const centerX = String(booth.x + booth.w / 2);
  label.setAttribute("x", centerX);
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  label.setAttribute("class", "venue-map-booth-label");
  const name = booth.labels[day];
  const capacity = Math.floor((booth.w - 6) / 12);
  const labelText = venueMapLabelText(name, booth.code, capacity);

  if (labelText.isCode || booth.h < 25) {
    label.setAttribute("y", String(booth.y + booth.h / 2));
    label.setAttribute("class", "venue-map-booth-code");
    label.style.fontSize = "9px";
    label.textContent = labelText.isCode ? labelText.text : booth.code;
    return;
  }

  const vendor = svgElement("tspan");
  vendor.setAttribute("x", centerX);
  vendor.setAttribute("y", String(booth.y + booth.h / 2 - (booth.w >= 45 ? 5 : 0)));
  vendor.setAttribute("class", "venue-map-vendor");
  vendor.style.fontSize = "12px";
  vendor.style.fontWeight = "700";
  vendor.style.fill = "var(--ink)";
  vendor.textContent = labelText.text;
  label.append(vendor);
  if (booth.w >= 45 && booth.h >= 30) {
    const code = svgElement("tspan");
    code.setAttribute("x", centerX);
    code.setAttribute("y", String(booth.y + booth.h / 2 + 9));
    code.setAttribute("class", "venue-map-booth-code");
    code.style.fontSize = "9px";
    code.style.fontWeight = "400";
    code.textContent = booth.code;
    label.append(code);
  }
}

export function venueMap(options: VenueMapOptions): VenueMapElement {
  const { layout } = options;
  let day = options.day;
  let paintBooth = options.paintBooth;
  const onBoothPress = options.onBoothPress;
  let selectedCode: string | null = null;
  const instanceId = ++mapInstance;
  const patternId = "venue-map-no-show-" + instanceId;

  const svg = svgElement("svg");
  svg.setAttribute("class", "venue-map-svg");
  svg.setAttribute("viewBox", [
    layout.viewBox.x,
    layout.viewBox.y,
    layout.viewBox.w,
    layout.viewBox.h,
  ].join(" "));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "会場マップ（" + dayName(day) + "）");

  const defs = svgElement("defs");
  const pattern = svgElement("pattern");
  pattern.id = patternId;
  pattern.setAttribute("width", "8");
  pattern.setAttribute("height", "8");
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  const hatch = svgElement("path");
  hatch.setAttribute("d", "M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6");
  hatch.setAttribute("class", "venue-map-hatch");
  pattern.append(hatch);
  defs.append(pattern);
  svg.append(defs);

  const background = svgElement("rect");
  background.setAttribute("x", String(layout.viewBox.x));
  background.setAttribute("y", String(layout.viewBox.y));
  background.setAttribute("width", String(layout.viewBox.w));
  background.setAttribute("height", String(layout.viewBox.h));
  background.setAttribute("class", "venue-map-background");
  svg.append(background);

  const walkway = svgElement("polygon");
  walkway.setAttribute("points", layout.walkway.map((point) => point.join(",")).join(" "));
  walkway.setAttribute("class", "venue-map-walkway");
  svg.append(walkway);

  const landmarks = svgElement("g");
  landmarks.setAttribute("class", "venue-map-landmarks");
  for (const landmark of layout.landmarks) {
    const label = landmark.kind === "sponsor"
      ? "協賛ブース"
      : landmark.kind === "delivery"
        ? "宅配ブース"
        : "トイレ";
    for (const rect of landmark.rects) {
      const group = svgElement("g");
      group.setAttribute("class", "venue-map-landmark");
      const shape = svgElement("rect");
      shape.setAttribute("x", String(rect.x));
      shape.setAttribute("y", String(rect.y));
      shape.setAttribute("width", String(rect.w));
      shape.setAttribute("height", String(rect.h));
      const text = svgElement("text");
      text.setAttribute("x", String(rect.x + rect.w / 2));
      text.setAttribute("y", String(rect.y + rect.h / 2));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute("class", rect.w < 45 ? "venue-map-landmark-label-small" : "venue-map-landmark-label");
      text.textContent = label;
      group.append(shape, text);
      landmarks.append(group);
    }
  }
  svg.append(landmarks);

  const boothNodes = new Map<string, BoothNodes>();
  for (const booth of layout.booths) {
    const group = svgElement("g");
    group.setAttribute("class", "venue-map-booth");
    group.setAttribute("data-booth-code", booth.code);
    group.setAttribute("data-area", booth.area);
    const rect = svgElement("rect");
    rect.setAttribute("x", String(booth.x));
    rect.setAttribute("y", String(booth.y));
    rect.setAttribute("width", String(booth.w));
    rect.setAttribute("height", String(booth.h));
    rect.setAttribute("class", "venue-map-booth-rect");
    const label = svgElement("text");
    paintLabel(label, booth, day);
    let title: SVGTitleElement | undefined;
    if (onBoothPress) {
      group.setAttribute("role", "button");
      group.setAttribute("tabindex", "0");
      group.addEventListener("click", () => onBoothPress(booth));
      group.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onBoothPress(booth);
      });
    } else {
      title = svgElement("title");
      group.append(title);
    }
    group.append(rect, label);
    boothNodes.set(booth.code, { group, rect, label, title, ariaLabel: "" });
    svg.append(group);
  }

  const waypoints = svgElement("g");
  waypoints.setAttribute("class", "venue-map-waypoints");
  waypoints.setAttribute("aria-hidden", "true");
  const drawWaypoint = (x: number, y: number, label: string, labelX: number) => {
    const group = svgElement("g");
    const dot = svgElement("circle");
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    dot.setAttribute("r", "4");
    dot.setAttribute("class", "venue-map-waypoint");
    const arrow = svgElement("path");
    arrow.setAttribute("d", "M" + (x + 36) + " " + y + " L" + (x + 7) + " " + y
      + " M" + (x + 7) + " " + y + " L" + (x + 16) + " " + (y - 6)
      + " M" + (x + 7) + " " + y + " L" + (x + 16) + " " + (y + 6));
    arrow.setAttribute("class", "venue-map-waypoint-arrow");
    const text = svgElement("text");
    text.setAttribute("x", String(labelX));
    text.setAttribute("y", String(y - 12));
    text.setAttribute("class", "venue-map-waypoint-label");
    text.textContent = label;
    group.append(dot, arrow, text);
    waypoints.append(group);
  };
  drawWaypoint(layout.entrance.x, layout.entrance.y, "入口", layout.entrance.x - 54);
  drawWaypoint(layout.exit.x, layout.exit.y, "出口", layout.exit.x + 12);
  svg.append(waypoints);

  const paintKeys = new Map<string, string>();
  let renderedDay: Day | undefined = day;

  const refreshBooths = () => {
    const dayChanged = renderedDay !== day;
    if (dayChanged) {
      svg.setAttribute("aria-label", "会場マップ（" + dayName(day) + "）");
      renderedDay = day;
    }
    for (const booth of layout.booths) {
      const nodes = boothNodes.get(booth.code);
      if (!nodes) continue;
      const noShow = booth.labels[day] === null;
      const paint = paintBooth?.(booth);
      const vendorName = booth.labels[day] ?? "出展なし";
      const paintKey = JSON.stringify(paint ?? null);
      if (onBoothPress) {
        nodes.ariaLabel = paint?.ariaLabel ?? (booth.code + " " + vendorName);
        nodes.group.setAttribute("aria-label", nodes.ariaLabel
          + (booth.code === selectedCode ? " 選択中" : ""));
      }
      if (!dayChanged && paintKeys.get(booth.code) === paintKey) continue;
      paintKeys.set(booth.code, paintKey);
      if (dayChanged) paintLabel(nodes.label, booth, day);
      if (nodes.title) nodes.title.textContent = paint?.title ?? vendorName;

      const isListed = paint?.color === "must";
      const color = paint?.color;
      nodes.rect.style.setProperty(
        "--venue-map-fill",
        noShow ? "url(#" + patternId + ")" : color ? "var(--" + color + (isListed ? "-soft)" : ")") : "var(--venue-map-area-fill, var(--surface))",
      );
      nodes.rect.style.setProperty("--venue-map-stroke", color ? "var(--" + color + ")" : "var(--venue-map-area-stroke, var(--line))");
      nodes.rect.style.setProperty("--venue-map-stroke-width", color ? (isListed ? "3" : "2") : "1");
      if (paint?.intensity !== undefined && !noShow) {
        const intensity = Math.max(0, Math.min(1, paint.intensity));
        nodes.rect.style.setProperty("--venue-map-fill-opacity", String(intensity));
      } else {
        nodes.rect.style.removeProperty("--venue-map-fill-opacity");
      }

    }
  };

  const setScale = (scale: VenueMapScale) => {
    svg.style.width = scale === "fit" || scale === 1 ? "100%" : scale * 100 + "%";
  };
  const setSelectedBooth = (code: string | null) => {
    selectedCode = code;
    for (const [boothCode, nodes] of boothNodes) {
      const selected = boothCode === code;
      nodes.group.toggleAttribute("data-selected", selected);
      if (onBoothPress) {
        nodes.group.setAttribute("aria-label", nodes.ariaLabel + (selected ? " 選択中" : ""));
      }
    }
  };
  const update = (next: VenueMapUpdate) => {
    let boothsChanged = false;
    if (next.day !== undefined && next.day !== day) {
      day = next.day;
      boothsChanged = true;
    }
    if (next.paintBooth !== undefined && next.paintBooth !== paintBooth) {
      paintBooth = next.paintBooth;
      boothsChanged = true;
    }
    if (boothsChanged) refreshBooths();
  };

  setScale("fit");
  refreshBooths();
  return Object.assign(svg, { update, setScale, setSelectedBooth });
}

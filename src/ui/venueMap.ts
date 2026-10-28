import type { WalkingRoute, WalkingRouteStop } from "../logic/walkingRoute.ts";
import type { Day, LayoutBooth, Point, VenueLayout } from "../types.ts";

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
  route?: WalkingRoute;
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
};

type BoothNodes = {
  group: SVGGElement;
  rect: SVGRectElement;
  label: SVGTextElement;
  title?: SVGTitleElement;
};

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(svgNamespace, tag);
}

function dayName(day: Day): string {
  return day === "sat" ? "土曜 11/7" : "日曜 11/8";
}

function shortName(name: string): string {
  const characters = Array.from(name);
  return characters.length > 7 ? characters.slice(0, 7).join("") + "…" : name;
}

function paintLabel(label: SVGTextElement, booth: LayoutBooth, day: Day): void {
  label.replaceChildren();
  label.setAttribute("x", String(booth.x + booth.w / 2));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  const name = booth.labels[day];

  if (booth.w < 45 || name === null) {
    label.setAttribute("y", String(booth.y + booth.h / 2));
    label.setAttribute("class", "venue-map-booth-code");
    label.textContent = booth.code;
    return;
  }

  label.setAttribute("class", "venue-map-booth-label");
  const code = svgElement("tspan");
  code.setAttribute("x", String(booth.x + booth.w / 2));
  code.setAttribute("y", String(booth.y + booth.h / 2 - 5));
  code.setAttribute("class", "venue-map-booth-code");
  code.textContent = booth.code;
  const vendor = svgElement("tspan");
  vendor.setAttribute("x", String(booth.x + booth.w / 2));
  vendor.setAttribute("y", String(booth.y + booth.h / 2 + 10));
  vendor.setAttribute("class", "venue-map-vendor");
  vendor.textContent = shortName(name);
  label.append(code, vendor);
}

export function venueMap(options: VenueMapOptions): VenueMapElement {
  const { layout } = options;
  let day = options.day;
  let paintBooth = options.paintBooth;
  let route: WalkingRoute = options.route ?? { stops: [], legs: [], unreachable: [] };
  const onBoothPress = options.onBoothPress;
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
    boothNodes.set(booth.code, { group, rect, label, title });
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

  const routeLayer = svgElement("g");
  routeLayer.setAttribute("class", "venue-map-route-layer");
  routeLayer.setAttribute("aria-hidden", "true");
  svg.append(routeLayer);

  const boothByCode = new Map(layout.booths.map((booth): [string, LayoutBooth] => [booth.code, booth]));
  const paintKeys = new Map<string, string>();
  let renderedDay: Day | undefined = day;
  let renderedRouteKey = "";

  const drawMarker = (stop: WalkingRouteStop, index: number) => {
    const booth = boothByCode.get(stop.code);
    if (!booth) return;
    const marker = svgElement("g");
    marker.setAttribute("class", "venue-map-route-marker");
    const circle = svgElement("circle");
    circle.setAttribute("cx", String(booth.x + booth.w - 13));
    circle.setAttribute("cy", String(booth.y + 13));
    circle.setAttribute("r", "11");
    const number = svgElement("text");
    number.setAttribute("x", String(booth.x + booth.w - 13));
    number.setAttribute("y", String(booth.y + 13));
    number.setAttribute("text-anchor", "middle");
    number.setAttribute("dominant-baseline", "middle");
    number.textContent = String(index + 1);
    marker.append(circle, number);
    routeLayer.append(marker);
  };

  const drawVisitConnector = (stop: WalkingRouteStop) => {
    const booth = boothByCode.get(stop.code);
    if (!booth) return;
    const edgePoint: Point = {
      x: Math.max(booth.x, Math.min(stop.visitPoint.x, booth.x + booth.w)),
      y: Math.max(booth.y, Math.min(stop.visitPoint.y, booth.y + booth.h)),
    };
    const line = svgElement("line");
    line.setAttribute("x1", String(stop.visitPoint.x));
    line.setAttribute("y1", String(stop.visitPoint.y));
    line.setAttribute("x2", String(edgePoint.x));
    line.setAttribute("y2", String(edgePoint.y));
    line.setAttribute("class", "venue-map-visit-connector");
    routeLayer.append(line);
  };

  const drawRoute = () => {
    const routeKey = JSON.stringify([
      route.stops.map((stop) => [stop.code, stop.visitPoint.x, stop.visitPoint.y]),
      route.legs,
    ]);
    if (routeKey === renderedRouteKey) return;
    renderedRouteKey = routeKey;
    routeLayer.replaceChildren();
    if (!route.stops.length) return;
    for (const leg of route.legs) {
      if (leg.length < 2) continue;
      const path = svgElement("polyline");
      path.setAttribute("points", leg.map((point) => point.x + "," + point.y).join(" "));
      path.setAttribute("class", "venue-map-route");
      routeLayer.append(path);
    }
    route.stops.forEach(drawVisitConnector);
    route.stops.forEach(drawMarker);
  };

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
      if (!dayChanged && paintKeys.get(booth.code) === paintKey) continue;
      paintKeys.set(booth.code, paintKey);
      if (dayChanged) paintLabel(nodes.label, booth, day);
      if (nodes.title) nodes.title.textContent = paint?.title ?? vendorName;

      const isListed = paint?.color === "must";
      const color = paint?.color;
      nodes.rect.style.setProperty(
        "--venue-map-fill",
        noShow ? "url(#" + patternId + ")" : color ? "var(--" + color + (isListed ? "-soft)" : ")") : "var(--surface)",
      );
      nodes.rect.style.setProperty("--venue-map-stroke", color ? "var(--" + color + ")" : "var(--line)");
      nodes.rect.style.setProperty("--venue-map-stroke-width", color ? (isListed ? "3" : "2") : "1");
      if (paint?.intensity !== undefined && !noShow) {
        const intensity = Math.max(0, Math.min(1, paint.intensity));
        nodes.rect.style.setProperty("--venue-map-fill-opacity", String(intensity));
      } else {
        nodes.rect.style.removeProperty("--venue-map-fill-opacity");
      }

      if (onBoothPress) {
        const name = paint?.ariaLabel ?? (booth.code + " " + vendorName);
        nodes.group.setAttribute("aria-label", name);
      }
    }
    drawRoute();
  };

  const setScale = (scale: VenueMapScale) => {
    svg.style.width = scale === "fit" || scale === 1 ? "100%" : scale * 100 + "%";
  };
  const update = (next: VenueMapUpdate) => {
    let boothsChanged = false;
    let routeChanged = false;
    if (next.day !== undefined && next.day !== day) {
      day = next.day;
      boothsChanged = true;
    }
    if (next.paintBooth !== undefined && next.paintBooth !== paintBooth) {
      paintBooth = next.paintBooth;
      boothsChanged = true;
    }
    if (next.route !== undefined) {
      route = next.route;
      routeChanged = true;
    }
    if (boothsChanged) refreshBooths();
    else if (routeChanged) drawRoute();
  };

  setScale("fit");
  if (paintBooth) refreshBooths();
  if (route.stops.length) drawRoute();
  return Object.assign(svg, { update, setScale });
}

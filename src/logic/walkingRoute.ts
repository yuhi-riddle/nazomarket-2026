import type { Point, Rect, VenueLayout } from "../types.ts";
import type { RouteStop } from "./route.ts";

const cellSize = 4;
const obstaclePadding = 4;
const narrowPassageDistance = 8;
const narrowPassageMultiplier = 3;
const maxOpeningScan = 24;
const narrowPassageDistanceThresholdSquared = (narrowPassageDistance + cellSize / 2) ** 2;
const edtInfinity = 1e12;
const diagonalCost = Math.SQRT2;
const moveColumns = new Int8Array([-1, 1, 0, 0, -1, 1, -1, 1]);
const moveRows = new Int8Array([0, 0, -1, 1, -1, -1, 1, 1]);
const moveCosts = new Float64Array([1, 1, 1, 1, diagonalCost, diagonalCost, diagonalCost, diagonalCost]);

export type WalkingRouteStop = { boothId: string; code: string; visitPoint: Point };
export type WalkingRoute = { stops: WalkingRouteStop[]; legs: Point[][]; unreachable: string[] };
export type WalkGrid = { visitPoint: (code: string) => Point | null; readonly searchCount: number };

type SearchTree = { distances: Float64Array; parents: Int32Array };
type GridState = {
  layout: VenueLayout;
  columns: number;
  rows: number;
  originX: number;
  originY: number;
  walkable: Uint8Array;
  obstacleDistanceSquared: Float32Array;
  costMultipliers: Uint8Array;
  neighbors: Int32Array;
  entranceIndex: number;
  exitIndex: number;
  trees: Map<number, SearchTree>;
  visitIndices: Map<string, number | null>;
  heapNodes: Int32Array;
  heapPositions: Int32Array;
  searchCount: number;
};
type LocatedStop = { stop: RouteStop; index: number; visitPoint: Point };

const states = new WeakMap<WalkGrid, GridState>();
const sharedGrids = new WeakMap<VenueLayout, WalkGrid>();
const naturalCodeOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function pointInPolygon(point: Point, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = (yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function clampIndex(value: number, max: number): number {
  return Math.max(0, Math.min(max - 1, value));
}

function cellPoint(state: GridState, index: number): Point {
  const column = index % state.columns;
  const row = Math.floor(index / state.columns);
  return {
    x: state.originX + (column + 0.5) * cellSize,
    y: state.originY + (row + 0.5) * cellSize,
  };
}

function nearestWalkableIndex(state: GridState, point: Point): number {
  let nearest = -1;
  let nearestDistance = Infinity;
  let nearestX = -Infinity;
  let nearestY = Infinity;
  for (let index = 0; index < state.walkable.length; index += 1) {
    if (!state.walkable[index]) continue;
    const candidate = cellPoint(state, index);
    const dx = candidate.x - point.x;
    const dy = candidate.y - point.y;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance
      || (distance === nearestDistance && (candidate.y < nearestY
        || (candidate.y === nearestY && candidate.x > nearestX)))) {
      nearest = index;
      nearestDistance = distance;
      nearestX = candidate.x;
      nearestY = candidate.y;
    }
  }
  return nearest;
}

function distanceTransform1D(
  input: Float64Array,
  output: Float64Array,
  length: number,
  sites: Int32Array,
  boundaries: Float64Array,
): void {
  let lastSite = -1;
  for (let position = 0; position < length; position += 1) {
    const value = input[position];
    if (value >= edtInfinity) continue;
    if (lastSite < 0) {
      lastSite = 0;
      sites[0] = position;
      boundaries[0] = -Infinity;
      boundaries[1] = Infinity;
      continue;
    }

    let intersection = 0;
    while (true) {
      const previous = sites[lastSite];
      intersection = ((value + position * position) - (input[previous] + previous * previous))
        / (2 * (position - previous));
      if (intersection > boundaries[lastSite] || lastSite === 0) break;
      lastSite -= 1;
    }
    if (intersection <= boundaries[lastSite] && lastSite === 0) {
      sites[0] = position;
      boundaries[0] = -Infinity;
      boundaries[1] = Infinity;
    } else {
      lastSite += 1;
      sites[lastSite] = position;
      boundaries[lastSite] = intersection;
      boundaries[lastSite + 1] = Infinity;
    }
  }

  if (lastSite < 0) {
    output.fill(edtInfinity, 0, length);
    return;
  }
  let envelope = 0;
  for (let position = 0; position < length; position += 1) {
    while (boundaries[envelope + 1] < position) envelope += 1;
    const delta = position - sites[envelope];
    output[position] = delta * delta + input[sites[envelope]];
  }
}

function calculateObstacleDistances(state: GridState): void {
  const { columns, rows, walkable } = state;
  const count = walkable.length;
  const verticalDistances = new Float64Array(count);
  const input = new Float64Array(Math.max(columns, rows));
  const output = new Float64Array(input.length);
  const sites = new Int32Array(input.length);
  const boundaries = new Float64Array(input.length + 1);

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) input[row] = walkable[row * columns + column] ? edtInfinity : 0;
    distanceTransform1D(input, output, rows, sites, boundaries);
    for (let row = 0; row < rows; row += 1) verticalDistances[row * columns + column] = output[row];
  }
  for (let row = 0; row < rows; row += 1) {
    const rowOffset = row * columns;
    for (let column = 0; column < columns; column += 1) input[column] = verticalDistances[rowOffset + column];
    distanceTransform1D(input, output, columns, sites, boundaries);
    for (let column = 0; column < columns; column += 1) {
      const index = rowOffset + column;
      const distanceSquared = output[column] * cellSize * cellSize;
      state.obstacleDistanceSquared[index] = distanceSquared;
      if (walkable[index] && distanceSquared < narrowPassageDistanceThresholdSquared) {
        state.costMultipliers[index] = narrowPassageMultiplier;
      }
    }
  }
}

// 辺の中点から外へ進み、最初の歩けるマス（立ち寄り点の候補）と、その先の通路の広さを返す。
// 広さはブースのすぐ隣では測れない（膨らませた障害物に接していてどの辺も 0 に近い）ので、
// 歩けるマスが続く間の障害物までの距離の最大値で測る
function openingOnRay(state: GridState, rect: Rect, dx: number, dy: number): { index: number; widthSquared: number } {
  const midpoint = dx !== 0
    ? { x: dx < 0 ? rect.x : rect.x + rect.w, y: rect.y + rect.h / 2 }
    : { x: rect.x + rect.w / 2, y: dy < 0 ? rect.y : rect.y + rect.h };
  let first = -1;
  let widthSquared = -1;
  for (let distance = 0; distance <= 24 + maxOpeningScan; distance += 1) {
    const column = Math.floor((midpoint.x + dx * distance - state.originX) / cellSize);
    const row = Math.floor((midpoint.y + dy * distance - state.originY) / cellSize);
    if (column < 0 || column >= state.columns || row < 0 || row >= state.rows) {
      if (first >= 0) break;
      continue;
    }
    const index = row * state.columns + column;
    if (!state.walkable[index]) {
      if (first >= 0) break;
      continue;
    }
    if (first < 0) {
      if (distance > 24) break;
      first = index;
    }
    widthSquared = Math.max(widthSquared, state.obstacleDistanceSquared[index]);
  }
  return { index: first, widthSquared };
}

function chooseVisitIndex(state: GridState, rect: Rect, entranceTree: SearchTree): number {
  let nearest = -1;
  let widestDistanceSquared = -1;
  let nearestEntranceDistance = Infinity;
  const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  for (const [dx, dy] of sides) {
    const { index: candidate, widthSquared: clearance } = openingOnRay(state, rect, dx, dy);
    if (candidate < 0) continue;
    const entranceDistance = entranceTree.distances[candidate];
    if (clearance > widestDistanceSquared
      || (clearance === widestDistanceSquared && entranceDistance < nearestEntranceDistance)) {
      nearest = candidate;
      widestDistanceSquared = clearance;
      nearestEntranceDistance = entranceDistance;
    }
  }
  return nearest;
}

function ensureSearch(state: GridState, start: number): SearchTree {
  const cached = state.trees.get(start);
  if (cached) return cached;

  const distances = new Float64Array(state.walkable.length);
  distances.fill(Infinity);
  const parents = new Int32Array(state.walkable.length);
  parents.fill(-1);
  const positions = state.heapPositions;
  const nodes = state.heapNodes;
  positions.fill(-1);
  let heapSize = 1;
  distances[start] = 0;
  nodes[0] = start;
  positions[start] = 0;

  const siftUp = (initial: number): void => {
    let index = initial;
    const node = nodes[index];
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (distances[nodes[parent]] <= distances[node]) break;
      const parentNode = nodes[parent];
      nodes[index] = parentNode;
      positions[parentNode] = index;
      index = parent;
    }
    nodes[index] = node;
    positions[node] = index;
  };

  const siftDown = (initial: number): void => {
    let index = initial;
    const node = nodes[index];
    while (true) {
      const left = index * 2 + 1;
      if (left >= heapSize) break;
      const right = left + 1;
      const smaller = right < heapSize && distances[nodes[right]] < distances[nodes[left]] ? right : left;
      if (distances[node] <= distances[nodes[smaller]]) break;
      const smallerNode = nodes[smaller];
      nodes[index] = smallerNode;
      positions[smallerNode] = index;
      index = smaller;
    }
    nodes[index] = node;
    positions[node] = index;
  };

  while (heapSize > 0) {
    const current = nodes[0];
    const last = nodes[heapSize - 1];
    heapSize -= 1;
    positions[current] = -2;
    if (heapSize > 0) {
      nodes[0] = last;
      positions[last] = 0;
      siftDown(0);
    }

    const neighborOffset = current * moveColumns.length;
    for (let moveIndex = 0; moveIndex < moveColumns.length; moveIndex += 1) {
      const next = state.neighbors[neighborOffset + moveIndex];
      if (next < 0 || positions[next] === -2) continue;

      const edgeMultiplier = (state.costMultipliers[current] + state.costMultipliers[next]) / 2;
      const candidate = distances[current] + moveCosts[moveIndex] * edgeMultiplier;
      if (candidate >= distances[next]) continue;
      distances[next] = candidate;
      parents[next] = current;
      if (positions[next] === -1) {
        const position = heapSize;
        nodes[position] = next;
        positions[next] = position;
        heapSize += 1;
      }
      siftUp(positions[next]);
    }
  }

  const tree = { distances, parents };
  state.trees.set(start, tree);
  state.searchCount += 1;
  return tree;
}

function makeGrid(layout: VenueLayout): GridState {
  const columns = Math.ceil(layout.viewBox.w / cellSize);
  const rows = Math.ceil(layout.viewBox.h / cellSize);
  const count = columns * rows;
  const state: GridState = {
    layout,
    columns,
    rows,
    originX: layout.viewBox.x,
    originY: layout.viewBox.y,
    walkable: new Uint8Array(count),
    obstacleDistanceSquared: new Float32Array(count),
    costMultipliers: new Uint8Array(count).fill(1),
    neighbors: new Int32Array(count * moveColumns.length).fill(-1),
    entranceIndex: -1,
    exitIndex: -1,
    trees: new Map(),
    visitIndices: new Map(),
    heapNodes: new Int32Array(count),
    heapPositions: new Int32Array(count),
    searchCount: 0,
  };

  for (let index = 0; index < count; index += 1) {
    if (pointInPolygon(cellPoint(state, index), layout.walkway)) state.walkable[index] = 1;
  }

  const obstacles = [
    ...layout.booths,
    ...layout.landmarks.flatMap((landmark) => landmark.rects),
  ];
  for (const rect of obstacles) {
    const left = rect.x - obstaclePadding;
    const right = rect.x + rect.w + obstaclePadding;
    const top = rect.y - obstaclePadding;
    const bottom = rect.y + rect.h + obstaclePadding;
    const minColumn = clampIndex(Math.ceil((left - state.originX) / cellSize - 0.5), columns);
    const maxColumn = clampIndex(Math.floor((right - state.originX) / cellSize - 0.5), columns);
    const minRow = clampIndex(Math.ceil((top - state.originY) / cellSize - 0.5), rows);
    const maxRow = clampIndex(Math.floor((bottom - state.originY) / cellSize - 0.5), rows);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const x = state.originX + (column + 0.5) * cellSize;
        const y = state.originY + (row + 0.5) * cellSize;
        if (x >= left && x <= right && y >= top && y <= bottom) {
          state.walkable[row * columns + column] = 0;
        }
      }
    }
  }

  calculateObstacleDistances(state);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const current = row * columns + column;
      if (!state.walkable[current]) continue;
      for (let moveIndex = 0; moveIndex < moveColumns.length; moveIndex += 1) {
        const dx = moveColumns[moveIndex];
        const dy = moveRows[moveIndex];
        const nextColumn = column + dx;
        const nextRow = row + dy;
        if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
        const next = nextRow * columns + nextColumn;
        if (!state.walkable[next]) continue;
        if (dx !== 0 && dy !== 0
          && (!state.walkable[row * columns + nextColumn] || !state.walkable[nextRow * columns + column])) continue;
        state.neighbors[current * moveColumns.length + moveIndex] = next;
      }
    }
  }

  state.entranceIndex = nearestWalkableIndex(state, layout.entrance);
  state.exitIndex = nearestWalkableIndex(state, layout.exit);
  if (state.entranceIndex >= 0) ensureSearch(state, state.entranceIndex);
  return state;
}

export function createWalkGrid(layout: VenueLayout): WalkGrid {
  const state = makeGrid(layout);
  const grid: WalkGrid = {
    visitPoint(code: string): Point | null {
      if (state.visitIndices.has(code)) {
        const index = state.visitIndices.get(code)!;
        return index === null ? null : cellPoint(state, index);
      }
      const booth = layout.booths.find((candidate) => candidate.code === code);
      if (!booth || state.entranceIndex < 0) {
        state.visitIndices.set(code, null);
        return null;
      }
      const entranceTree = state.trees.get(state.entranceIndex)!;
      const index = chooseVisitIndex(state, booth, entranceTree);
      if (index < 0 || !Number.isFinite(entranceTree.distances[index])) {
        state.visitIndices.set(code, null);
        return null;
      }
      state.visitIndices.set(code, index);
      return cellPoint(state, index);
    },
    get searchCount() {
      return state.searchCount;
    },
  };
  states.set(grid, state);
  return grid;
}

export function getWalkGrid(layout: VenueLayout): WalkGrid {
  const cached = sharedGrids.get(layout);
  if (cached) return cached;
  const grid = createWalkGrid(layout);
  sharedGrids.set(layout, grid);
  return grid;
}

function hasLineOfSight(state: GridState, from: number, to: number): boolean {
  let column = from % state.columns;
  let row = Math.floor(from / state.columns);
  const endColumn = to % state.columns;
  const endRow = Math.floor(to / state.columns);
  const deltaColumn = endColumn - column;
  const deltaRow = endRow - row;
  const stepColumn = Math.sign(deltaColumn);
  const stepRow = Math.sign(deltaRow);
  const deltaTColumn = deltaColumn === 0 ? Infinity : 1 / Math.abs(deltaColumn);
  const deltaTRow = deltaRow === 0 ? Infinity : 1 / Math.abs(deltaRow);
  let tColumn = deltaColumn === 0 ? Infinity : deltaTColumn / 2;
  let tRow = deltaRow === 0 ? Infinity : deltaTRow / 2;

  while (column !== endColumn || row !== endRow) {
    if (Math.abs(tColumn - tRow) < 1e-12) {
      const horizontal = row * state.columns + column + stepColumn;
      const vertical = (row + stepRow) * state.columns + column;
      if (!state.walkable[horizontal] || !state.walkable[vertical]
        || (horizontal !== from && horizontal !== to && state.costMultipliers[horizontal] > 1)
        || (vertical !== from && vertical !== to && state.costMultipliers[vertical] > 1)) return false;
      column += stepColumn;
      row += stepRow;
      tColumn += deltaTColumn;
      tRow += deltaTRow;
    } else if (tColumn < tRow) {
      column += stepColumn;
      tColumn += deltaTColumn;
    } else {
      row += stepRow;
      tRow += deltaTRow;
    }
    const index = row * state.columns + column;
    if (!state.walkable[index] || (index !== from && index !== to && state.costMultipliers[index] > 1)) return false;
  }
  const fromPoint = cellPoint(state, from);
  const toPoint = cellPoint(state, to);
  const segmentX = toPoint.x - fromPoint.x;
  const segmentY = toPoint.y - fromPoint.y;
  const intersections = [0, 1];
  for (let index = 0; index < state.layout.walkway.length; index += 1) {
    const [edgeStartX, edgeStartY] = state.layout.walkway[index];
    const [edgeEndX, edgeEndY] = state.layout.walkway[(index + 1) % state.layout.walkway.length];
    const edgeX = edgeEndX - edgeStartX;
    const edgeY = edgeEndY - edgeStartY;
    const denominator = segmentX * edgeY - segmentY * edgeX;
    if (Math.abs(denominator) < 1e-12) continue;
    const offsetX = edgeStartX - fromPoint.x;
    const offsetY = edgeStartY - fromPoint.y;
    const alongRoute = (offsetX * edgeY - offsetY * edgeX) / denominator;
    const alongEdge = (offsetX * segmentY - offsetY * segmentX) / denominator;
    if (alongRoute > 0 && alongRoute < 1 && alongEdge >= 0 && alongEdge <= 1) intersections.push(alongRoute);
  }
  intersections.sort((a, b) => a - b);
  for (let index = 0; index < intersections.length - 1; index += 1) {
    const middle = (intersections[index] + intersections[index + 1]) / 2;
    if (middle <= intersections[index] || middle >= intersections[index + 1]) continue;
    if (!pointInPolygon({
      x: fromPoint.x + segmentX * middle,
      y: fromPoint.y + segmentY * middle,
    }, state.layout.walkway)) return false;
  }
  return true;
}

function simplifyPath(state: GridState, indices: number[]): Point[] {
  if (indices.length < 3) return indices.map((index) => cellPoint(state, index));
  const result: Point[] = [cellPoint(state, indices[0])];
  let anchor = 0;
  while (anchor < indices.length - 1) {
    let next = indices.length - 1;
    while (next > anchor + 1 && !hasLineOfSight(state, indices[anchor], indices[next])) next -= 1;
    result.push(cellPoint(state, indices[next]));
    anchor = next;
  }
  return result;
}

function pathBetween(state: GridState, from: number, to: number): Point[] {
  const tree = ensureSearch(state, from);
  if (!Number.isFinite(tree.distances[to])) return [];
  const reversed: number[] = [to];
  let current = to;
  while (current !== from) {
    current = tree.parents[current];
    if (current < 0) return [];
    reversed.push(current);
  }
  reversed.reverse();
  return simplifyPath(state, reversed);
}

function routeDistance(state: GridState, from: number, to: number): number {
  return ensureSearch(state, from).distances[to];
}

function nearestNeighbor(state: GridState, remainingStops: LocatedStop[], start: number): LocatedStop[] {
  const remaining = [...remainingStops];
  const result: LocatedStop[] = [];
  let current = start;
  while (remaining.length > 0) {
    let nearestIndex = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const nearest = remaining[nearestIndex];
      const candidateDistance = routeDistance(state, current, candidate.index);
      const nearestDistance = routeDistance(state, current, nearest.index);
      if (candidateDistance < nearestDistance || (candidateDistance === nearestDistance
        && naturalCodeOrder.compare(candidate.stop.code, nearest.stop.code) < 0)) nearestIndex = index;
    }
    const [next] = remaining.splice(nearestIndex, 1);
    result.push(next);
    current = next.index;
  }
  return result;
}

function optimizeTwoOpt(
  state: GridState,
  ordered: LocatedStop[],
  start: number,
  end: number | null,
): boolean {
  let improved = true;
  let changed = false;
  while (improved && ordered.length > 1) {
    improved = false;
    for (let first = 0; first < ordered.length - 1 && !improved; first += 1) {
      for (let last = first + 1; last < ordered.length; last += 1) {
        const previous = first === 0 ? start : ordered[first - 1].index;
        const next = last === ordered.length - 1 ? end : ordered[last + 1].index;
        const oldCost = routeDistance(state, previous, ordered[first].index)
          + (next === null ? 0 : routeDistance(state, ordered[last].index, next));
        const newCost = routeDistance(state, previous, ordered[last].index)
          + (next === null ? 0 : routeDistance(state, ordered[first].index, next));
        if (newCost + 1e-9 >= oldCost) continue;
        for (let left = first, right = last; left < right; left += 1, right -= 1) {
          [ordered[left], ordered[right]] = [ordered[right], ordered[left]];
        }
        improved = true;
        changed = true;
        break;
      }
    }
  }
  return changed;
}

export function planWalkingRoute(
  grid: WalkGrid,
  stops: RouteStop[],
  options: { frontLoadSpecial: boolean },
): WalkingRoute {
  if (stops.length === 0) return { stops: [], legs: [], unreachable: [] };
  const state = states.get(grid);
  if (!state) throw new Error("WalkGrid must be created by createWalkGrid");

  const located: LocatedStop[] = [];
  const unreachable: string[] = [];
  for (const stop of stops) {
    const visitPoint = grid.visitPoint(stop.code);
    if (!visitPoint) {
      unreachable.push(stop.boothId);
      continue;
    }
    const index = state.visitIndices.get(stop.code);
    if (index === undefined || index === null) {
      unreachable.push(stop.boothId);
      continue;
    }
    ensureSearch(state, index);
    located.push({ stop, index, visitPoint });
  }
  if (located.length === 0 || state.entranceIndex < 0) {
    return { stops: [], legs: [], unreachable };
  }

  const exitTree = state.exitIndex >= 0 ? ensureSearch(state, state.exitIndex) : undefined;
  const exitReachable = exitTree !== undefined && Number.isFinite(exitTree.distances[state.entranceIndex]);
  const endIndex = exitReachable ? state.exitIndex : null;
  let ordered: LocatedStop[];

  if (!options.frontLoadSpecial) {
    ordered = nearestNeighbor(state, located, state.entranceIndex);
    optimizeTwoOpt(state, ordered, state.entranceIndex, endIndex);
  } else {
    const special = nearestNeighbor(state, located.filter(({ stop }) => stop.special), state.entranceIndex);
    const regular = nearestNeighbor(state, located.filter(({ stop }) => !stop.special), special.at(-1)?.index ?? state.entranceIndex);
    let changed = true;
    while (changed) {
      changed = false;
      const specialEnd = regular[0]?.index ?? endIndex;
      if (optimizeTwoOpt(state, special, state.entranceIndex, specialEnd)) changed = true;
      if (optimizeTwoOpt(state, regular, special.at(-1)?.index ?? state.entranceIndex, endIndex)) changed = true;
    }
    ordered = [...special, ...regular];
  }

  const routeStops = ordered.map(({ stop, visitPoint }) => ({
    boothId: stop.boothId,
    code: stop.code,
    visitPoint,
  }));
  const routeIndices = [state.entranceIndex, ...ordered.map(({ index }) => index)];
  if (endIndex !== null) routeIndices.push(endIndex);
  const legs: Point[][] = [];
  for (let index = 0; index < routeIndices.length - 1; index += 1) {
    legs.push(pathBetween(state, routeIndices[index], routeIndices[index + 1]));
  }
  return { stops: routeStops, legs, unreachable };
}

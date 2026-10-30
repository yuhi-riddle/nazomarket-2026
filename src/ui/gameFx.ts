type GameFxElements = {
  overlay: HTMLDivElement;
  stamp: HTMLDivElement;
  itemName: HTMLSpanElement;
  gain: HTMLSpanElement;
  live: HTMLSpanElement;
};

let elements: GameFxElements | undefined;
let getTimer: number | undefined;
let gainTimer: number | undefined;

const sparkVectors = [
  ["130px", "0px"], ["92px", "64px"], ["0px", "90px"], ["-92px", "64px"],
  ["-130px", "0px"], ["-92px", "-64px"], ["0px", "-90px"], ["92px", "-64px"],
];
const sparkColors = ["var(--key)", "var(--cyan)", "var(--get)", "var(--rank-4)"];

function ensureElements(): GameFxElements {
  if (elements) return elements;

  const overlay = document.createElement("div");
  overlay.className = "game-fx-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");

  const sparks = document.createElement("span");
  sparks.className = "game-fx-sparks";
  for (const [index, [x, y]] of sparkVectors.entries()) {
    const spark = document.createElement("span");
    spark.className = "game-fx-spark";
    spark.style.setProperty("--spark-x", x);
    spark.style.setProperty("--spark-y", y);
    spark.style.setProperty("--spark-color", sparkColors[index % sparkColors.length]);
    sparks.append(spark);
  }

  const stamp = document.createElement("div");
  stamp.className = "game-fx-stamp";
  const word = document.createElement("strong");
  word.className = "game-fx-word";
  word.textContent = "GET!";
  const itemName = document.createElement("span");
  itemName.className = "game-fx-item-name";
  stamp.append(word, itemName);
  overlay.append(sparks, stamp);

  const gain = document.createElement("span");
  gain.className = "game-fx-gain";
  gain.hidden = true;
  gain.setAttribute("aria-hidden", "true");

  const live = document.createElement("span");
  live.className = "sr-only game-fx-live";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");

  document.body.append(overlay, gain, live);
  const created: GameFxElements = { overlay, stamp, itemName, gain, live };
  elements = created;
  return created;
}

export function installGameFx(): void {
  ensureElements();
}

export function celebrateGet(itemName: string): void {
  const fx = ensureElements();
  if (getTimer !== undefined) window.clearTimeout(getTimer);

  fx.itemName.textContent = itemName;
  fx.live.textContent = itemName + "を購入済みにしました";
  fx.overlay.hidden = false;
  fx.overlay.classList.remove("is-playing");
  void fx.overlay.offsetWidth;
  fx.overlay.classList.add("is-playing");
  getTimer = window.setTimeout(() => {
    fx.overlay.hidden = true;
    fx.overlay.classList.remove("is-playing");
    getTimer = undefined;
  }, 1300);
}

export function floatGain(text: string): void {
  const fx = ensureElements();
  if (gainTimer !== undefined) window.clearTimeout(gainTimer);

  fx.gain.textContent = text;
  fx.gain.hidden = false;
  fx.gain.classList.remove("is-playing");
  void fx.gain.offsetWidth;
  fx.gain.classList.add("is-playing");
  gainTimer = window.setTimeout(() => {
    fx.gain.hidden = true;
    fx.gain.classList.remove("is-playing");
    gainTimer = undefined;
  }, 900);
}

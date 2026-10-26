export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(text: string, className = "button", type: HTMLButtonElement["type"] = "button"): HTMLButtonElement {
  const node = el("button", className, text);
  node.type = type;
  return node;
}

export function labeledControl(labelText: string, control: HTMLElement): HTMLLabelElement {
  const label = el("label", "field");
  label.append(el("span", "field-label", labelText), control);
  return label;
}

export function safeExternalLink(url: string, text: string, className = ""): HTMLAnchorElement | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const link = el("a", className, text);
    link.href = parsed.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  } catch {
    return null;
  }
}

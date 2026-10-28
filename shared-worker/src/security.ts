export function isAllowedOrigin(origin: string | null, configuredOrigins: string): boolean {
  if (origin === null) return true;
  if (origin === "null") return false;
  const allowlist = configuredOrigins.split(",").map((entry) => entry.trim()).filter(Boolean);
  return allowlist.includes(origin);
}

export function createCorsHeaders(origin: string | null, configuredOrigins: string, preflight = false): Headers | null {
  if (!isAllowedOrigin(origin, configuredOrigins)) return null;

  const headers = new Headers({
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
  if (origin !== null) headers.set("Access-Control-Allow-Origin", origin);
  if (preflight) {
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

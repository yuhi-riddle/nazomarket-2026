import { describe, expect, it } from "vitest";
import { downloadImages, planImageDownloads } from "./remoteImages.ts";

const product = (id: string, imageUrl: string | null) => ({ id, imageUrl });

describe("planImageDownloads", () => {
  it("X（pbs.twimg.com）の画像だけを、商品 id のファイル名で取る", () => {
    expect(planImageDownloads([
      product("p01", "https://www.scrapmagazine.com/a.png"),
      product("no10-1", null),
      product("no55-1", "https://pbs.twimg.com/media/HVyURoibUAAV3oN?format=jpg&name=small"),
    ])).toEqual([
      { id: "no55-1", url: "https://pbs.twimg.com/media/HVyURoibUAAV3oN?format=jpg&name=small", file: "no55-1.jpg" },
    ]);
  });

  it("ファイル名に使えない id や https 以外の URL は取らない", () => {
    expect(planImageDownloads([
      product("../evil", "https://pbs.twimg.com/media/A?format=jpg"),
      product("no1-1", "http://pbs.twimg.com/media/A?format=jpg"),
      product("no1-2", "https://pbs.twimg.com.evil.example/media/A"),
    ])).toEqual([]);
  });
});

type FakeResponse = { ok: boolean; status: number; headers: { get: (name: string) => string | null }; arrayBuffer: () => Promise<ArrayBuffer> };

function response(status: number, type: string | null, size: number): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? type : null) },
    arrayBuffer: async () => new ArrayBuffer(size),
  };
}

function harness(responses: Record<string, FakeResponse | Error>) {
  const written: Record<string, number> = {};
  const requested: string[] = [];
  const sleeps: number[] = [];
  const warnings: string[] = [];
  const deps = {
    fetch: async (url: string, init?: { headers?: Record<string, string> }) => {
      requested.push(url);
      expect(init?.headers?.Referer ?? init?.headers?.referer).toBeUndefined();
      const r = responses[url];
      if (r instanceof Error) throw r;
      return r;
    },
    writeFile: async (file: string, data: Uint8Array) => { written[file] = data.byteLength; },
    sleep: async (ms: number) => { sleeps.push(ms); },
    warn: (message: string) => { warnings.push(message); },
  };
  return { deps, written, requested, sleeps, warnings };
}

describe("downloadImages", () => {
  const plan = [
    { id: "a", url: "https://pbs.twimg.com/media/A", file: "a.jpg" },
    { id: "b", url: "https://pbs.twimg.com/media/B", file: "b.jpg" },
    { id: "c", url: "https://pbs.twimg.com/media/C", file: "c.jpg" },
  ];

  it("順に取り、リクエストの間を1秒あけて保存する", async () => {
    const h = harness({
      [plan[0].url]: response(200, "image/jpeg", 10),
      [plan[1].url]: response(200, "image/png", 20),
      [plan[2].url]: response(200, "image/jpeg", 30),
    });
    const result = await downloadImages(plan, "out", h.deps);
    expect(h.requested).toEqual(plan.map((p) => p.url));
    expect(h.sleeps).toEqual([1000, 1000]);
    expect(Object.keys(h.written).map((f) => f.replaceAll("\\", "/"))).toEqual(["out/a.jpg", "out/b.jpg", "out/c.jpg"]);
    expect(result).toEqual({ saved: ["a", "b", "c"], failed: [] });
  });

  it("失敗・画像以外・5MB 超は保存せず、警告して残りを続ける", async () => {
    const h = harness({
      [plan[0].url]: response(403, "text/html", 10),
      [plan[1].url]: response(200, "text/html", 10),
      [plan[2].url]: response(200, "image/jpeg", 5 * 1024 * 1024 + 1),
    });
    const result = await downloadImages(plan, "out", h.deps);
    expect(h.written).toEqual({});
    expect(result).toEqual({ saved: [], failed: ["a", "b", "c"] });
    expect(h.warnings).toHaveLength(3);
  });

  it("通信エラーでも止まらない", async () => {
    const h = harness({
      [plan[0].url]: new Error("network down"),
      [plan[1].url]: response(200, "image/jpeg", 10),
      [plan[2].url]: response(200, "image/jpeg", 10),
    });
    const result = await downloadImages(plan, "out", h.deps);
    expect(result).toEqual({ saved: ["b", "c"], failed: ["a"] });
  });
});

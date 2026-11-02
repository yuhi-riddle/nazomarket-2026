# 収集の抜けを逆向きに洗い出し、data/RECHECK.md に書く。
# 先に node work/gap-review/fetch_timelines.mjs で投稿を取り直しておく。
# 読んで判断した投稿は data/reviewed-posts.json に載せる。--mark-reviewed で今の未確認を確認済みにする。
import collections, datetime, glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace("\\", "/") + "/"
REVIEWED = ROOT + "data/reviewed-posts.json"
ANNOUNCE = re.compile(r"ナゾマ|ナゾトキマーケット|謎解きマーケット|ナゾマケ|お品書き|おしながき")
PRICE = re.compile(r"[\d,，]+円|[¥￥]\s*[\d,，]+")
CAMPAIGN = re.compile(r"キャンペーン|プレゼント|抽選|特典|割引|円引|[%％]\s*(?:OFF|off|オフ)|セール|お得")

booths = json.load(open(ROOT + "data/booths.json", encoding="utf-8"))
products = json.load(open(ROOT + "data/products.json", encoding="utf-8"))
reviewed = set(json.load(open(REVIEWED, encoding="utf-8"))) if os.path.exists(REVIEWED) else set()
count = collections.Counter(p["boothId"] for p in products)
names = collections.defaultdict(list)
for p in products:
    names[p["boothId"]].append(re.sub(r"\s", "", p["name"]))
campaigns = json.load(open(ROOT + "data/campaigns.json", encoding="utf-8"))
used_posts = {s["url"].split("/status/")[-1].split("?")[0] for row in products + campaigns for s in row["sources"] if "/status/" in s["url"]}

problems, unlinked = [], []
for b in booths:
    path = f"{ROOT}work/gap-review/x/{b['id']}.json"
    data = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {"posts": [], "handles": [], "failed": []}
    latest = collections.defaultdict(str)
    for post in data["posts"]:
        key = post["handle"].lower()
        latest[key] = max(latest[key], post["at"] or "")
    handles = dict.fromkeys(data.get("handles", []))
    if not handles and b["links"]["x"]:
        problems.append((b, "（取得対象なし）", "Xリンクがあるのに取得していない"))
    for h in handles:
        if any(f.lower().startswith(h.lower() + " ") for f in data.get("failed", [])):
            problems.append((b, h, "取得失敗: " + next(f for f in data["failed"] if f.lower().startswith(h.lower() + " "))))
        elif not latest[h.lower()]:
            problems.append((b, h, "投稿0件"))
    seen = set()
    for post in data["posts"]:
        if post["id"] in seen or post["id"] in reviewed or post["id"] in used_posts:
            continue
        seen.add(post["id"])
        if not ANNOUNCE.search(post["text"]) or (post["at"] or "") < "2026-09":
            continue
        body = re.sub(r"\s", "", post["text"])
        if any(n[:6] in body for n in names[b["id"]]) and not CAMPAIGN.search(post["text"]):
            continue
        if post["photos"] or PRICE.search(post["text"]) or CAMPAIGN.search(post["text"]):
            unlinked.append((b, post))

if "--mark-reviewed" in sys.argv:
    with open(REVIEWED, "w", encoding="utf-8", newline="\n") as f:
        json.dump(sorted(reviewed | {p["id"] for _, p in unlinked}), f, indent=0)
        f.write("\n")
    print("確認済みに追加", len(unlinked))
    sys.exit()

lines = ["# 収集の再確認", "", f"生成日: {datetime.date.today()}", ""]
lines += [f"## 取得に問題のあるアカウント（{len(problems)}件）", ""]
lines += [f"- {b['id']} {b['name']}: {h} — {why}" for b, h, why in problems] or ["なし"]
lines += ["", f"## 商品に結び付いていない未確認の投稿（{len(unlinked)}件）", "", "ナゾマに触れて価格か画像があるのに、出典にも商品名にも結び付かない投稿。読んで商品にするか、確認済みにする。", ""]
lines += [f"- {b['id']} {b['name']}（商品{count[b['id']]}件）: https://x.com/{p['handle']}/status/{p['id']} {p['at'][:10]} {re.sub(r'\s+', ' ', p['text'])[:120]}" for b, p in unlinked] or ["なし"]
with open(ROOT + "data/RECHECK.md", "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(lines) + "\n")
print("問題アカウント", len(problems), "未確認投稿", len(unlinked))

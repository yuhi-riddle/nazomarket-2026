# 商品画像の外周にある無地の余白を測り、data/imageCrops.json に書き出す。
# 商品や画像を更新したあとに実行する: python scripts/measure_image_margins.py（Pillow が必要）
import io
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageChops, ImageOps

ROOT = Path(__file__).resolve().parent.parent
MIN_MARGIN = 0.02    # これより細い余白は切らない
MIN_KEPT_AREA = 0.2  # 残る面積がこれより小さいときは、余白の判定が外れたとみなして切らない
TOLERANCE = 18       # 角の色との差がこれ以下なら余白とみなす


def measure(product):
    request = urllib.request.Request(product["imageUrl"], headers={"User-Agent": "nazomarket-2026-image-margins"})
    try:
        # ブラウザの表示と同じ向きにそろえてから測る
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(urllib.request.urlopen(request, timeout=25).read()))).convert("RGBA")
    except Exception as error:
        print("取得できません", product["id"], error)
        return None
    # 透過は表示の背景とは別に白で塗り、角の色を基準に余白を探す
    flat = Image.alpha_composite(Image.new("RGBA", image.size, (255, 255, 255, 255)), image).convert("RGB")
    background = Image.new("RGB", flat.size, flat.getpixel((0, 0)))
    # 淡い色の絵を余白と間違えないよう、RGB のうち最も差の大きい成分で判定する
    red, green, blue = ImageChops.difference(flat, background).split()
    difference = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    box = difference.point(lambda v: 255 if v > TOLERANCE else 0).getbbox()
    if not box:
        return None
    width, height = flat.size
    margins = {
        "left": box[0] / width,
        "right": (width - box[2]) / width,
        "top": box[1] / height,
        "bottom": (height - box[3]) / height,
    }
    margins = {side: round(value, 4) if value >= MIN_MARGIN else 0 for side, value in margins.items()}
    if not any(margins.values()):
        return None
    if (1 - margins["left"] - margins["right"]) * (1 - margins["top"] - margins["bottom"]) < MIN_KEPT_AREA:
        return None
    return product["id"], {"imageUrl": product["imageUrl"], **margins, "width": width, "height": height}


products = json.loads((ROOT / "data/products.json").read_text(encoding="utf-8"))
with ThreadPoolExecutor(8) as executor:
    results = [result for result in executor.map(measure, [p for p in products if p["imageUrl"]]) if result]
crops = dict(sorted(results))
(ROOT / "data/imageCrops.json").write_text(json.dumps(crops, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"余白のある画像: {len(crops)}件")

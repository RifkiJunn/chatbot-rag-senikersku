"""
Scraper produk lapak Shopee (tanpa extension) menggunakan Playwright.

Cara kerja:
  1. Membuka browser Edge sungguhan (bukan headless) dengan profil tersimpan,
     sehingga login/verifikasi Shopee cukup dilakukan sekali.
  2. Menyadap (intercept) respons JSON dari API internal Shopee yang dipanggil
     halaman toko saat menampilkan daftar produk.
  3. Berpindah halaman otomatis dengan menekan tombol Next (>) dan jeda acak.
  4. Cadangan: jika JSON tidak tertangkap, data diambil dari elemen HTML
     (link produk "-i.<shopid>.<itemid>").
  5. Menyimpan hasil ke data/products.csv (kolom `contents href` = link produk).

Pemakaian:
  pip install playwright
  python scraper/scrape_shopee.py senikersku
"""
import csv
import json
import random
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

SHOP = sys.argv[1] if len(sys.argv) > 1 else "senikersku"
MAX_PAGES = int(sys.argv[2]) if len(sys.argv) > 2 else 30
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "products.csv"
PROFILE = ROOT / "scraper" / ".browser-profile"

items = {}  # itemid -> dict


def kategori(nama):
    n = " " + nama.lower() + " "
    rules = [
        ("Sepatu Anak", ["baby & kids", " td ", " ps ", " gs ", "toddler"]),
        ("Sandal & Slides", ["sandal", "slide", "slipper", "sendal", "clog", "mule", "flip flop"]),
        ("Kaos Kaki", ["kaos kaki", "socks", "sock"]),
        ("Topi", [" cap ", "hat", "beanie", "skullcap", "bucket"]),
        ("Tas", [" tas ", " bag", "backpack", "pouch", "wallet", "card case", "dompet"]),
        ("Pakaian", ["kaos", " tee", "t-shirt", "shirt", "hoodie", "jaket", "jacket", "celana", "pants",
                     "shorts", "jersey", "singlet", "long-t", "sweater", "crewneck", "vest", "tank"]),
        ("Koleksi & Aksesoris", ["bearbrick", "skateboard", "tali", "lace", "insole", "cleaner", "keychain",
                                 "figure", "pillow", "towel", "mug", "sticker", "box"]),
        ("Sepatu", ["sepatu", "sneaker", "shoe", "dunk", "jordan", "air max", "air force", "yeezy", "samba",
                    "gazelle", "campus", "spezial", "boost", "cloud", "saucony", "endorphin", "new balance",
                    "asics", "gel-", "onitsuka", "converse", "chuck", "vans", "puma", "hoka", "salomon",
                    "adidas", "adizero", "nike", "reebok", "mizuno", " on ", "brooks", "li-ning", "anta", "low", "high", " mid ", " og ", "retro", "runner", "trainer", "boot", "foam", "990", "550", "2002"]),
    ]
    for kat, keys in rules:
        if any(k in n for k in keys):
            return kat
    return "Lainnya"


def harga(v):
    if v in (None, "", 0):
        return 0
    v = int(v)
    return v // 100000 if v > 100000000 else v  # Shopee menyimpan harga x100000


def add_item(d):
    """Ambil field penting dari objek item JSON Shopee (beberapa format)."""
    base = d.get("item_basic") if isinstance(d.get("item_basic"), dict) else d
    itemid = base.get("itemid") or base.get("item_id")
    shopid = base.get("shopid") or base.get("shop_id")
    asset = base.get("item_card_displayed_asset") or {}
    name = base.get("name") or asset.get("name")
    if not (itemid and shopid and name):
        return
    disp = base.get("item_card_display_price") or {}
    p = disp.get("price") or base.get("price") or base.get("price_min")
    p_max = base.get("price_max") or p
    sold = (base.get("historical_sold") or base.get("sold")
            or (base.get("item_card_display_sold_count") or {}).get("historical_sold_count") or 0)
    rating = (base.get("item_rating") or {}).get("rating_star") or 0
    img = base.get("image") or asset.get("image") or ""
    items[itemid] = {
        "nama": name.strip(),
        "kategori": kategori(name),
        "harga": harga(p),
        "harga_max": harga(p_max),
        "terjual": sold,
        "rating": round(float(rating), 2) if rating else "",
        "stok": base.get("stock", ""),
        "lokasi": base.get("shop_location", ""),
        "gambar": f"https://down-id.img.susercontent.com/file/{img}" if img else "",
        "contents href": f"https://shopee.co.id/product/{shopid}/{itemid}",
    }


def walk(obj):
    if isinstance(obj, dict):
        if ("itemid" in obj or "item_id" in obj) and ("shopid" in obj or "shop_id" in obj):
            add_item(obj)
        elif isinstance(obj.get("item_basic"), dict):
            add_item(obj)
        for v in obj.values():
            walk(v)
    elif isinstance(obj, list):
        for v in obj:
            walk(v)


def on_response(resp):
    url = resp.url
    if "/api/v4/" not in url:
        return
    if not any(k in url for k in ("rcmd_items", "search_items", "shop_page", "get_shop_tab", "item")):
        return
    try:
        before = len(items)
        walk(resp.json())
        if len(items) > before:
            print(f"  [API] +{len(items) - before} produk dari {url.split('?')[0]}")
    except Exception:
        pass


DOM_JS = r"""
() => [...document.querySelectorAll('a[href*="-i."]')].map(a => ({
  href: a.href, text: a.innerText, img: (a.querySelector('img') || {}).src || ''
}))
"""


def scrape_dom(page):
    added = 0
    for a in page.evaluate(DOM_JS):
        m = re.search(r"-i\.(\d+)\.(\d+)", a["href"])
        if not m or not a["text"].strip():
            continue
        shopid, itemid = int(m.group(1)), int(m.group(2))
        if itemid in items:
            continue
        lines = [l.strip() for l in a["text"].split("\n") if l.strip()]
        name = max(lines, key=len)
        prices = re.findall(r"Rp\s?([\d.]+)", a["text"].replace("\n", " "))
        nums = [int(x.replace(".", "")) for x in prices] or [0]
        sold = re.search(r"([\d,.]+\s?(?:RB|rb)?\+?)\s*Terjual", a["text"])
        items[itemid] = {
            "nama": name, "kategori": kategori(name), "harga": min(nums), "harga_max": max(nums),
            "terjual": sold.group(1) if sold else "", "rating": "", "stok": "", "lokasi": "",
            "gambar": a["img"], "contents href": f"https://shopee.co.id/product/{shopid}/{itemid}",
        }
        added += 1
    if added:
        print(f"  [DOM] +{added} produk")


def main():
    PROFILE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE), channel="msedge", headless=False,
            viewport={"width": 1366, "height": 850}, locale="id-ID",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("response", on_response)
        page.goto(f"https://shopee.co.id/{SHOP}#product_list", wait_until="domcontentloaded")

        print("\n>> Jika diminta, LOGIN / selesaikan verifikasi di jendela browser.\n"
              ">> Script menunggu otomatis (maks 10 menit) sampai daftar produk tampil...")
        while True:
            try:
                page.wait_for_selector('a[href*="-i."]', timeout=600_000)
                break
            except Exception as e:  # navigasi saat login bisa memutus penantian
                if "Timeout" in str(e):
                    raise
                page = ctx.pages[-1]
                page.on("response", on_response)
                time.sleep(2)
        if f"/{SHOP}" not in page.url:
            page.goto(f"https://shopee.co.id/{SHOP}#product_list", wait_until="domcontentloaded")
            page.wait_for_selector('a[href*="-i."]', timeout=120_000)
        time.sleep(3)

        for n in range(1, MAX_PAGES + 1):
            print(f"Halaman {n}")
            for _ in range(6):  # scroll agar semua kartu produk termuat
                page.mouse.wheel(0, 1500)
                time.sleep(0.6)
            scrape_dom(page)
            nxt = page.locator("button.shopee-icon-button--right, .shopee-mini-page-controller__next-btn").first
            if nxt.count() == 0 or nxt.is_disabled():
                print("Tombol Next tidak ada / nonaktif -> selesai.")
                break
            nxt.click()
            time.sleep(random.uniform(3, 6))  # jeda sopan agar tidak membebani server
        ctx.close()

    # Buang produk toko lain (mis. rekomendasi di beranda): ambil shopid terbanyak
    from collections import Counter
    sid = lambda r: r["contents href"].split("/")[-2]
    main_shop = Counter(sid(r) for r in items.values()).most_common(1)[0][0]
    rows = sorted((r for r in items.values() if sid(r) == main_shop), key=lambda r: r["nama"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["nama"])
        w.writeheader()
        w.writerows(rows)
    print(f"\nSelesai: {len(rows)} produk disimpan ke {OUT}")


if __name__ == "__main__":
    main()

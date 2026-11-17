// Mesin RAG sederhana: baca data/products.csv hasil scraping, cari produk relevan
// berdasarkan kata kunci + intent harga, lalu susun konteks untuk LLM.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

// Parser CSV yang mendukung tanda kutip (nama produk Shopee sering berisi koma)
function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(x => x.trim()));
  const keys = head.map(h => h.trim().toLowerCase());
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] || "").trim()])));
}

const STOP = new Set("ada apa yang dan atau di ke dari ini itu untuk dengan berapa harga kak min gan sis mau beli cari dong ya tidak gak nggak apakah produk barang toko jual punya stok berapaan brp".split(" "));
const tokens = s => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));
const rupiah = n => "Rp" + Number(n || 0).toLocaleString("id-ID");

class RAGEngine {
  constructor(csvPath = path.join(DATA_DIR, "products.csv"), topK = Number(process.env.RAG_TOP_K || 8)) {
    this.topK = topK;
    this.products = fs.existsSync(csvPath)
      ? parseCSV(fs.readFileSync(csvPath, "utf-8")).map(p => ({ ...p, harga: Number(p.harga) || 0 }))
      : [];
  }

  categories() {
    const c = {};
    this.products.forEach(p => (c[p.kategori] = (c[p.kategori] || 0) + 1));
    return c;
  }

  search(query) {
    const q = (query || "").toLowerCase();
    const qt = tokens(q);
    let list = this.products.map(p => {
      const hay = `${p.nama} ${p.kategori}`.toLowerCase();
      const score = qt.reduce((s, t) => s + (hay.includes(t) ? (t.length > 3 ? 2 : 1) : 0), 0);
      return { p, score };
    });

    // Filter budget: "di bawah 300 ribu", "max 500rb", "budget 1 juta"
    const m = q.match(/(?:bawah|max|maks|kurang dari|budget|<)\s*(?:rp\.?\s*)?([\d.,]+)\s*(rb|ribu|k|jt|juta)?/);
    if (m) {
      let lim = /[.,]\d{1,2}$/.test(m[1]) && m[2] ? Number(m[1].replace(",", ".")) : Number(m[1].replace(/[.,]/g, ""));
      if (/rb|ribu|k/.test(m[2] || "")) lim *= 1000;
      if (/jt|juta/.test(m[2] || "")) lim *= 1000000;
      list = list.filter(x => x.p.harga <= lim);
    }

    const hits = list.filter(x => x.score > 0);
    if (/murah|termurah/.test(q)) (hits.length ? hits : list).sort((a, b) => a.p.harga - b.p.harga || b.score - a.score);
    else if (/mahal|termahal|premium/.test(q)) (hits.length ? hits : list).sort((a, b) => b.p.harga - a.p.harga);
    else if (/laris|terlaris|best ?seller|populer/.test(q)) (hits.length ? hits : list).sort((a, b) => parseInt(b.p.terjual || 0) - parseInt(a.p.terjual || 0));
    else hits.sort((a, b) => b.score - a.score);

    return (hits.length ? hits : list).slice(0, this.topK).map(x => x.p);
  }

  buildContext(query) {
    const found = this.search(query);
    const cats = Object.entries(this.categories()).map(([k, v]) => `${k} (${v})`).join(", ");
    const lines = found.map((p, i) =>
      `${i + 1}. ${p.nama} | Kategori: ${p.kategori} | Harga: ${rupiah(p.harga)}` +
      (p.harga_max && Number(p.harga_max) > p.harga ? ` - ${rupiah(p.harga_max)}` : "") +
      (p.terjual ? ` | Terjual: ${p.terjual}` : "") +
      (p.rating ? ` | Rating: ${p.rating}` : "") +
      ` | Link: ${p["contents href"]}`);
    return `Total produk di toko: ${this.products.length}. Kategori: ${cats}.\nProduk relevan:\n${lines.join("\n")}`;
  }
}

module.exports = { RAGEngine, parseCSV, rupiah };

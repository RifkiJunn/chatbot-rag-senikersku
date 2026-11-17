// Logika chatbot berlapis (dipakai bersama oleh website/Vercel dan gateway WhatsApp):
// 1) sapaan/terima kasih -> template, 2) FAQ knowledge.json, 3) RAG + LLM (9router)
const fs = require("fs");
const path = require("path");
const { RAGEngine } = require("./rag");

const rag = new RAGEngine();
const knowledge = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "knowledge.json"), "utf-8"));

const LLM_BASE = (process.env.LLM_BASE_URL || "http://169.40.151.48:28417/v1").replace(/\/$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "testing";
const LLM_KEY = process.env.LLM_API_KEY || "";
const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 800);

const SYSTEM = `Kamu adalah asisten customer service toko Shopee "${knowledge.shop.name}" (${knowledge.shop.url}).
Jawab dalam Bahasa Indonesia yang ramah dan singkat.
ATURAN PENTING:
- Hanya gunakan data produk pada KONTEKS. Jangan mengarang produk, harga, atau stok.
- Jika produk yang ditanyakan tidak ada di konteks, katakan tidak tersedia lalu tawarkan alternatif dari konteks.
- Sebutkan nama produk, harga, dan sertakan link Shopee produknya.
- Untuk pembelian, arahkan pelanggan checkout lewat link Shopee tersebut.
- Format WhatsApp: tebal pakai *satu bintang*, jangan pakai **, #, atau tabel markdown.`;

// Info kuota dari header rate-limit (jika provider mengirimkannya)
const quota = {
  model: LLM_MODEL, configured: Boolean(LLM_KEY), lastChecked: null,
  remainingRequests: null, limitRequests: null, resetRequests: null, remainingTokens: null, limitTokens: null,
  update(h) {
    const g = k => h.get(k);
    Object.assign(this, {
      lastChecked: new Date().toLocaleTimeString("id-ID"),
      remainingRequests: g("x-ratelimit-remaining-requests"), limitRequests: g("x-ratelimit-limit-requests"),
      resetRequests: g("x-ratelimit-reset-requests"),
      remainingTokens: g("x-ratelimit-remaining-tokens"), limitTokens: g("x-ratelimit-limit-tokens"),
    });
  },
  async refresh() {
    try { const r = await fetch(`${LLM_BASE}/models`, { headers: { Authorization: `Bearer ${LLM_KEY}` }, signal: AbortSignal.timeout(10000) }); this.update(r.headers); this.online = r.ok; }
    catch { this.online = false; }
    return this;
  },
};

function quickReply(msg) {
  const m = msg.toLowerCase().trim();
  if (/^(hai|halo|hallo|hi|hello|pagi|siang|sore|malam|assalamualaikum|p|permisi)\b[\s!.?]*$/.test(m))
    return `Halo! 👋 Selamat datang di *${knowledge.shop.name}*. Mau cari produk apa hari ini? Kamu bisa tanya harga, kategori, atau rekomendasi sesuai budget.`;
  if (/(terima ?kasih|makasih|thanks|thx)/.test(m))
    return "Sama-sama! 😊 Kalau ada yang mau ditanyakan lagi, chat aja ya.";
  for (const [kw, key] of Object.entries(knowledge.keywords))
    if (m.includes(kw)) return knowledge.responses[key];
  return null;
}

async function askLLM(message, history = []) {
  const context = rag.buildContext(message);
  const messages = [
    { role: "system", content: `${SYSTEM}\n\nKONTEKS:\n${context}` },
    ...history.slice(-6).filter(h => h && h.role && h.content),
    { role: "user", content: message },
  ];
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(LLM_KEY && { Authorization: `Bearer ${LLM_KEY}` }) },
    body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: MAX_TOKENS, temperature: 0.3 }),
    signal: AbortSignal.timeout(55000),
  });
  quota.update(res.headers);
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  let text = data.choices?.[0]?.message?.content || "";
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function reply(message, history = []) {
  const quick = quickReply(message);
  if (quick) return { reply: quick, source: "template" };
  try {
    return { reply: await askLLM(message, history), source: "llm" };
  } catch (e) {
    console.error("[LLM]", e.message);
    // Fallback tanpa AI: tampilkan hasil RAG mentah
    const list = rag.search(message).slice(0, 5)
      .map(p => `• ${p.nama} - Rp${p.harga.toLocaleString("id-ID")}\n  ${p["contents href"]}`).join("\n");
    return { reply: `Maaf, AI sedang tidak tersedia. Berikut produk yang mungkin cocok:\n${list}`, source: "rag-fallback" };
  }
}

module.exports = { reply, rag, knowledge, quota };

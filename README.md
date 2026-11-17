# Senikersku — Katalog + Chatbot RAG (Web & WhatsApp)

Lapak: https://shopee.co.id/senikersku · Data: `data/products.csv` (866 produk, kolom `contents href` = link produk)

## Struktur
- `scraper/scrape_shopee.py` — scraping via kode (Playwright + intercept API Shopee `rcmd_items`/`search_items`)
- `lib/rag.js` — mesin RAG (parse CSV, cari produk, filter budget/termurah/terlaris)
- `lib/chatbot.js` — jawaban berlapis: template → FAQ (`data/knowledge.json`) → RAG + LLM (9router)
- `api/chat.js`, `api/products.js` — Vercel serverless functions
- `public/` — website katalog + widget chat
- `wa-gateway.js` — gateway WhatsApp (whatsapp-web.js) memakai chatbot yang sama

## Menjalankan
```bash
npm install
# isi LLM_API_KEY di .env
npm run dev      # website lokal http://localhost:3000
npm run wa       # dashboard bot WA ala modul -> http://localhost:3001 (Mulai Bot, scan QR)
npm run scrape   # scraping ulang (login Shopee di jendela Edge)
```

## Deploy Vercel
Push ke GitHub → Import di Vercel → Environment Variables: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` → Deploy.

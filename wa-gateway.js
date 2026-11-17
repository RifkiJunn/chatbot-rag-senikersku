// Gateway WhatsApp + Dashboard Web (mengikuti server-v2.js di modul praktikum).
// Jalankan: npm run wa -> buka http://localhost:3001, klik "Mulai Bot", scan QR.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { reply, rag, knowledge, quota } = require("./lib/chatbot");

const PORT = process.env.WA_PORT || 3001;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "wa-dashboard")));

let client = null, isReady = false, isInitializing = false, qrCodeData = null, qrImage = null, botNumber = null;
const histories = new Map();

function createClient() {
  const c = new Client({ authStrategy: new LocalAuth(), puppeteer: { headless: true, args: ["--no-sandbox"] } });
  c.on("qr", async qr => { qrCodeData = qr; qrImage = await QRCode.toDataURL(qr, { width: 280 }); isInitializing = false; console.log("[WA] QR baru tersedia di dashboard"); });
  c.on("ready", () => { isReady = true; isInitializing = false; qrCodeData = qrImage = null; botNumber = c.info?.wid?.user; console.log(`[WA] Bot siap (${botNumber})`); });
  c.on("disconnected", async r => {
    console.log("[WA] Terputus:", r);
    if (client !== c) return; // event ganda dari client lama
    client = null; isReady = isInitializing = false; qrCodeData = qrImage = botNumber = null;
    try { await c.destroy(); } catch {}
    if (r === "LOGOUT") { clearSession(); console.log("[WA] Sesi dihapus. Klik 'Mulai Bot' untuk scan QR baru."); }
  });
  c.on("message", async msg => {
    if (msg.fromMe || msg.isStatus || msg.from.endsWith("@g.us") || !msg.body) return;
    const h = histories.get(msg.from) || [];
    console.log(`[WA] ${msg.from}: ${msg.body}`);
    try {
      (await msg.getChat()).sendStateTyping();
      const { reply: text, source } = await reply(msg.body, h);
      await msg.reply(text);
      console.log(`[BOT:${source}] ${text.slice(0, 80)}`);
      histories.set(msg.from, [...h, { role: "user", content: msg.body }, { role: "assistant", content: text }].slice(-10));
    } catch (e) { console.error("[WA] Gagal membalas:", e.message); }
  });
  return c;
}

function clearSession() {
  for (const d of [".wwebjs_auth", ".wwebjs_cache"])
    try { fs.rmSync(path.join(__dirname, d), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); }
    catch (e) { console.warn(`[WA] Gagal hapus ${d} (file masih dipakai): ${e.message}`); }
}

// Jangan biarkan error internal puppeteer/whatsapp-web.js mematikan dashboard
process.on("unhandledRejection", e => console.error("[WA] Error (diabaikan):", e?.message || e));
process.on("uncaughtException", e => console.error("[WA] Error (diabaikan):", e?.message || e));

async function startBot() {
  if (client) return;
  isInitializing = true;
  client = createClient();
  client.initialize().catch(e => { console.error("[WA] Gagal inisialisasi:", e.message); client = null; isInitializing = false; });
}
async function stopBot() {
  try { await client?.destroy(); } catch {}
  client = null; isReady = isInitializing = false; qrCodeData = qrImage = botNumber = null;
}

// ---- REST API (sama dengan modul) ----
app.get("/api/bot/status", (req, res) => res.json({ isReady, isInitializing, hasQRCode: Boolean(qrCodeData), botNumber }));
app.get("/api/bot/qr", (req, res) => res.json({ qr: qrCodeData, qrImage }));
app.post("/api/bot/start", async (req, res) => {
  if (isReady) return res.json({ success: true, message: "Bot sudah berjalan." });
  if (client) return res.json({ success: true, message: "Bot sedang proses inisialisasi..." });
  await startBot(); res.json({ success: true });
});
app.post("/api/bot/stop", async (req, res) => { await stopBot(); res.json({ success: true }); });
app.post("/api/bot/reset", async (req, res) => {
  try {
    await stopBot();
    clearSession();
    res.json({ success: true, message: "Sesi WhatsApp berhasil dibersihkan. Anda dapat memindai QR baru." });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get("/api/groq/quota", async (req, res) => res.json(req.query.fresh ? await quota.refresh() : quota));
app.get("/api/knowledge", (req, res) => res.json(knowledge));
app.get("/api/products", (req, res) => res.json({ products: rag.products }));
app.post("/api/chat", async (req, res) => res.json(await reply(String(req.body?.message || ""), req.body?.history || [])));

app.listen(PORT, () => {
  console.log(`Dashboard WhatsApp: http://localhost:${PORT}`);
  if (process.env.AUTO_START_BOT === "true") startBot();
});

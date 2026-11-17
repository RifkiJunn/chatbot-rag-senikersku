const $ = s => document.querySelector(s);
const rp = n => "Rp" + Number(n || 0).toLocaleString("id-ID");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let products = [], cat = "", history = [];

async function load() {
  const data = await (await fetch("/api/products")).json();
  products = data.products;
  $("#count").textContent = products.length;
  const wa = data.shop.whatsapp;
  $("#waLink").href = `https://wa.me/${wa}?text=${encodeURIComponent("Halo Senikersku, saya mau tanya produk")}`;
  $("#cats").innerHTML = [["", products.length], ...Object.entries(data.categories)]
    .map(([k, v]) => `<button data-c="${esc(k)}" class="${k === cat ? "on" : ""}">${esc(k || "Semua")} (${v})</button>`).join("");
  render();
}

function render() {
  const q = $("#search").value.toLowerCase();
  let list = products.filter(p => (!cat || p.kategori === cat) && p.nama.toLowerCase().includes(q));
  const s = $("#sort").value;
  if (s === "murah") list.sort((a, b) => a.harga - b.harga);
  if (s === "mahal") list.sort((a, b) => b.harga - a.harga);
  if (s === "laris") list.sort((a, b) => parseInt(b.terjual || 0) - parseInt(a.terjual || 0));
  $("#grid").innerHTML = list.map(p => `
    <article class="card">
      <img loading="lazy" src="${esc(p.gambar)}" alt="${esc(p.nama)}" onerror="this.style.visibility='hidden'">
      <div class="body">
        <h3>${esc(p.nama)}</h3>
        <div class="price">${rp(p.harga)}</div>
        <div class="meta">${esc(p.kategori)}${p.terjual ? " · " + esc(p.terjual) + " terjual" : ""}${p.rating ? " · ★ " + esc(p.rating) : ""}</div>
        <a class="buy" href="${esc(p["contents href"])}" target="_blank" rel="noopener">Beli di Shopee</a>
      </div>
    </article>`).join("") || "<p>Produk tidak ditemukan.</p>";
}

$("#cats").onclick = e => { if (e.target.dataset.c === undefined) return; cat = e.target.dataset.c; document.querySelectorAll(".cats button").forEach(b => b.classList.toggle("on", b === e.target)); render(); };
$("#search").oninput = render;
$("#sort").onchange = render;

// ---- Chat ----
function openChat() { $("#chat").hidden = false; $("#fab").hidden = true; $("#chatInput").focus(); if (!$("#msgs").children.length) add("bot", "Halo! 👋 Aku asisten Senikersku. Tanya apa saja soal produk toko ini — harga, rekomendasi, atau budget."); }
function closeChat() { $("#chat").hidden = true; $("#fab").hidden = false; }
function add(who, text) {
  const d = document.createElement("div");
  d.className = "m " + who;
  d.innerHTML = esc(text).replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  $("#msgs").append(d); $("#msgs").scrollTop = 1e9;
  return d;
}
async function send(text) {
  if (!text.trim()) return;
  add("me", text);
  const wait = add("bot", "Mengetik…");
  try {
    const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, history }) });
    const { reply } = await r.json();
    wait.remove(); add("bot", reply);
    history.push({ role: "user", content: text }, { role: "assistant", content: reply });
    history = history.slice(-10);
  } catch { wait.textContent = "Maaf, terjadi gangguan koneksi."; }
}
$("#chatForm").onsubmit = e => { e.preventDefault(); const v = $("#chatInput").value; $("#chatInput").value = ""; send(v); };
document.querySelectorAll(".chips button").forEach(b => b.onclick = () => send(b.textContent));

load();

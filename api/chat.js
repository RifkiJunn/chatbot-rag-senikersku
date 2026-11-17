// Vercel Serverless Function: POST /api/chat  { message, history }
const { reply } = require("../lib/chatbot");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Gunakan POST" });
  const { message, history } = req.body || {};
  if (!message || typeof message !== "string") return res.status(400).json({ error: "message wajib diisi" });
  res.status(200).json(await reply(message.slice(0, 1000), Array.isArray(history) ? history : []));
};

// GET /api/products -> seluruh katalog hasil scraping + info toko
const { rag, knowledge } = require("../lib/chatbot");

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=3600");
  res.status(200).json({ shop: knowledge.shop, categories: rag.categories(), products: rag.products });
};

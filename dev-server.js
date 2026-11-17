// Server lokal untuk mencoba website + API tanpa Vercel: npm run dev -> http://localhost:3000
require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());
app.use(express.static("public"));
app.post("/api/chat", require("./api/chat"));
app.get("/api/products", require("./api/products"));
app.listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));

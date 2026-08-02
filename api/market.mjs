import { getFearGreed, getPrices } from "../server.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const warnings = [];
  const safe = async (name, loader) => {
    try { return await loader(); }
    catch (error) { warnings.push(`${name}: ${error.message}`); return null; }
  };
  const [prices, fearGreed] = await Promise.all([
    safe("Цены", getPrices),
    safe("Fear & Greed", getFearGreed),
  ]);
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=120, stale-while-revalidate=300");
  return res.status(200).json({ updatedAt: new Date().toISOString(), prices: prices || [], fearGreed, warnings });
}

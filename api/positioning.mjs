import { getPositioning } from "../server.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const warnings = [];
  let positioning = null;
  try { positioning = await getPositioning(); }
  catch (error) { warnings.push(`Фьючерсы BTC: ${error.message}`); }
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=900");
  return res.status(200).json({ updatedAt: new Date().toISOString(), positioning, warnings });
}

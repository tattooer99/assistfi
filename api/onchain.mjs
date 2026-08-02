import { getOnchain } from "../server.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const warnings = [];
  let onchain = null;
  try { onchain = await getOnchain(); }
  catch (error) { warnings.push(`On-chain: ${error.message}`); }
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=43200, stale-while-revalidate=86400");
  return res.status(200).json({ updatedAt: new Date().toISOString(), onchain, warnings });
}

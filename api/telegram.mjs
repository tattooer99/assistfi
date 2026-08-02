import { briefMessage, telegram } from "../server.mjs";

function deploymentUrl() {
  const host = process.env.PUBLIC_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "";
  if (!host) return "";
  return /^https?:\/\//.test(host) ? host.replace(/\/$/, "") : `https://${host.replace(/\/$/, "")}`;
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) return res.status(403).json({ ok: false });
  const update = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const message = update.message;
  if (!message) return res.status(200).json({ ok: true });
  const userId = String(message.from?.id || "");
  const allowedUserId = process.env.TELEGRAM_ALLOWED_USER_ID || "";
  if (allowedUserId && userId !== allowedUserId) return res.status(200).json({ ok: true });

  const base = deploymentUrl();
  const chatId = message.chat.id;
  const command = String(message.text || "").split("@")[0];
  try {
    if (command === "/brief") {
      if (!base) throw new Error("PUBLIC_URL не настроен");
      const [marketData, chainData, optionsData, globalData] = await Promise.all([
        getJson(`${base}/api/market`),
        getJson(`${base}/api/onchain`),
        getJson(`${base}/api/options`),
        getJson(`${base}/api/global`),
      ]);
      const data = {
        updatedAt: marketData.updatedAt,
        prices: marketData.prices || [],
        fearGreed: marketData.fearGreed,
        onchain: chainData.onchain,
        derivatives: optionsData.derivatives,
        global: globalData.global,
        warnings: [...(marketData.warnings || []), ...(chainData.warnings || []), ...(optionsData.warnings || []), ...(globalData.warnings || [])],
      };
      const btc = data.prices.find((row) => row.symbol === "BTC");
      if (data.onchain?.etfFlow && btc?.price) data.onchain.etfFlow.estimatedUsd = data.onchain.etfFlow.valueBtc * btc.price;
      await telegram("sendMessage", {
        chat_id: chatId,
        text: briefMessage(data),
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "Открыть бриф", web_app: { url: base } }]] },
      });
    } else {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: "Нажмите кнопку или отправьте /brief",
        reply_markup: base ? { keyboard: [[{ text: "Открыть Crypto Brief", web_app: { url: base } }]], resize_keyboard: true } : undefined,
      });
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(200).json({ ok: false, error: "brief_failed" });
  }
}

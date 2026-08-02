import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const cacheDir = join(root, ".cache");
const port = Number(process.env.PORT || 3000);
const publicUrl = String(process.env.PUBLIC_URL || "").replace(/\/$/, "");
const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
const allowedUserId = process.env.TELEGRAM_ALLOWED_USER_ID || "";
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";

const memoryCache = new Map();

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function fetchJson(url, options = {}, timeoutMs = 12_000) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "CryptoBrief/1.0", ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function cached(key, ttlMs, loader) {
  const hit = memoryCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await loader();
  memoryCache.set(key, { at: Date.now(), value });
  return value;
}

function lastNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

export async function getPrices() {
  return cached("prices", 2 * 60_000, async () => {
    const url = new URL("https://api.coingecko.com/api/v3/coins/markets");
    url.search = new URLSearchParams({
      vs_currency: "usd",
      ids: "bitcoin,ethereum",
      price_change_percentage: "24h,7d,30d",
    });
    const rows = await fetchJson(url);
    return rows.map((row) => ({
      id: row.id,
      symbol: row.symbol.toUpperCase(),
      price: lastNumber(row.current_price),
      change24h: lastNumber(row.price_change_percentage_24h),
      change7d: lastNumber(row.price_change_percentage_7d_in_currency),
      change30d: lastNumber(row.price_change_percentage_30d_in_currency),
      volume24h: lastNumber(row.total_volume),
      updatedAt: row.last_updated,
      source: "CoinGecko",
    }));
  });
}

export async function getFearGreed() {
  return cached("fear-greed", 15 * 60_000, async () => {
    const payload = await fetchJson("https://api.alternative.me/fng/?limit=2");
    const [current, previous] = payload.data || [];
    return {
      value: lastNumber(current?.value),
      label: current?.value_classification || null,
      previous: lastNumber(previous?.value),
      updatedAt: current?.timestamp ? new Date(Number(current.timestamp) * 1000).toISOString() : null,
      source: "Alternative.me",
    };
  });
}

async function readDiskCache(name, ttlMs) {
  try {
    const parsed = JSON.parse(await readFile(join(cacheDir, `${name}.json`), "utf8"));
    return Date.now() - parsed.cachedAt < ttlMs ? parsed.value : null;
  } catch {
    return null;
  }
}

async function writeDiskCache(name, value) {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${name}.json`), JSON.stringify({ cachedAt: Date.now(), value }));
  } catch {
    // На некоторых бесплатных serverless-хостингах файловая система read-only.
  }
}

function stablecoinTotal(row) {
  return Object.entries(row || {}).reduce((sum, [key, value]) => {
    return key === "d" || key === "unixTs" ? sum : sum + (lastNumber(value) || 0);
  }, 0);
}

export async function getOnchain() {
  return cached("onchain", 12 * 60 * 60_000, async () => {
    const disk = await readDiskCache("onchain", 12 * 60 * 60_000);
    if (disk) return disk;

    const end = new Date();
    const start = new Date(Date.now() - 14 * 86400_000);
    const range = `?startday=${ymd(start)}&endday=${ymd(end)}`;
    const [mvrv, sopr, realized, stablecoins, etf] = await Promise.all([
      fetchJson("https://bitcoin-data.com/v1/mvrv/last"),
      fetchJson("https://bitcoin-data.com/v1/sopr/last"),
      fetchJson("https://bitcoin-data.com/v1/realized-price/last"),
      fetchJson(`https://bitcoin-data.com/v1/stablecoin-supply${range}`),
      fetchJson(`https://bitcoin-data.com/v1/etf-flow-btc${range}`),
    ]);

    const stableRows = Array.isArray(stablecoins) ? stablecoins.slice(-2) : [];
    const stableNow = stablecoinTotal(stableRows.at(-1));
    const stablePrev = stablecoinTotal(stableRows.at(-2));
    const etfLast = Array.isArray(etf) ? etf.at(-1) : null;

    let exchangeReserve = null;
    if (process.env.BGEOMETRICS_TOKEN) {
      try {
        const row = await fetchJson("https://bitcoin-data.com/v1/exchange-reserve-btc/last", {
          headers: { authorization: `Bearer ${process.env.BGEOMETRICS_TOKEN}` },
        });
        exchangeReserve = {
          valueBtc: lastNumber(row.exchangeReserveBtc ?? row.value),
          date: row.d || null,
        };
      } catch {
        exchangeReserve = null;
      }
    }

    const value = {
      mvrv: { value: lastNumber(mvrv.mvrv), date: mvrv.d },
      sopr: { value: lastNumber(sopr.sopr), date: sopr.d },
      realizedPrice: { value: lastNumber(realized.realizedPrice), date: realized.d },
      stablecoinFlow: {
        valueUsd: stableNow && stablePrev ? stableNow - stablePrev : null,
        percent: stablePrev ? ((stableNow - stablePrev) / stablePrev) * 100 : null,
        date: stableRows.at(-1)?.d || null,
        kind: "Изменение совокупного предложения — прокси притока ликвидности",
      },
      etfFlow: {
        valueBtc: lastNumber(etfLast?.etfFlow),
        date: etfLast?.d || null,
      },
      exchangeReserve,
      source: "BGeometrics",
    };
    await writeDiskCache("onchain", value);
    return value;
  });
}

async function getDvol(currency) {
  const end = Date.now();
  const start = end - 48 * 60 * 60_000;
  const url = new URL("https://www.deribit.com/api/v2/public/get_volatility_index_data");
  url.search = new URLSearchParams({
    currency,
    start_timestamp: String(start),
    end_timestamp: String(end),
    resolution: "3600",
  });
  const payload = await fetchJson(url);
  const candles = payload.result?.data || [];
  const latest = candles.at(-1);
  const oneDayAgo = candles.at(Math.max(0, candles.length - 25));
  return {
    value: lastNumber(latest?.[4]),
    change24h: latest && oneDayAgo ? lastNumber(latest[4] - oneDayAgo[4]) : null,
  };
}

async function getPutCall(currency) {
  const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
  const payload = await fetchJson(url, {}, 20_000);
  const totals = { putOi: 0, callOi: 0, putVolume: 0, callVolume: 0 };
  for (const row of payload.result || []) {
    const isPut = row.instrument_name?.endsWith("-P");
    const side = isPut ? "put" : "call";
    totals[`${side}Oi`] += lastNumber(row.open_interest) || 0;
    totals[`${side}Volume`] += lastNumber(row.volume) || 0;
  }
  return {
    oiRatio: totals.callOi ? totals.putOi / totals.callOi : null,
    volumeRatio: totals.callVolume ? totals.putVolume / totals.callVolume : null,
  };
}

export async function getDerivatives() {
  return cached("derivatives", 5 * 60_000, async () => {
    const [btcDvol, ethDvol, btcPutCall, ethPutCall] = await Promise.all([
      getDvol("BTC"),
      getDvol("ETH"),
      getPutCall("BTC"),
      getPutCall("ETH"),
    ]);
    return { btcDvol, ethDvol, btcPutCall, ethPutCall, source: "Deribit" };
  });
}

async function safe(name, loader, warnings) {
  try {
    return await loader();
  } catch (error) {
    warnings.push(`${name}: ${error.message}`);
    return null;
  }
}

export async function buildBrief() {
  const warnings = [];
  const [prices, fearGreed, onchain, derivatives] = await Promise.all([
    safe("Цены", getPrices, warnings),
    safe("Fear & Greed", getFearGreed, warnings),
    safe("On-chain", getOnchain, warnings),
    safe("Опционы", getDerivatives, warnings),
  ]);
  const btc = prices?.find((item) => item.symbol === "BTC");
  if (onchain?.etfFlow && btc?.price) {
    onchain.etfFlow.estimatedUsd = onchain.etfFlow.valueBtc * btc.price;
  }
  return {
    updatedAt: new Date().toISOString(),
    prices: prices || [],
    fearGreed,
    onchain,
    derivatives,
    warnings,
  };
}

function fmt(value, digits = 2) {
  return value == null ? "н/д" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value);
}

function sign(value, suffix = "%") {
  return value == null ? "н/д" : `${value >= 0 ? "+" : ""}${fmt(value)}${suffix}`;
}

export function briefMessage(data) {
  const btc = data.prices.find((row) => row.symbol === "BTC");
  const eth = data.prices.find((row) => row.symbol === "ETH");
  const o = data.onchain;
  const d = data.derivatives;
  const f = data.fearGreed;
  return [
    "<b>CRYPTO BRIEF</b>",
    `Обновлено: ${new Date(data.updatedAt).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv" })} Kyiv`,
    "",
    "<b>Рынок</b>",
    `₿ BTC  $${fmt(btc?.price, 0)}  | 24ч ${sign(btc?.change24h)} | 7д ${sign(btc?.change7d)} | 30д ${sign(btc?.change30d)}`,
    `Ξ ETH  $${fmt(eth?.price, 0)}  | 24ч ${sign(eth?.change24h)} | 7д ${sign(eth?.change7d)} | 30д ${sign(eth?.change30d)}`,
    `Fear & Greed: ${fmt(f?.value, 0)} (${f?.label || "н/д"})`,
    "",
    "<b>On-chain и потоки</b>",
    `MVRV: ${fmt(o?.mvrv?.value, 3)}`,
    `SOPR: ${fmt(o?.sopr?.value, 4)}`,
    `Realized price: $${fmt(o?.realizedPrice?.value, 0)}`,
    `Объём BTC 24ч: $${fmt(btc?.volume24h, 0)}`,
    `Δ предложения стейблкоинов: ${sign(o?.stablecoinFlow?.valueUsd ? o.stablecoinFlow.valueUsd / 1e6 : null, " млн $")}`,
    `ETF flow: ${sign(o?.etfFlow?.valueBtc, " BTC")}`,
    "",
    "<b>Опционы</b>",
    `BTC DVOL: ${fmt(d?.btcDvol?.value, 1)} | P/C OI: ${fmt(d?.btcPutCall?.oiRatio, 2)}`,
    `ETH DVOL: ${fmt(d?.ethDvol?.value, 1)} | P/C OI: ${fmt(d?.ethPutCall?.oiRatio, 2)}`,
    data.warnings.length ? `\n⚠️ Частично недоступно: ${data.warnings.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

export async function telegram(method, payload) {
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN не настроен");
  return fetchJson(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function handleTelegram(req, res) {
  if (webhookSecret && req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret) {
    return json(res, 403, { ok: false });
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const update = JSON.parse(raw || "{}");
  const message = update.message;
  if (!message) return json(res, 200, { ok: true });
  const userId = String(message.from?.id || "");
  if (allowedUserId && userId !== allowedUserId) return json(res, 200, { ok: true });

  const chatId = message.chat.id;
  const text = String(message.text || "").split("@")[0];
  if (text === "/brief") {
    const brief = await buildBrief();
    await telegram("sendMessage", {
      chat_id: chatId,
      text: briefMessage(brief),
      parse_mode: "HTML",
      reply_markup: publicUrl ? { inline_keyboard: [[{ text: "Открыть бриф", web_app: { url: publicUrl } }]] } : undefined,
    });
  } else {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: "Нажмите кнопку или отправьте /brief",
      reply_markup: publicUrl ? { keyboard: [[{ text: "Открыть Crypto Brief", web_app: { url: publicUrl } }]], resize_keyboard: true } : undefined,
    });
  }
  return json(res, 200, { ok: true });
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.[\\/])+/, "");
  const file = join(publicDir, safePath);
  if (!file.startsWith(publicDir)) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/api/market") {
      const warnings = [];
      const [prices, fearGreed] = await Promise.all([
        safe("Цены", getPrices, warnings),
        safe("Fear & Greed", getFearGreed, warnings),
      ]);
      return json(res, 200, { updatedAt: new Date().toISOString(), prices: prices || [], fearGreed, warnings });
    }
    if (req.method === "GET" && url.pathname === "/api/onchain") {
      const warnings = [];
      const onchain = await safe("On-chain", getOnchain, warnings);
      return json(res, 200, { updatedAt: new Date().toISOString(), onchain, warnings });
    }
    if (req.method === "GET" && url.pathname === "/api/options") {
      const warnings = [];
      const derivatives = await safe("Опционы", getDerivatives, warnings);
      return json(res, 200, { updatedAt: new Date().toISOString(), derivatives, warnings });
    }
    if (req.method === "GET" && url.pathname === "/api/brief") return json(res, 200, await buildBrief());
    if (req.method === "POST" && url.pathname === "/telegram/webhook") return await handleTelegram(req, res);
    if (req.method === "GET" && await serveStatic(url.pathname, res)) return;
    json(res, 404, { error: "Не найдено" });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "Временная ошибка", detail: process.env.NODE_ENV === "development" ? error.message : undefined });
  }
});

const launchedDirectly = process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url));
if (launchedDirectly) server.listen(port, () => console.log(`Crypto Brief: http://localhost:${port}`));

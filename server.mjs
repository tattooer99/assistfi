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

async function fetchText(url, options = {}, timeoutMs = 20_000) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "CryptoBrief/1.0", ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
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

const GLOBAL_TICKERS = {
  sp500: ["^GSPC", "S&P 500", "США"],
  nasdaq100: ["^NDX", "Nasdaq 100", "США"],
  es: ["ES=F", "ES Futures", "США"],
  nq: ["NQ=F", "NQ Futures", "США"],
  vix: ["^VIX", "VIX", "Риск"],
  dxy: ["DX-Y.NYB", "DXY", "Риск"],
  gold: ["GC=F", "Gold", "Сырьё"],
  wti: ["CL=F", "WTI", "Сырьё"],
  euroStoxx: ["^STOXX50E", "Euro Stoxx 50", "Европа"],
  dax: ["^GDAXI", "DAX", "Европа"],
  ftse: ["^FTSE", "FTSE 100", "Европа"],
  nikkei: ["^N225", "Nikkei 225", "Азия"],
  hangSeng: ["^HSI", "Hang Seng", "Азия"],
  csi300: ["000300.SS", "CSI 300", "Азия"],
  eurusd: ["EURUSD=X", "EUR/USD", "FX"],
  usdjpy: ["JPY=X", "USD/JPY", "FX"],
};

function changeFrom(points, current, days) {
  if (!points.length || current == null) return null;
  const cutoff = Date.now() / 1000 - days * 86400;
  let reference = points[0];
  for (const point of points) {
    if (point.timestamp <= cutoff) reference = point;
    else break;
  }
  return reference?.close ? ((current / reference.close) - 1) * 100 : null;
}

async function getYahooAsset(key, [symbol, label, region]) {
  try {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.search = new URLSearchParams({ range: "1mo", interval: "1d", includePrePost: "true" });
    const payload = await fetchJson(url, {}, 15_000);
    const result = payload.chart?.result?.[0];
    if (!result) throw new Error("empty response");
    const closes = result.indicators?.quote?.[0]?.close || [];
    const points = (result.timestamp || []).map((timestamp, index) => ({ timestamp, close: lastNumber(closes[index]) })).filter((point) => point.close != null);
    const current = lastNumber(result.meta?.regularMarketPrice) ?? points.at(-1)?.close ?? null;
    const previous = points.length > 1 ? points.at(-2)?.close : lastNumber(result.meta?.chartPreviousClose);
    return {
      key, symbol, label, region, current,
      change1d: previous ? ((current / previous) - 1) * 100 : null,
      change7d: changeFrom(points, current, 7),
      change30d: changeFrom(points, current, 30),
      currency: result.meta?.currency || null,
      updatedAt: result.meta?.regularMarketTime ? new Date(result.meta.regularMarketTime * 1000).toISOString() : null,
      delayed: result.meta?.regularMarketTime ? Date.now() - result.meta.regularMarketTime * 1000 > 36 * 60 * 60_000 : true,
    };
  } catch (error) {
    return { key, symbol, label, region, error: error.message, current: null };
  }
}

async function getRates() {
  const year = new Date().getUTCFullYear();
  const treasuryUrl = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
  const [effrPayload, treasuryCsv] = await Promise.all([
    fetchJson("https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json", {}, 20_000),
    fetchText(treasuryUrl, {}, 30_000),
  ]);
  const effr = effrPayload.refRates?.[0] || {};
  const lines = treasuryCsv.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((value) => value.replaceAll('"', "").trim());
  const row = lines[1].split(",").map((value) => value.replaceAll('"', "").trim());
  const previousRow = lines[2]?.split(",").map((value) => value.replaceAll('"', "").trim()) || [];
  const record = Object.fromEntries(headers.map((header, index) => [header, row[index]]));
  const previous = Object.fromEntries(headers.map((header, index) => [header, previousRow[index]]));
  const us2y = lastNumber(record["2 Yr"]);
  const us10y = lastNumber(record["10 Yr"]);
  const us30y = lastNumber(record["30 Yr"]);
  return {
    effr: lastNumber(effr.percentRate),
    targetFrom: lastNumber(effr.targetRateFrom),
    targetTo: lastNumber(effr.targetRateTo),
    us2y,
    us10y,
    us30y,
    curve10y2y: us2y != null && us10y != null ? us10y - us2y : null,
    change2yBps: us2y != null && lastNumber(previous["2 Yr"]) != null ? (us2y - Number(previous["2 Yr"])) * 100 : null,
    change10yBps: us10y != null && lastNumber(previous["10 Yr"]) != null ? (us10y - Number(previous["10 Yr"])) * 100 : null,
    change30yBps: us30y != null && lastNumber(previous["30 Yr"]) != null ? (us30y - Number(previous["30 Yr"])) * 100 : null,
    date: record.Date || effr.effectiveDate || null,
    source: "U.S. Treasury · New York Fed",
  };
}

async function getFredSeries(id) {
  const text = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, {}, 30_000);
  return text.trim().split(/\r?\n/).slice(1).map((line) => {
    const [date, raw] = line.split(",");
    return { date, value: lastNumber(raw) };
  }).filter((point) => point.value != null).slice(-14);
}

function weeklyMetric(points) {
  const current = points.at(-1);
  const previous = points.at(-2);
  const monthAgo = points.at(-5);
  return {
    value: current?.value ?? null,
    date: current?.date || null,
    change1w: current && previous ? current.value - previous.value : null,
    change4w: current && monthAgo ? current.value - monthAgo.value : null,
    series: points,
  };
}

async function getFedLiquidity() {
  const [tga, reserves] = await Promise.all([getFredSeries("WTREGEN"), getFredSeries("WRESBAL")]);
  return {
    tga: weeklyMetric(tga),
    bankReserves: weeklyMetric(reserves),
    unit: "USD millions",
    source: "Federal Reserve · FRED",
  };
}

function normalizePositioning(longShortRows, oiRows, source) {
  const longShort = longShortRows.map((row) => ({
    timestamp: Number(row.timestamp), ratio: lastNumber(row.longShortRatio),
    long: lastNumber(row.longAccount), short: lastNumber(row.shortAccount),
  })).filter((row) => row.ratio != null && Number.isFinite(row.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
  const openInterest = oiRows.map((row) => ({
    timestamp: Number(row.timestamp), valueUsd: lastNumber(row.sumOpenInterestValue),
  })).filter((row) => row.valueUsd != null && Number.isFinite(row.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
  return { symbol: "BTCUSDT", period: "4h", longShort, openInterest, source, updatedAt: new Date().toISOString() };
}

async function getBinancePositioning() {
  const base = "https://fapi.binance.com/futures/data";
  const query = "symbol=BTCUSDT&period=4h&limit=42";
  const [longShort, openInterest] = await Promise.all([
    fetchJson(`${base}/globalLongShortAccountRatio?${query}`, {}, 20_000),
    fetchJson(`${base}/openInterestHist?${query}`, {}, 20_000),
  ]);
  return normalizePositioning(longShort, openInterest, "Binance Futures");
}

async function getBybitPositioning() {
  const base = "https://api.bybit.com/v5/market";
  const [ratioPayload, oiPayload, tickerPayload] = await Promise.all([
    fetchJson(`${base}/account-ratio?category=linear&symbol=BTCUSDT&period=4h&limit=42`, {}, 20_000),
    fetchJson(`${base}/open-interest?category=linear&symbol=BTCUSDT&intervalTime=4h&limit=42`, {}, 20_000),
    fetchJson(`${base}/tickers?category=linear&symbol=BTCUSDT`, {}, 20_000),
  ]);
  if (ratioPayload.retCode !== 0 || oiPayload.retCode !== 0 || tickerPayload.retCode !== 0) {
    throw new Error("Bybit returned an API error");
  }
  const price = lastNumber(tickerPayload.result?.list?.[0]?.lastPrice);
  const longShort = (ratioPayload.result?.list || []).map((row) => {
    const long = lastNumber(row.buyRatio);
    const short = lastNumber(row.sellRatio);
    return {
      timestamp: Number(row.timestamp),
      ratio: long != null && short ? long / short : null,
      long,
      short,
    };
  }).filter((row) => row.ratio != null && Number.isFinite(row.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
  const openInterest = (oiPayload.result?.list || []).map((row) => ({
    timestamp: Number(row.timestamp),
    valueUsd: price == null ? null : lastNumber(row.openInterest) * price,
  })).filter((row) => row.valueUsd != null && Number.isFinite(row.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
  return { symbol: "BTCUSDT", period: "4h", longShort, openInterest, source: "Bybit Futures", updatedAt: new Date().toISOString() };
}

export async function getPositioning() {
  return cached("btc-positioning", 5 * 60_000, async () => {
    const loaders = process.env.VERCEL ? [getBybitPositioning, getBinancePositioning] : [getBinancePositioning, getBybitPositioning];
    let lastError;
    for (const loader of loaders) {
      try { return await loader(); }
      catch (error) { lastError = error; }
    }
    throw lastError || new Error("Positioning sources unavailable");
  });
}

async function getEconomicEvents() {
  const payload = await fetchJson("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {}, 20_000);
  const now = Date.now();
  const end = now + 72 * 60 * 60_000;
  const allowed = new Set(["USD", "EUR", "GBP", "JPY", "CNY", "AUD", "NZD", "CAD", "CHF", "All"]);
  return (Array.isArray(payload) ? payload : [])
    .map((event) => ({
      title: event.title,
      currency: event.country,
      datetime: new Date(event.date).toISOString(),
      impact: event.impact,
      forecast: event.forecast || null,
      previous: event.previous || null,
    }))
    .filter((event) => {
      const time = Date.parse(event.datetime);
      return time >= now - 30 * 60_000 && time <= end && allowed.has(event.currency) && ["High", "Medium", "Holiday"].includes(event.impact);
    })
    .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime))
    .slice(0, 18);
}

function buildRegime(assets, rates, events, btc) {
  let score = 0;
  const reasons = [];
  const add = (condition, positive, negative) => {
    if (condition == null) return;
    score += condition ? 1 : -1;
    reasons.push(condition ? positive : negative);
  };
  add(btc?.change24h == null ? null : btc.change24h >= 0, "BTC растёт", "BTC снижается");
  add(assets.nq?.change1d == null ? null : assets.nq.change1d >= 0, "NQ поддерживает риск", "NQ под давлением");
  add(assets.vix?.change1d == null ? null : assets.vix.change1d <= 0, "VIX снижается", "VIX растёт");
  add(assets.dxy?.change1d == null ? null : assets.dxy.change1d <= 0, "DXY ослабевает", "DXY укрепляется");
  add(rates.change2yBps == null ? null : rates.change2yBps <= 0, "US 2Y снижается", "US 2Y растёт");
  const urgent = events.find((event) => event.impact === "High" && Date.parse(event.datetime) - Date.now() <= 8 * 60 * 60_000);
  if (urgent) return { code: "event", label: "EVENT RISK", score, reasons, event: urgent.title };
  if (score >= 3) return { code: "on", label: "RISK-ON", score, reasons };
  if (score <= -3) return { code: "off", label: "RISK-OFF", score, reasons };
  return { code: "mixed", label: "MIXED", score, reasons };
}

export async function getGlobalContext() {
  return cached("global-context", 5 * 60_000, async () => {
    const [assetRows, ratesResult, liquidityResult, eventsResult, prices] = await Promise.all([
      Promise.all(Object.entries(GLOBAL_TICKERS).map(([key, config]) => getYahooAsset(key, config))),
      getRates().catch((error) => ({ error: error.message })),
      getFedLiquidity().catch((error) => ({ error: error.message })),
      getEconomicEvents().catch(() => []),
      getPrices().catch(() => []),
    ]);
    const assets = Object.fromEntries(assetRows.map((asset) => [asset.key, asset]));
    const btc = prices.find((asset) => asset.symbol === "BTC");
    return {
      assets,
      rates: ratesResult,
      liquidity: liquidityResult,
      events: eventsResult,
      regime: buildRegime(assets, ratesResult, eventsResult, btc),
      updatedAt: new Date().toISOString(),
      source: "Yahoo Finance · U.S. Treasury · Federal Reserve/FRED · New York Fed · Forex Factory",
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
  const [prices, fearGreed, onchain, derivatives, global, positioning] = await Promise.all([
    safe("Цены", getPrices, warnings),
    safe("Fear & Greed", getFearGreed, warnings),
    safe("On-chain", getOnchain, warnings),
    safe("Опционы", getDerivatives, warnings),
    safe("Глобальные рынки", getGlobalContext, warnings),
    safe("Фьючерсы BTC", getPositioning, warnings),
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
    global,
    positioning,
    warnings,
  };
}

function fmt(value, digits = 2) {
  return value == null ? "н/д" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value);
}

function sign(value, suffix = "%") {
  return value == null ? "н/д" : `${value >= 0 ? "+" : ""}${fmt(value)}${suffix}`;
}

function htmlEscape(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function briefMessage(data) {
  const btc = data.prices.find((row) => row.symbol === "BTC");
  const eth = data.prices.find((row) => row.symbol === "ETH");
  const o = data.onchain;
  const d = data.derivatives;
  const f = data.fearGreed;
  const g = data.global;
  const a = g?.assets || {};
  const r = g?.rates || {};
  const l = g?.liquidity || {};
  const p = data.positioning;
  const latestRatio = p?.longShort?.at(-1);
  const latestOi = p?.openInterest?.at(-1);
  const eventLines = (g?.events || []).slice(0, 6).map((event) => {
    const time = new Date(event.datetime).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", weekday: "short", hour: "2-digit", minute: "2-digit" });
    const values = [event.forecast ? `прогн. ${event.forecast}` : "", event.previous ? `пред. ${event.previous}` : ""].filter(Boolean).join(" · ");
    return `${event.impact === "High" ? "🔴" : "🟠"} ${time} ${event.currency} — ${htmlEscape(event.title)}${values ? ` (${htmlEscape(values)})` : ""}`;
  });
  return [
    "<b>CRYPTO BRIEF</b>",
    `Обновлено: ${new Date(data.updatedAt).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv" })} Kyiv`,
    g?.regime ? `<b>Режим: ${g.regime.label}</b>${g.regime.event ? ` · ${htmlEscape(g.regime.event)}` : ""}` : "",
    "",
    "<b>События — 72 часа</b>",
    ...(eventLines.length ? eventLines : ["Нет событий высокой/средней важности"]),
    "",
    "<b>Рынок</b>",
    `₿ BTC  $${fmt(btc?.price, 0)}  | 24ч ${sign(btc?.change24h)} | 7д ${sign(btc?.change7d)} | 30д ${sign(btc?.change30d)}`,
    `Ξ ETH  $${fmt(eth?.price, 0)}  | 24ч ${sign(eth?.change24h)} | 7д ${sign(eth?.change7d)} | 30д ${sign(eth?.change30d)}`,
    `Fear & Greed: ${fmt(f?.value, 0)} (${f?.label || "н/д"})`,
    "",
    "<b>Глобальный риск</b>",
    `S&P 500 ${fmt(a.sp500?.current)} (${sign(a.sp500?.change1d)}) | Nasdaq 100 ${fmt(a.nasdaq100?.current)} (${sign(a.nasdaq100?.change1d)})`,
    `ES ${fmt(a.es?.current)} (${sign(a.es?.change1d)}) | NQ ${fmt(a.nq?.current)} (${sign(a.nq?.change1d)})`,
    `DXY ${fmt(a.dxy?.current)} (${sign(a.dxy?.change1d)}) | VIX ${fmt(a.vix?.current)} (${sign(a.vix?.change1d)})`,
    `EFFR ${fmt(r.effr)}% | target ${fmt(r.targetFrom)}–${fmt(r.targetTo)}%`,
    `US 2Y ${fmt(r.us2y)}% (${sign(r.change2yBps, " bps")}) | US 10Y ${fmt(r.us10y)}% (${sign(r.change10yBps, " bps")})`,
    `US 30Y ${fmt(r.us30y)}% (${sign(r.change30yBps, " bps")})`,
    `TGA $${fmt(l.tga?.value == null ? null : l.tga.value / 1000, 1)}B (${sign(l.tga?.change1w == null ? null : l.tga.change1w / 1000, "B нед.")}) | Bank reserves $${fmt(l.bankReserves?.value == null ? null : l.bankReserves.value / 1e6, 2)}T (${sign(l.bankReserves?.change1w == null ? null : l.bankReserves.change1w / 1000, "B нед.")})`,
    `Gold $${fmt(a.gold?.current)} (${sign(a.gold?.change1d)}) | WTI $${fmt(a.wti?.current)} (${sign(a.wti?.change1d)})`,
    `Европа: DAX ${sign(a.dax?.change1d)} | Euro Stoxx ${sign(a.euroStoxx?.change1d)} | FTSE ${sign(a.ftse?.change1d)}`,
    `Азия: Nikkei ${sign(a.nikkei?.change1d)} | Hang Seng ${sign(a.hangSeng?.change1d)} | CSI 300 ${sign(a.csi300?.change1d)}`,
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
    "",
    "<b>BTC Futures</b>",
    `Long/Short accounts: ${fmt(latestRatio?.ratio, 3)} | long ${sign(latestRatio?.long == null ? null : latestRatio.long * 100)} | short ${sign(latestRatio?.short == null ? null : latestRatio.short * 100)}`,
    `Open interest: $${fmt(latestOi?.valueUsd == null ? null : latestOi.valueUsd / 1e9, 2)}B · ${p?.source || "н/д"}`,
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
    if (req.method === "GET" && url.pathname === "/api/global") {
      const warnings = [];
      const global = await safe("Глобальные рынки", getGlobalContext, warnings);
      return json(res, 200, { updatedAt: new Date().toISOString(), global, warnings });
    }
    if (req.method === "GET" && url.pathname === "/api/positioning") {
      const warnings = [];
      const positioning = await safe("Фьючерсы BTC", getPositioning, warnings);
      return json(res, 200, { updatedAt: new Date().toISOString(), positioning, warnings });
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

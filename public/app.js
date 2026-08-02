const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const compactMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function valueClass(value) {
  return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
}

function percent(value) {
  if (value == null) return "н/д";
  return `${value >= 0 ? "+" : ""}${number.format(value)}%`;
}

function num(value, digits = 2) {
  if (value == null) return "н/д";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value);
}

function signed(value, suffix = "") {
  if (value == null) return "н/д";
  return `${value >= 0 ? "+" : ""}${num(value)}${suffix}`;
}

function date(value) {
  return value ? new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "н/д";
}

function eventTime(value) {
  return new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function assetCard(asset) {
  const btc = asset.symbol === "BTC";
  return `<article class="asset-card" style="--accent:${btc ? "#f0b90b" : "#7d9dff"}">
    <div class="asset-head"><span class="coin">${btc ? "₿" : "Ξ"}</span><div><div class="asset-symbol">${asset.symbol}</div><div class="asset-name">${btc ? "Bitcoin" : "Ethereum"}</div></div></div>
    <div class="price">${money.format(asset.price)}</div>
    <div class="periods">
      <span class="period ${valueClass(asset.change24h)}"><small>24 часа</small>${percent(asset.change24h)}</span>
      <span class="period ${valueClass(asset.change7d)}"><small>7 дней</small>${percent(asset.change7d)}</span>
      <span class="period ${valueClass(asset.change30d)}"><small>30 дней</small>${percent(asset.change30d)}</span>
    </div>
  </article>`;
}

function metric(label, value, note, options = {}) {
  return `<article class="metric-card ${options.wide ? "wide" : ""}">
    <div class="metric-label">${label}</div>
    <div class="metric-value ${options.tone || ""}">${value}</div>
    <div class="metric-note">${note}</div>
    ${options.extra || ""}
  </article>`;
}

function render(data) {
  const btc = data.prices.find((row) => row.symbol === "BTC");
  const f = data.fearGreed;
  const o = data.onchain;
  const d = data.derivatives;
  const g = data.global;
  const a = g?.assets || {};
  const r = g?.rates || {};

  const events = g?.events || [];
  $("#events").innerHTML = events.length ? events.map((event) => `<article class="event-row">
    <div class="event-time"><span class="impact ${event.impact === "High" ? "high" : ""}"></span>${eventTime(event.datetime)}</div>
    <div class="event-currency">${esc(event.currency)}</div>
    <div class="event-name">${esc(event.title)}</div>
    <div class="event-values">${event.forecast ? `прогн. <strong>${esc(event.forecast)}</strong>` : ""}${event.previous ? ` · пред. ${esc(event.previous)}` : ""}</div>
  </article>`).join("") : `<article class="event-row"><div class="event-name wide">Нет событий высокой или средней важности в ближайшие 72 часа</div></article>`;

  $("#updated").textContent = `Обновлено ${date(data.updatedAt)} · Kyiv`;
  $("#assets").classList.remove("skeleton-grid");
  $("#assets").innerHTML = data.prices.map(assetCard).join("") || metric("Цены", "н/д", "Источник временно не ответил", { wide: true });

  const fearTone = f?.value >= 60 ? "positive" : f?.value <= 40 ? "negative" : "";
  $("#sentiment").innerHTML = metric(
    "Fear & Greed",
    `${num(f?.value, 0)} <small>${f?.label || ""}</small>`,
    `Вчера: <strong>${num(f?.previous, 0)}</strong> · Alternative.me`,
    { wide: true, tone: fearTone, extra: `<div class="fear-track"><div class="fear-pin" style="margin-left:${f?.value || 0}%"></div></div>` },
  );

  const marketMetric = (label, asset, note = "день / 7д / 30д") => metric(
    label,
    asset?.current == null ? "н/д" : num(asset.current, asset.current < 200 ? 2 : 0),
    `${note}: <strong class="${valueClass(asset?.change1d)}">${percent(asset?.change1d)}</strong> · ${percent(asset?.change7d)} · ${percent(asset?.change30d)}`,
  );
  const regime = g?.regime;
  $("#global").innerHTML = [
    `<article class="metric-card wide regime-card ${esc(regime?.code || "")}"><div class="metric-label">Рыночный режим</div><div class="metric-value">${esc(regime?.label || "н/д")}</div><div class="metric-note">${regime?.event ? `Ближайший риск: <strong>${esc(regime.event)}</strong>` : esc((regime?.reasons || []).slice(0, 4).join(" · "))}</div></article>`,
    marketMetric("S&P 500", a.sp500),
    marketMetric("Nasdaq 100", a.nasdaq100),
    marketMetric("ES Futures", a.es),
    marketMetric("NQ Futures", a.nq),
    marketMetric("DXY", a.dxy),
    marketMetric("VIX", a.vix),
    metric("Ставка ФРС", r.effr == null ? "н/д" : `${num(r.effr)}%`, `Target: <strong>${num(r.targetFrom)}–${num(r.targetTo)}%</strong> · ${r.date || ""}`),
    metric("US 2Y / 10Y", r.us2y == null ? "н/д" : `${num(r.us2y)}% / ${num(r.us10y)}%`, `Δ ${signed(r.change2yBps, " bps")} / ${signed(r.change10yBps, " bps")} · curve ${signed(r.curve10y2y, "%")}`),
    marketMetric("Gold", a.gold),
    marketMetric("WTI", a.wti),
  ].join("");

  const session = (name, items) => `<article class="session-row"><div class="session-name">${name}</div>${items.map(([label, asset]) => `<div class="session-market"><small>${label}</small><span class="${valueClass(asset?.change1d)}">${percent(asset?.change1d)}</span></div>`).join("")}</article>`;
  $("#regions").innerHTML = [
    session("США", [["S&P", a.sp500], ["Nasdaq", a.nasdaq100], ["VIX", a.vix]]),
    session("Европа", [["DAX", a.dax], ["Stoxx", a.euroStoxx], ["FTSE", a.ftse]]),
    session("Азия", [["Nikkei", a.nikkei], ["H. Seng", a.hangSeng], ["CSI 300", a.csi300]]),
    session("FX", [["DXY", a.dxy], ["EUR/USD", a.eurusd], ["USD/JPY", a.usdjpy]]),
  ].join("");

  $("#onchain").innerHTML = [
    metric("MVRV", num(o?.mvrv?.value, 3), "Рыночная капитализация / realized cap"),
    metric("SOPR", num(o?.sopr?.value, 4), o?.sopr?.value >= 1 ? "Монеты в среднем фиксируют прибыль" : "Монеты в среднем фиксируют убыток"),
    metric("Realized price", o?.realizedPrice?.value ? money.format(o.realizedPrice.value) : "н/д", `Средняя цена последнего движения BTC · ${o?.realizedPrice?.date || ""}`),
    metric("Объём BTC 24ч", btc?.volume24h ? compactMoney.format(btc.volume24h) : "н/д", "Агрегированный торговый объём по биржам"),
    metric("Stablecoin flow", signed(o?.stablecoinFlow?.valueUsd ? o.stablecoinFlow.valueUsd / 1e6 : null, " млн $"), "Изменение предложения за сутки — прокси притока ликвидности", { tone: valueClass(o?.stablecoinFlow?.valueUsd) }),
    metric("Bitcoin ETF flows", signed(o?.etfFlow?.valueBtc, " BTC"), `${o?.etfFlow?.estimatedUsd ? `≈ ${compactMoney.format(o.etfFlow.estimatedUsd)} · ` : ""}${o?.etfFlow?.date || ""}`, { tone: valueClass(o?.etfFlow?.valueBtc) }),
  ].join("");

  $("#options").innerHTML = [
    metric("BTC implied volatility", `${num(d?.btcDvol?.value, 1)}`, `DVOL · 24ч ${signed(d?.btcDvol?.change24h, " п.")}`, { tone: valueClass(d?.btcDvol?.change24h) }),
    metric("BTC Put / Call", num(d?.btcPutCall?.oiRatio, 2), `По OI · по объёму ${num(d?.btcPutCall?.volumeRatio, 2)}`),
    metric("ETH implied volatility", `${num(d?.ethDvol?.value, 1)}`, `DVOL · 24ч ${signed(d?.ethDvol?.change24h, " п.")}`, { tone: valueClass(d?.ethDvol?.change24h) }),
    metric("ETH Put / Call", num(d?.ethPutCall?.oiRatio, 2), `По OI · по объёму ${num(d?.ethPutCall?.volumeRatio, 2)}`),
  ].join("");

  const warnings = $("#warnings");
  warnings.hidden = !data.warnings.length;
  warnings.textContent = data.warnings.length ? `Часть данных временно недоступна: ${data.warnings.join(" · ")}` : "";
  $("#status").className = "status";
  $("#status").textContent = data.warnings.length ? "Брифинг собран частично — доступные блоки актуальны" : "Все источники ответили · брифинг актуален";
}

async function load() {
  const button = $("#refresh");
  button.classList.add("busy");
  button.disabled = true;
  try {
    const responses = await Promise.all([
      fetch("/api/market", { cache: "no-store" }),
      fetch("/api/onchain", { cache: "no-store" }),
      fetch("/api/options", { cache: "no-store" }),
      fetch("/api/global", { cache: "no-store" }),
    ]);
    if (responses.some((response) => !response.ok)) throw new Error("Источник временно недоступен");
    const [market, chain, options, globalData] = await Promise.all(responses.map((response) => response.json()));
    const data = {
      updatedAt: market.updatedAt,
      prices: market.prices || [],
      fearGreed: market.fearGreed,
      onchain: chain.onchain,
      derivatives: options.derivatives,
      global: globalData.global,
      warnings: [...(market.warnings || []), ...(chain.warnings || []), ...(options.warnings || []), ...(globalData.warnings || [])],
    };
    const btc = data.prices.find((row) => row.symbol === "BTC");
    if (data.onchain?.etfFlow && btc?.price) data.onchain.etfFlow.estimatedUsd = data.onchain.etfFlow.valueBtc * btc.price;
    render(data);
    tg?.HapticFeedback?.notificationOccurred("success");
  } catch (error) {
    $("#status").className = "status error";
    $("#status").textContent = `${error.message}. Попробуйте обновить через минуту.`;
    tg?.HapticFeedback?.notificationOccurred("error");
  } finally {
    button.classList.remove("busy");
    button.disabled = false;
  }
}

$("#refresh").addEventListener("click", load);
load();

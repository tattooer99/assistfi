const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const compactMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

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
    ]);
    if (responses.some((response) => !response.ok)) throw new Error("Источник временно недоступен");
    const [market, chain, options] = await Promise.all(responses.map((response) => response.json()));
    const data = {
      updatedAt: market.updatedAt,
      prices: market.prices || [],
      fearGreed: market.fearGreed,
      onchain: chain.onchain,
      derivatives: options.derivatives,
      warnings: [...(market.warnings || []), ...(chain.warnings || []), ...(options.warnings || [])],
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

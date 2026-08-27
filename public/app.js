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

function lineChart(label, points, accessor, formatter, options = {}) {
  const values = points.map(accessor).filter((value) => Number.isFinite(value));
  if (values.length < 2) return metric(label, "н/д", "Источник временно не ответил", { wide: true });
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (options.baseline != null) { min = Math.min(min, options.baseline); max = Math.max(max, options.baseline); }
  const padding = Math.max((max - min) * .12, Math.abs(max || 1) * .005);
  min -= padding; max += padding;
  const width = 640; const height = 180; const left = 12; const top = 10; const plotW = width - 24; const plotH = height - 28;
  const xy = points.map((point, index) => ({ x: left + index * plotW / (points.length - 1), y: top + (max - accessor(point)) * plotH / (max - min) }));
  const path = xy.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${path} L${xy.at(-1).x.toFixed(1)},${(top + plotH).toFixed(1)} L${xy[0].x.toFixed(1)},${(top + plotH).toFixed(1)} Z`;
  const baselineY = options.baseline == null ? null : top + (max - options.baseline) * plotH / (max - min);
  const latest = values.at(-1);
  const first = values[0];
  return `<article class="chart-card">
    <div class="chart-head"><div><div class="metric-label">${label}</div><div class="chart-value">${formatter(latest)}</div></div><div class="chart-change ${valueClass(latest - first)}">${options.changeFormatter ? options.changeFormatter(latest, first) : percent((latest / first - 1) * 100)}</div></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
      <defs><linearGradient id="${options.id}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${options.color}" stop-opacity=".28"/><stop offset="1" stop-color="${options.color}" stop-opacity="0"/></linearGradient></defs>
      ${baselineY == null ? "" : `<line x1="${left}" y1="${baselineY}" x2="${width-left}" y2="${baselineY}" class="chart-baseline"/>`}
      <path d="${area}" fill="url(#${options.id}-fill)"/><path d="${path}" fill="none" stroke="${options.color}" stroke-width="3" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="chart-foot"><span>${new Date(points[0].timestamp).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}</span><span>${options.note || ""}</span><span>сейчас</span></div>
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
  const l = g?.liquidity || {};
  const p = data.positioning;

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
    metric("US 30Y yield", r.us30y == null ? "н/д" : `${num(r.us30y)}%`, `День: <strong class="${valueClass(r.change30yBps)}">${signed(r.change30yBps, " bps")}</strong> · U.S. Treasury`),
    metric("TGA", l.tga?.value == null ? "н/д" : `$${num(l.tga.value / 1000, 1)}B`, `Неделя: <strong class="${valueClass(l.tga?.change1w)}">${signed(l.tga?.change1w == null ? null : l.tga.change1w / 1000, "B")}</strong> · ${l.tga?.date || ""}`),
    metric("Bank reserves", l.bankReserves?.value == null ? "н/д" : `$${num(l.bankReserves.value / 1e6, 2)}T`, `Неделя: <strong class="${valueClass(l.bankReserves?.change1w)}">${signed(l.bankReserves?.change1w == null ? null : l.bankReserves.change1w / 1000, "B")}</strong> · ${l.bankReserves?.date || ""}`),
    marketMetric("Gold", a.gold),
    marketMetric("WTI", a.wti),
  ].join("");

  $("#positioning").innerHTML = [
    lineChart("Long / Short accounts", p?.longShort || [], (point) => point.ratio, (value) => num(value, 3), { id: "ls", color: "#7d9dff", baseline: 1, note: "1.0 = баланс", changeFormatter: (latest, first) => signed(latest - first, "") }),
    lineChart("BTC Open Interest", p?.openInterest || [], (point) => point.valueUsd, (value) => compactMoney.format(value), { id: "oi", color: "#f0b90b", note: p?.source || "Binance Futures" }),
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
    const getBlock = async (path, label) => {
      try {
        const response = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(28_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { data: await response.json(), warning: null };
      } catch (error) {
        return { data: {}, warning: `${label}: ${error.name === "TimeoutError" ? "тайм-аут" : error.message}` };
      }
    };
    const [marketResult, chainResult, optionsResult, globalResult, positioningResult] = await Promise.all([
      getBlock("/api/market", "Цены"),
      getBlock("/api/onchain", "On-chain"),
      getBlock("/api/options", "Опционы"),
      getBlock("/api/global", "Глобальные рынки"),
      getBlock("/api/positioning", "Фьючерсы BTC"),
    ]);
    const market = marketResult.data;
    const chain = chainResult.data;
    const options = optionsResult.data;
    const globalData = globalResult.data;
    const positioningData = positioningResult.data;
    const requestWarnings = [marketResult, chainResult, optionsResult, globalResult, positioningResult].map((result) => result.warning).filter(Boolean);
    if (!(market.prices || []).length && !chain.onchain && !options.derivatives && !globalData.global && !positioningData.positioning) {
      throw new Error("Все источники временно недоступны");
    }
    const data = {
      updatedAt: market.updatedAt,
      prices: market.prices || [],
      fearGreed: market.fearGreed,
      onchain: chain.onchain,
      derivatives: options.derivatives,
      global: globalData.global,
      positioning: positioningData.positioning,
      warnings: [...requestWarnings, ...(market.warnings || []), ...(chain.warnings || []), ...(options.warnings || []), ...(globalData.warnings || []), ...(positioningData.warnings || [])],
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


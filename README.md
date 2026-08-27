# Crypto Brief Telegram Mini App

Персональный брифинг BTC и ETH без базы данных и платных обязательных API.

## Что показывает

- BTC и ETH: цена, 24 часа, 7 и 30 дней;
- Fear & Greed;
- MVRV, SOPR и realized price;
- агрегированный торговый объём BTC;
- изменение совокупного предложения стейблкоинов как прокси притока ликвидности;
- Bitcoin ETF flows;
- BTC/ETH DVOL и put/call ratio по OI и объёму.
- графики BTC long/short ratio и открытого интереса за 7 дней с шагом 4 часа;
- S&P 500, Nasdaq 100, ES/NQ futures, DXY и VIX;
- ставка ФРС, US 2Y/10Y/30Y и наклон кривой;
- TGA и банковские резервы ФРС с недельным изменением;
- золото и WTI;
- DAX, Euro Stoxx 50, FTSE 100;
- Nikkei 225, Hang Seng и CSI 300;
- EUR/USD и USD/JPY;
- события высокой и средней важности на ближайшие 72 часа;
- автоматический режим Risk-on, Mixed, Risk-off или Event risk.

## Источники

- CoinGecko — цены и объём;
- Alternative.me — Fear & Greed;
- BGeometrics — ежедневные on-chain показатели, stablecoin supply и ETF flows;
- Deribit — implied volatility и опционный put/call ratio.
- Binance Futures — глобальный long/short ratio аккаунтов и открытый интерес BTC;
- Yahoo Finance — мировые индексы, фьючерсы, FX и сырьё (неофициальный публичный endpoint, возможна задержка);
- U.S. Treasury и Federal Reserve Bank of New York — доходности и ставка;
- Federal Reserve/FRED — TGA и reserve balances;
- Forex Factory weekly JSON — экономический календарь.

BGeometrics Free ограничен 15 запросами в сутки. Приложение кэширует on-chain блок на 12 часов в памяти и в `.cache/onchain.json`. Это обычный временный JSON-файл, не база данных.

## Локальный запуск

Требуется Node.js 22 или новее.

```bash
npm start
```

Откройте `http://localhost:3000`.

## Telegram

Создайте бота через BotFather и задайте переменные окружения по примеру `.env.example`:

- `TELEGRAM_BOT_TOKEN` — токен бота;
- `TELEGRAM_ALLOWED_USER_ID` — ваш Telegram ID; другие пользователи игнорируются;
- `TELEGRAM_WEBHOOK_SECRET` — случайная секретная строка;
- `PUBLIC_URL` — публичный HTTPS-адрес приложения.

После публикации скопируйте `.env.example` в `.env`, заполните значения и один раз выполните:

```bash
npm run set-webhook
```

Команда `/brief` присылает текстовый брифинг и кнопку Mini App.

## Публикация через GitHub и Vercel

Проект подготовлен для Vercel Functions. База данных, постоянный диск и платные дополнения Vercel не нужны.

1. Создайте новый репозиторий GitHub и загрузите в него файлы проекта.
2. В Vercel выберите **Add New → Project** и импортируйте репозиторий.
3. Framework Preset оставьте **Other**. Настройки из `vercel.json` определят папку `public` и serverless-функции из `api`.
4. Добавьте Environment Variables для окружения **Production**:
   - `TELEGRAM_BOT_TOKEN`;
   - `TELEGRAM_ALLOWED_USER_ID`;
   - `TELEGRAM_WEBHOOK_SECRET`;
   - `PUBLIC_URL` — итоговый production URL, например `https://crypto-brief.vercel.app`.
5. Выполните Deploy. После первого деплоя скопируйте production URL, добавьте его как `PUBLIC_URL` и сделайте Redeploy.
6. Локально задайте те же переменные и один раз выполните `npm run set-webhook`. Либо откройте URL Telegram API `setWebhook` вручную.

Webhook будет установлен на:

```text
https://ВАШ-ДОМЕН.vercel.app/telegram/webhook
```

Не добавляйте настоящий `.env` или токен бота в GitHub. В репозиторий загружается только безопасный `.env.example`.

### Кэширование на Vercel

- `/api/market` — 2 минуты;
- `/api/options` — 5 минут;
- `/api/onchain` — 12 часов.
- `/api/global` — 5 минут.
- `/api/positioning` — 5 минут.

Кэш хранится в CDN Vercel, поэтому отдельная база данных не нужна. После каждого нового deployment кэш начинает заполняяться заново.

## Альтернативный сервер

Для обычного Node.js-хостинга оставлен `Dockerfile`. Проверка доступности: `GET /health`.

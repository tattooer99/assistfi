const token = process.env.TELEGRAM_BOT_TOKEN;
const publicUrl = String(process.env.PUBLIC_URL || "").replace(/\/$/, "");
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !publicUrl || !secret) {
  console.error("Заполните TELEGRAM_BOT_TOKEN, PUBLIC_URL и TELEGRAM_WEBHOOK_SECRET");
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: `${publicUrl}/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  }),
});

console.log(await response.text());

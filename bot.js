import axios from "axios";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const CACHE_FILE = "cache.json";
const COOLDOWN_HOURS = 4;

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(data) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

async function sendTelegram(text) {
  await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      chat_id: CHAT_ID,
      text,
      disable_web_page_preview: true
    }
  );
}

async function getCandles(instId, bar) {
  try {
    const url =
      `https://www.okx.com/api/v5/market/history-candles?instId=${instId}&bar=${bar}&limit=2`;

    const res = await axios.get(url);

    if (!res.data?.data || res.data.data.length < 2) {
      return null;
    }

    const latest = parseFloat(res.data.data[0][4]);
    const previous = parseFloat(res.data.data[1][4]);

    return ((latest - previous) / previous) * 100;
  } catch {
    return null;
  }
}

async function main() {
  const cache = loadCache();
  const now = Date.now();

  const tickers = await axios.get(
    "https://www.okx.com/api/v5/market/tickers?instType=SWAP"
  );

  let coins = [];

  for (const t of tickers.data.data) {

    if (!t.instId.endsWith("-USDT-SWAP")) continue;

    const last = parseFloat(t.last);
    const open24h = parseFloat(t.open24h);

    if (!last || !open24h) continue;

    const drop24h = ((last - open24h) / open24h) * 100;

    coins.push({
      instId: t.instId,
      drop24h
    });
  }

  coins.sort((a, b) => a.drop24h - b.drop24h);

  const top10 = coins.slice(0, 10);

  let messages = [];

  for (const coin of top10) {

    const chg15m = await getCandles(coin.instId, "15m");
    const chg4h = await getCandles(coin.instId, "4H");

    if (chg15m === null || chg4h === null) continue;

    // 15m giảm trên 3%
    if (chg15m > -3) continue;

    const diff = chg4h - chg15m;

    if (diff < -5 || diff > 5) continue;

    const symbol = coin.instId;

    if (
      cache[symbol] &&
      now - cache[symbol] < COOLDOWN_HOURS * 60 * 60 * 1000
    ) {
      continue;
    }

    cache[symbol] = now;

    const appLink =
      `https://www.okx.com/trade-swap/${symbol.toLowerCase()}`;

    messages.push(
`🪙 ${symbol}

24H: ${coin.drop24h.toFixed(2)}%
15M: ${chg15m.toFixed(2)}%
4H: ${chg4h.toFixed(2)}%

Future:
${appLink}`
    );
  }

  if (messages.length > 0) {
    await sendTelegram(messages.join("\n\n====================\n\n"));
  }

  saveCache(cache);
}

main().catch(console.error);

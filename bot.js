import axios from "axios";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN || "BOT_TOKEN";
const CHAT_ID = process.env.CHAT_ID || "CHAT_ID";

const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

const CACHE_FILE = "./sent_cache.json";
const CACHE_EXPIRE = 2 * 60 * 60 * 1000; // 2 giờ

// ===============================
// Cache
// ===============================
function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return {};

  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function canSend(cache, symbol) {
  const now = Date.now();

  if (!cache[symbol]) return true;

  return now - cache[symbol] > CACHE_EXPIRE;
}

function markSent(cache, symbol) {
  cache[symbol] = Date.now();
}

// ===============================
// Telegram
// ===============================
async function sendTelegram(text) {
  try {
    await axios.post(TELEGRAM_URL, {
      chat_id: CHAT_ID,
      text,
      disable_web_page_preview: true
    });
  } catch (e) {
    console.log("Telegram Error:", e.message);
  }
}

// ===============================
// OKX API
// ===============================
async function getTickers() {
  const res = await axios.get(
    "https://www.okx.com/api/v5/market/tickers?instType=SWAP"
  );

  return res.data.data;
}

async function getCandles(symbol) {
  const res = await axios.get(
    "https://www.okx.com/api/v5/market/candles",
    {
      params: {
        instId: symbol,
        bar: "5m",
        limit: 2
      }
    }
  );

  return res.data.data;
}

// ===============================
// Main
// ===============================
async function main() {
  try {
    const cache = loadCache();

    // Xóa cache quá 2h
    const now = Date.now();

    for (const s in cache) {
      if (now - cache[s] > CACHE_EXPIRE) {
        delete cache[s];
      }
    }

    // Lấy toàn bộ ticker
    const tickers = await getTickers();

    // Top 50 coin biến động mạnh nhất 24h
    const top50 = tickers
      .filter(t => Number(t.volCcy24h) > 0)
      .sort(
        (a, b) =>
          Math.abs(Number(b.change24h)) - Math.abs(Number(a.change24h))
      )
      .slice(0, 50);

    for (const coin of top50) {
      const symbol = coin.instId;

      const change24 =
        (Number(coin.last) - Number(coin.open24h)) /
        Number(coin.open24h) *
        100;

      // Điều kiện tăng 24h >30%
      if (change24 <= 30) continue;

      const candles = await getCandles(symbol);

      if (candles.length < 2) continue;

      const current = candles[0];
      const previous = candles[1];

      const open5 = Number(previous[1]);
      const close5 = Number(current[4]);

      const change5 = ((close5 - open5) / open5) * 100;

      // Điều kiện giảm 5 phút <-3%
      if (change5 > -3) continue;

      if (!canSend(cache, symbol)) continue;

      const msg =
`SELL

Coin: ${symbol}

5m: ${change5.toFixed(2)}%
24h: ${change24.toFixed(2)}%

https://www.okx.com/trade-swap/${symbol.toLowerCase().replace(/-/g, "-")}`;

      await sendTelegram(msg);

      markSent(cache, symbol);

      console.log(symbol, "sent");

      // chống spam Telegram
      await new Promise(r => setTimeout(r, 500));
    }

    saveCache(cache);
  } catch (e) {
    console.log(e.message);
  }
}

main();

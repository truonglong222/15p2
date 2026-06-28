import axios from "axios";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN || "BOT_TOKEN";
const CHAT_ID = process.env.CHAT_ID || "CHAT_ID";

const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
const CACHE_FILE = "./sent_cache.json";

const OKX_TICKERS =
  "https://www.okx.com/api/v5/market/tickers?instType=SWAP";
const OKX_CANDLES =
  "https://www.okx.com/api/v5/market/history-candles";

// =============================
// Cache
// =============================
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

const cache = loadCache();

// =============================
// Telegram
// =============================
async function sendTelegram(text) {
  await axios.post(TELEGRAM_URL, {
    chat_id: CHAT_ID,
    text,
    parse_mode: "HTML",
  });
}

// =============================
// Main
// =============================
async function main() {
  try {
    // Lấy toàn bộ future
    const tickers = (await axios.get(OKX_TICKERS)).data.data;

    // Top 50 coin biến động mạnh nhất 24h
    const top50 = tickers
      .filter((x) => x.last && x.open24h)
      .map((x) => ({
        instId: x.instId,
        change24h:
          Math.abs(
            ((Number(x.last) - Number(x.open24h)) / Number(x.open24h)) * 100
          ),
      }))
      .sort((a, b) => b.change24h - a.change24h)
      .slice(0, 50);

    const now = Date.now();

    for (const coin of top50) {
      try {
        const res = await axios.get(OKX_CANDLES, {
          params: {
            instId: coin.instId,
            bar: "1m",
            limit: 6,
          },
        });

        const candles = res.data.data;

        if (candles.length < 6) continue;

        // Sắp xếp từ cũ -> mới
        candles.reverse();

        const open = Number(candles[0][1]); // open cây đầu
        const close = Number(candles[5][4]); // close cây cuối

        const change5m = ((close - open) / open) * 100;

        // Điều kiện giảm >3%
        if (change5m < -3) {
          const lastSent = cache[coin.instId] || 0;

          // Không gửi lại trong 2 giờ
          if (now - lastSent < 2 * 60 * 60 * 1000) continue;

          const msg =
            `🔴 <b>SELL</b>\n\n` +
            `<b>${coin.instId}</b>\n` +
            `5m: ${change5m.toFixed(2)}%\n` +
            `24h Volatility: ${coin.change24h.toFixed(2)}%`;

          await sendTelegram(msg);

          cache[coin.instId] = now;
        }
      } catch (e) {
        console.log("Skip", coin.instId);
      }
    }

    saveCache(cache);
  } catch (err) {
    console.error(err.message);
  }
}

main();

/**
 * /api/scan.js — Baccarat Road Monitor v3
 * ✅ Không dùng Puppeteer/Chromium
 * ✅ Chạy được trên Vercel, Railway, Render, VPS
 * ✅ Gọi thẳng API platform bằng fetch
 */

const LOGIN_URL = `ufd.intplaynet.com/player/login/apiLogin0?agentId=wg2868&x=9Dm_ncBZSZANbiKbdZh1NtmVDU0f_rbVJwSsknGcT6p59LrwkJeuesl51Gt8Q9XSQNh23Jz1UaWbP9tRNNe1x13y8lb7yFbhgwBVZK9Kw1_UggHBreI0_Xb-3XRshvByXzH6QG4ZYwTqFbWsPNw0KfTMV7or0YqDMtuJjWsz7r_3ItqO8jYvuAZjrLG4lqhvsEVNB9o89Hxjeyq30m-Y2GTHygk3m6xxo2JnzEzBfsTnvLHzu0BUH6Hs-jUmmii7XilWiNVm3OT1DX-tC5yQ7FrHUOgJ7PRueJzvqRMMuyXwe9Wi1oy_Lu-Hg_CZCMcxqTEkfVvgmvbv7_YradU3gtHOgDZzRK9PnRpG8c54ek8mjLNIrebC05CHBrcMOG2iexj2Xiy2xyrAw2GUrNWxbSQDNbi_-ugdk3O3o1wC16o'
const BASE = 'https://bpweb.grteud.com';
const TG   = 'https://api.telegram.org/bot';

// ─── In-memory cooldown ────────────────────────────────────
const cooldownMap = new Map();
function isCooldown(key, sec) {
  const t = cooldownMap.get(key);
  return t && (Date.now() - t) / 1000 < sec;
}
function setCooldown(key) { cooldownMap.set(key, Date.now()); }

// ─── Login → lấy cookie session ───────────────────────────
async function doLogin() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'vi-VN,vi;q=0.9',
    'Referer': BASE + '/',
  };

  // Bước 1: GET login URL → nhận redirect + set-cookie
  const r1 = await fetch(LOGIN_URL, { headers, redirect: 'manual' });
  
  // Thu thập tất cả cookie từ response
  let cookies = '';
  const rawCookies = r1.headers.raw?.()?.['set-cookie'] || [];
  if (rawCookies.length) {
    cookies = rawCookies.map(c => c.split(';')[0]).join('; ');
  } else {
    // Node fetch fallback
    const sc = r1.headers.get('set-cookie');
    if (sc) cookies = sc.split(';')[0];
  }

  // Nếu có redirect location thì follow
  const location = r1.headers.get('location');
  if (location) {
    const r2 = await fetch(location.startsWith('http') ? location : BASE + location, {
      headers: { ...headers, Cookie: cookies },
      redirect: 'manual',
    });
    const sc2 = r2.headers.get('set-cookie');
    if (sc2) {
      const extra = sc2.split(';')[0];
      cookies = cookies ? cookies + '; ' + extra : extra;
    }
  }

  return cookies;
}

// ─── Lấy danh sách bàn + lịch sử cầu ─────────────────────
async function fetchTables(cookies) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': BASE + '/player/webMain.jsp',
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': cookies,
  };

  // Thử nhiều endpoint phổ biến của platform Sexy/AE Sexy
  const endpoints = [
    '/api/player/MexAWS081/getTableList?dm=1&gameType=1',
    '/api/player/MexAWS081/lobby?dm=1',
    '/api/player/MexAWS081/gameList?dm=1',
    '/api/MexAWS081/getTableList?dm=1',
    '/webapi/getTableList?dm=1&cafeid=wg2868',
    '/api/player/MexAWS081/baccaratList?dm=1',
  ];

  for (const ep of endpoints) {
    try {
      const r = await fetch(BASE + ep, { headers });
      if (!r.ok) continue;
      const text = await r.text();
      if (!text || text.trim()[0] !== '{' && text.trim()[0] !== '[') continue;
      const json = JSON.parse(text);
      const list = extractTableList(json);
      if (list && list.length > 0) return { list, endpoint: ep };
    } catch {}
  }

  return { list: [], endpoint: null };
}

// ─── Extract table list từ nhiều format JSON khác nhau ────
function extractTableList(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  for (const key of ['data', 'tables', 'list', 'result', 'gameList', 'tableList']) {
    if (json[key] && Array.isArray(json[key])) return json[key];
  }
  return [];
}

// ─── Phân tích cầu từ lịch sử kết quả ─────────────────────
// Kết quả: 1=Banker, 2=Player, 3=Tie (hoặc 'B','P','T')
function analyzeRoad(raw) {
  if (!raw || raw.length === 0) return null;

  // Normalize về 'B', 'P', 'T'
  const results = raw.map(r => {
    if (r === 1 || r === '1' || (typeof r === 'string' && r.toUpperCase().startsWith('B'))) return 'B';
    if (r === 2 || r === '2' || (typeof r === 'string' && r.toUpperCase().startsWith('P'))) return 'P';
    return 'T';
  });

  // Lọc Tie để phân tích
  const noTie = results.filter(r => r !== 'T');
  if (noTie.length < 4) return null;

  // ── Kiểm tra cầu bệt (streak >= 3) ──
  const last = noTie[noTie.length - 1];
  let streakCount = 0;
  for (let i = noTie.length - 1; i >= 0; i--) {
    if (noTie[i] === last) streakCount++;
    else break;
  }
  if (streakCount >= 3) {
    const side = last === 'B' ? 'Cái' : 'Con';
    return {
      type: 'bet',
      label: `Cầu bệt ${side} ${streakCount} lần`,
      count: streakCount,
      side: last,
      emoji: last === 'B' ? '🔴' : '🔵',
    };
  }

  // ── Kiểm tra cầu 1-1 (ping-pong >= 4 lần xen kẽ) ──
  let pingCount = 1;
  for (let i = noTie.length - 1; i >= 1; i--) {
    if (noTie[i] !== noTie[i - 1]) pingCount++;
    else break;
  }
  if (pingCount >= 4) {
    return {
      type: '1-1',
      label: `Cầu 1-1 (${pingCount} lần)`,
      count: pingCount,
      side: null,
      emoji: '🔁',
    };
  }

  return null;
}

// ─── Parse table object → tên + lịch sử ──────────────────
function parseTable(t) {
  const name =
    t.tableName || t.name || t.tableCode || t.code ||
    t.tableId   || t.id   || 'Unknown';

  // Tìm mảng lịch sử trong các key phổ biến
  const histKeys = ['history', 'results', 'roadMap', 'shoeHistory',
                    'gameResults', 'gameHistory', 'bead', 'beadRoad',
                    'bigRoad', 'records'];
  let history = [];
  for (const k of histKeys) {
    if (t[k] && Array.isArray(t[k]) && t[k].length > 0) {
      history = t[k];
      break;
    }
  }

  // Nếu lịch sử là mảng object, lấy trường winner/result
  if (history.length > 0 && typeof history[0] === 'object') {
    history = history.map(h =>
      h.winner ?? h.result ?? h.outcome ?? h.w ?? h.gameResult ?? 0
    );
  }

  return { name: String(name), history };
}

// ─── Telegram ─────────────────────────────────────────────
async function sendTelegram(token, chatId, text) {
  try {
    await fetch(`${TG}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch {}
}

// ─── Format kết quả hiển thị ──────────────────────────────
function fmtResults(history, max = 20) {
  return history.slice(-max).map(r => {
    const v = r === 1 || r === '1' || r === 'B' || r === 'b' ? '🔴'
            : r === 2 || r === '2' || r === 'P' || r === 'p' ? '🔵' : '🟡';
    return v;
  }).join('');
}

// ─── MAIN HANDLER ─────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tgToken    = req.query.token    || process.env.TELEGRAM_BOT_TOKEN || '';
  const tgChatId   = req.query.chatId   || process.env.TELEGRAM_CHAT_ID   || '';
  const cooldownSec = parseInt(req.query.cooldown || process.env.COOLDOWN_SEC || '120');

  const report = {
    timestamp: new Date().toISOString(),
    tablesScanned: 0,
    hotTables: [],
    alertsSent: 0,
    endpoint: null,
    errors: [],
  };

  try {
    // 1. Đăng nhập
    const cookies = await doLogin();

    // 2. Lấy danh sách bàn
    const { list, endpoint } = await fetchTables(cookies);
    report.endpoint   = endpoint;
    report.tablesScanned = list.length;

    if (list.length === 0) {
      report.errors.push('Không lấy được danh sách bàn. Có thể session hết hạn hoặc endpoint thay đổi.');
    }

    // 3. Phân tích từng bàn
    const hotList = [];
    for (const raw of list) {
      const { name, history } = parseTable(raw);
      if (history.length < 4) continue;

      const road = analyzeRoad(history);
      if (!road) continue;

      hotList.push({
        tableName: name,
        roadType: road.type,
        label: road.label,
        count: road.count,
        side: road.side,
        emoji: road.emoji,
        results: fmtResults(history),
        onCooldown: isCooldown(name, cooldownSec),
      });
    }

    report.hotTables = hotList;

    // 4. Gửi Telegram (chỉ bàn chưa cooldown)
    const toAlert = hotList.filter(t => !t.onCooldown);

    if (toAlert.length > 0 && tgToken && tgChatId) {
      const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

      // Gửi từng bàn riêng để dễ đọc
      for (const t of toAlert) {
        const msg =
          `${t.emoji} <b>${t.label}</b>\n` +
          `📍 Bàn: <b>${t.tableName}</b>\n` +
          `🎴 ${t.results}\n` +
          `🕐 ${now}`;
        await sendTelegram(tgToken, tgChatId, msg);
        setCooldown(t.tableName);
        report.alertsSent++;
      }

      // Gửi tổng kết nếu nhiều hơn 1 bàn
      if (toAlert.length > 1) {
        const summary =
          `📊 <b>TỔNG KẾT — ${now}</b>\n` +
          `🔍 Đã quét: <b>${report.tablesScanned}</b> bàn\n` +
          `⚡ Cầu hot: <b>${toAlert.length}</b> bàn\n\n` +
          toAlert.map(t => `${t.emoji} ${t.tableName} — ${t.label}`).join('\n');
        await sendTelegram(tgToken, tgChatId, summary);
      }
    }

  } catch (e) {
    report.errors.push(e.message);
  }

  return res.status(200).json(report);
};

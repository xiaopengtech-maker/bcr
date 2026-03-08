/**
 * /api/scan.js — Baccarat Road Monitor v3.1
 * ✅ Không dùng Puppeteer — pure fetch
 * ✅ loginUrl truyền qua header X-Login-Url (tránh double-encode)
 * ✅ Chạy được Vercel, Railway, Render, VPS
 */

const DEFAULT_LOGIN_URL = 'https://bpweb.grteud.com/api/player/MexAWS081/login?user=f572868agent190563002&key=2YUbKDU3UtQoIKq%2FO6oOLOCYQLfXNdQj1p023AxRBEduc7zOQXHKsOPF%2BkMellAC&language=vn&showSymbol=true&balance=0.000&dm=1&cafeid=wg2868&reverseBPColor=false&allowHedgeBetting=false&isInternal=0&extension2=f57&extension3=sc88.com&loginIp=42.114.185.31&sgt=1&userName=2868agent190563002';

const TG = 'https://api.telegram.org/bot';

// ─── Cooldown ──────────────────────────────────────────────
const cooldownMap = new Map();
function isCooldown(key, sec) {
  const t = cooldownMap.get(key);
  return t ? (Date.now() - t) / 1000 < sec : false;
}
function setCooldown(key) { cooldownMap.set(key, Date.now()); }

// ─── Lấy base origin an toàn ──────────────────────────────
function getBase(url) {
  try { return new URL(url).origin; }
  catch { return 'https://bpweb.grteud.com'; }
}

// ─── Login ────────────────────────────────────────────────
async function doLogin(loginUrl) {
  const base = getBase(loginUrl);
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';

  let cookies = '';

  try {
    // follow redirect tự động, thu cookie từ mỗi bước
    const r = await fetch(loginUrl, {
      method: 'GET',
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        'Referer': base + '/',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',   // follow redirect bình thường
    });

    // Lấy cookie từ final response (Vercel Node không expose redirect cookies)
    const sc = r.headers.get('set-cookie');
    if (sc) {
      // parse multi-cookie header
      cookies = sc.split(/,(?=[^ ])/).map(c => c.split(';')[0].trim()).join('; ');
    }

    // Nếu response là JSON chứa token/sessionId thì lưu luôn
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('json')) {
      try {
        const json = await r.json();
        // Một số platform trả về token trong body
        const token = json.token || json.sessionId || json.sid || json.jsessionid;
        if (token) cookies = cookies ? `${cookies}; token=${token}` : `token=${token}`;
        // Trả về cả json để dùng sau
        return { cookies, base, loginData: json };
      } catch {}
    }
  } catch (e) {
    // ignore, trả cookies rỗng để vẫn thử fetchTables
  }

  return { cookies, base, loginData: null };
}

// ─── Fetch danh sách bàn ──────────────────────────────────
async function fetchTables(cookies, base, loginData) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'vi-VN,vi;q=0.9',
    'Referer': base + '/player/webMain.jsp?dm=1&title=1',
    'X-Requested-With': 'XMLHttpRequest',
    'Cache-Control': 'no-cache',
  };
  if (cookies) headers['Cookie'] = cookies;

  // Nếu loginData có token dùng làm Bearer
  const bearerToken = loginData?.token || loginData?.accessToken;
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

  const endpoints = [
    `${base}/api/player/MexAWS081/getTableList?dm=1&gameType=1`,
    `${base}/api/player/MexAWS081/getTableList?dm=1`,
    `${base}/api/player/MexAWS081/lobby?dm=1`,
    `${base}/api/player/MexAWS081/gameList?dm=1`,
    `${base}/api/MexAWS081/getTableList?dm=1`,
    `${base}/webapi/getTableList?dm=1`,
    `${base}/api/player/MexAWS081/baccaratList?dm=1`,
  ];

  const tried = [];
  for (const url of endpoints) {
    tried.push(url);
    try {
      const r = await fetch(url, { headers });
      const text = await r.text();
      if (!text) continue;
      const t = text.trim();
      if (t[0] !== '{' && t[0] !== '[') continue;
      const json = JSON.parse(t);
      const list = extractList(json);
      if (list.length > 0) return { list, endpoint: url, tried };
    } catch {}
  }

  return { list: [], endpoint: null, tried };
}

function extractList(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  for (const k of ['data','tables','list','result','gameList','tableList','items']) {
    if (Array.isArray(json[k]) && json[k].length > 0) return json[k];
  }
  // Đệ quy 1 cấp
  for (const k of Object.keys(json)) {
    if (Array.isArray(json[k]) && json[k].length > 2) return json[k];
  }
  return [];
}

// ─── Parse bàn ────────────────────────────────────────────
function parseTable(t) {
  const name = String(t.tableName || t.name || t.tableCode || t.code || t.tableId || t.id || 'Unknown');
  const histKeys = ['history','results','roadMap','shoeHistory','gameResults','gameHistory','bead','beadRoad','bigRoad','records','gameRecord'];
  let history = [];
  for (const k of histKeys) {
    if (Array.isArray(t[k]) && t[k].length > 0) { history = t[k]; break; }
  }
  if (history.length > 0 && typeof history[0] === 'object' && history[0] !== null) {
    history = history.map(h => h.winner ?? h.result ?? h.outcome ?? h.w ?? h.gameResult ?? 0);
  }
  return { name, history };
}

// ─── Phân tích cầu ────────────────────────────────────────
function analyzeRoad(raw) {
  if (!raw || raw.length < 4) return null;

  const norm = raw.map(r => {
    if (r === 1 || r === '1' || r === 'B' || r === 'b' || r === 'banker') return 'B';
    if (r === 2 || r === '2' || r === 'P' || r === 'p' || r === 'player') return 'P';
    return 'T';
  });

  const noTie = norm.filter(r => r !== 'T');
  if (noTie.length < 4) return null;

  // Cầu bệt >= 3
  const last = noTie[noTie.length - 1];
  let streak = 0;
  for (let i = noTie.length - 1; i >= 0; i--) {
    if (noTie[i] === last) streak++;
    else break;
  }
  if (streak >= 3) {
    return {
      type: 'bet',
      label: `Cầu bệt ${last === 'B' ? 'Cái' : 'Con'} ${streak} lần`,
      count: streak, side: last,
      emoji: last === 'B' ? '🔴' : '🔵',
    };
  }

  // Cầu 1-1 >= 4
  let ping = 1;
  for (let i = noTie.length - 1; i >= 1; i--) {
    if (noTie[i] !== noTie[i-1]) ping++;
    else break;
  }
  if (ping >= 4) {
    return { type: '1-1', label: `Cầu 1-1 (${ping} lần)`, count: ping, side: null, emoji: '🔁' };
  }

  return null;
}

// ─── Format hiển thị ──────────────────────────────────────
function fmtResults(history, max = 20) {
  return history.slice(-max).map(r => {
    if (r === 1 || r === '1' || r === 'B' || r === 'b') return '🔴';
    if (r === 2 || r === '2' || r === 'P' || r === 'p') return '🔵';
    return '🟡';
  }).join('');
}

// ─── Telegram ─────────────────────────────────────────────
async function sendTG(token, chatId, text) {
  try {
    const r = await fetch(`${TG}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    return r.ok;
  } catch { return false; }
}

// ─── MAIN HANDLER ─────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Login-Url');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // loginUrl: ưu tiên header (an toàn hơn query vì không bị encode), rồi query, rồi env
  const loginUrl    = req.headers['x-login-url']
                   || req.query.loginUrl
                   || process.env.LOGIN_URL
                   || DEFAULT_LOGIN_URL;

  const tgToken     = req.query.token   || process.env.TELEGRAM_BOT_TOKEN || '';
  const tgChatId    = req.query.chatId  || process.env.TELEGRAM_CHAT_ID   || '';
  const cooldownSec = parseInt(req.query.cooldown || process.env.COOLDOWN_SEC || '120');

  const report = {
    timestamp: new Date().toISOString(),
    tablesScanned: 0,
    hotTables: [],
    alertsSent: 0,
    endpoint: null,
    triedEndpoints: [],
    errors: [],
  };

  try {
    // 1. Login
    const { cookies, base, loginData } = await doLogin(loginUrl);

    // 2. Fetch bàn
    const { list, endpoint, tried } = await fetchTables(cookies, base, loginData);
    report.endpoint        = endpoint;
    report.triedEndpoints  = tried;
    report.tablesScanned   = list.length;

    if (list.length === 0) {
      report.errors.push('Không lấy được danh sách bàn. Đã thử: ' + tried.length + ' endpoint. Có thể session hết hạn.');
    }

    // 3. Phân tích
    const hotList = [];
    for (const raw of list) {
      const { name, history } = parseTable(raw);
      if (history.length < 4) continue;
      const road = analyzeRoad(history);
      if (!road) continue;
      hotList.push({
        tableName:  name,
        roadType:   road.type,
        label:      road.label,
        count:      road.count,
        side:       road.side,
        emoji:      road.emoji,
        results:    fmtResults(history),
        onCooldown: isCooldown(name, cooldownSec),
      });
    }
    report.hotTables = hotList;

    // 4. Gửi Telegram
    const toAlert = hotList.filter(t => !t.onCooldown);
    if (toAlert.length > 0 && tgToken && tgChatId) {
      const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      for (const t of toAlert) {
        const ok = await sendTG(tgToken, tgChatId,
          `${t.emoji} <b>${t.label}</b>\n📍 Bàn: <b>${t.tableName}</b>\n🎴 ${t.results}\n🕐 ${now}`
        );
        if (ok) { setCooldown(t.tableName); report.alertsSent++; }
      }
      if (toAlert.length > 1) {
        await sendTG(tgToken, tgChatId,
          `📊 <b>TỔNG KẾT — ${now}</b>\n🔍 Đã quét: <b>${report.tablesScanned}</b> bàn\n⚡ Cầu hot: <b>${toAlert.length}</b>\n\n` +
          toAlert.map(t => `${t.emoji} ${t.tableName} — ${t.label}`).join('\n')
        );
      }
    }

  } catch (e) {
    report.errors.push(e.message + (e.stack ? ' | ' + e.stack.split('\n')[1]?.trim() : ''));
  }

  return res.status(200).json(report);
};

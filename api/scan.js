/**
 * /api/scan.js
 * 
 * Dùng Puppeteer để:
 * 1. Đăng nhập vào platform
 * 2. Lấy danh sách bàn
 * 3. Screenshot vùng badge màu vàng (tên cầu) của mỗi bàn
 * 4. Dùng Claude Vision để đọc text cầu
 * 5. Nếu phát hiện cầu 1-1 hoặc cầu bệt → gửi Telegram
 */

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const LOGIN_URL = `https://bpweb.grteud.com/api/player/MexAWS081/login?user=f572868agent190563002&key=2YUbKDU3UtQoIKq%2FO6oOLOCYQLfXNdQj1p023AxRBEduc7zOQXHKsOPF%2BkMellAC&language=vn&showSymbol=true&balance=0.000&dm=1&cafeid=wg2868&reverseBPColor=false&allowHedgeBetting=false&isInternal=0&extension2=f57&extension3=sc88.com&loginIp=42.114.185.31&sgt=1&userName=2868agent190563002`;

const LOBBY_URL = `https://bpweb.grteud.com/player/webMain.jsp?dm=1&title=1`;

const TELEGRAM_API = `https://api.telegram.org/bot`;

// In-memory cooldown (per serverless instance)
const cooldownMap = new Map();

function isCooldown(key, sec = 120) {
  const t = cooldownMap.get(key);
  if (!t) return false;
  return (Date.now() - t) / 1000 < sec;
}
function setCooldown(key) { cooldownMap.set(key, Date.now()); }

// ─── Telegram ──────────────────────────────────────────────
async function sendTelegram(token, chatId, text) {
  const r = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
  return r.json();
}

async function sendPhoto(token, chatId, base64, caption) {
  // Gửi ảnh dạng multipart
  const blob = Buffer.from(base64, 'base64');
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  form.append('photo', new Blob([blob], { type: 'image/png' }), 'table.png');
  const r = await fetch(`${TELEGRAM_API}${token}/sendPhoto`, { method: 'POST', body: form });
  return r.json();
}

// ─── Claude Vision - đọc text badge cầu ───────────────────
async function readBadgeText(base64Image, anthropicKey) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: base64Image }
          },
          {
            type: 'text',
            text: `Đây là badge cầu Baccarat. Hãy đọc chính xác text trong ô màu vàng/cam. 
Chỉ trả lời đúng text đó, không giải thích thêm. 
Ví dụ: "Cầu 1-1", "Cầu bệt", "Cầu bệt Cái", "Cầu nghiêng Cái", "Cầu đỉnh Con", v.v.
Nếu không thấy badge vàng, trả lời: NONE`
          }
        ]
      }]
    })
  });
  const data = await r.json();
  return data?.content?.[0]?.text?.trim() || 'NONE';
}

// ─── Phân loại cầu từ text ─────────────────────────────────
function classifyRoad(text) {
  if (!text || text === 'NONE') return null;
  const t = text.toLowerCase();
  
  if (t.includes('1-1') || t.includes('1 1') || t.includes('ping')) {
    return { type: '1-1', label: text };
  }
  if (t.includes('bệt')) {
    return { type: 'bet', label: text };
  }
  return null; // cầu khác không cần alert
}

// ─── Main handler ──────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.query.token || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = req.query.chatId || process.env.TELEGRAM_CHAT_ID;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const cooldownSec = parseInt(req.query.cooldown || process.env.COOLDOWN_SEC || '120');

  const report = {
    timestamp: new Date().toISOString(),
    tablesScanned: 0,
    alerts: [],
    errors: [],
  };

  let browser;
  try {
    // 1. Launch Puppeteer
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

    // 2. Đăng nhập
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // 3. Vào lobby
    await page.goto(LOBBY_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(3000);

    // 4. Tìm tất cả bàn baccarat
    // Badge cầu thường có class chứa "road" hoặc style màu vàng (#f0c040, gold, yellow)
    const tables = await page.evaluate(() => {
      const result = [];
      
      // Tìm các container bàn
      const allElements = document.querySelectorAll('[class*="table"], [class*="game"], [class*="baccarat"]');
      
      allElements.forEach((el, idx) => {
        // Tìm badge màu vàng bên trong
        const badges = el.querySelectorAll('[class*="road"], [class*="badge"], [class*="tag"], [class*="label"]');
        const tableName = el.querySelector('[class*="name"], [class*="title"], h3, h4')?.textContent?.trim();
        
        badges.forEach(badge => {
          const style = window.getComputedStyle(badge);
          const bg = style.backgroundColor;
          // Kiểm tra màu vàng/cam
          if (bg && (bg.includes('255, 193') || bg.includes('240, 192') || bg.includes('255, 215') || bg.includes('243, 156'))) {
            const rect = badge.getBoundingClientRect();
            if (rect.width > 10 && rect.height > 10) {
              result.push({
                idx,
                tableName: tableName || `Bàn ${idx}`,
                badgeRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
                text: badge.textContent?.trim(),
              });
            }
          }
        });
      });
      
      return result;
    });

    // 5. Nếu không tìm được qua DOM, screenshot toàn bộ và tìm badge vàng
    if (tables.length === 0) {
      // Thử cách khác: tìm tất cả element có text "Cầu"
      const cauElements = await page.evaluate(() => {
        const result = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
          if (node.textContent.includes('Cầu') || node.textContent.includes('cầu')) {
            const el = node.parentElement;
            const rect = el.getBoundingClientRect();
            if (rect.width > 20 && rect.height > 10 && rect.width < 300) {
              // Lấy thêm context: tên bàn ở gần đó
              const container = el.closest('[class*="table"], [class*="game"], [class*="item"], [class*="card"]');
              const nameEl = container?.querySelector('[class*="name"], [class*="title"], p, span');
              result.push({
                text: el.textContent.trim(),
                tableName: nameEl?.textContent?.trim() || 'Unknown',
                rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
                containerRect: container ? (() => {
                  const r = container.getBoundingClientRect();
                  return { x: r.x, y: r.y, w: r.width, h: r.height };
                })() : null,
              });
            }
          }
        }
        return result;
      });

      report.tablesScanned = cauElements.length;

      for (const item of cauElements) {
        const road = classifyRoad(item.text);
        if (!road) continue;
        if (isCooldown(item.tableName, cooldownSec)) continue;

        // Screenshot vùng badge hoặc toàn bàn
        const clipRect = item.containerRect || item.rect;
        let screenshotB64 = null;
        try {
          screenshotB64 = await page.screenshot({
            encoding: 'base64',
            clip: {
              x: Math.max(0, clipRect.x),
              y: Math.max(0, clipRect.y),
              width: Math.min(clipRect.w, 400),
              height: Math.min(clipRect.h, 200),
            }
          });
        } catch {}

        const alert = {
          tableName: item.tableName,
          roadType: road.type,
          label: road.label,
          text: item.text,
        };
        report.alerts.push(alert);
        setCooldown(item.tableName);

        // Gửi Telegram
        if (token && chatId) {
          const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
          const emoji = road.type === '1-1' ? '🔁' : '🔥';
          const msg = `${emoji} <b>${road.label}</b>\n📍 Bàn: <b>${item.tableName}</b>\n🕐 ${now}`;
          
          if (screenshotB64) {
            await sendPhoto(token, chatId, screenshotB64, msg.replace(/<[^>]+>/g, ''));
          } else {
            await sendTelegram(token, chatId, msg);
          }
        }
      }
    } else {
      // Xử lý kết quả từ DOM scan
      report.tablesScanned = tables.length;
      
      for (const t of tables) {
        let roadText = t.text;
        
        // Nếu cần, dùng Vision để đọc chính xác hơn
        if (!roadText && anthropicKey) {
          const ss = await page.screenshot({
            encoding: 'base64',
            clip: { x: t.badgeRect.x, y: t.badgeRect.y, width: t.badgeRect.w, height: t.badgeRect.h }
          });
          roadText = await readBadgeText(ss, anthropicKey);
        }

        const road = classifyRoad(roadText);
        if (!road) continue;
        if (isCooldown(t.tableName, cooldownSec)) continue;

        report.alerts.push({ tableName: t.tableName, roadType: road.type, label: roadText });
        setCooldown(t.tableName);

        if (token && chatId) {
          const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
          const emoji = road.type === '1-1' ? '🔁' : '🔥';
          await sendTelegram(token, chatId, `${emoji} <b>${roadText}</b>\n📍 Bàn: <b>${t.tableName}</b>\n🕐 ${now}`);
        }
      }
    }

    // Gửi tổng kết nếu có alert
    if (report.alerts.length > 0 && token && chatId) {
      const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const summary = `📊 <b>TỔNG KẾT ${now}</b>\n` +
        `🔍 Đã quét: ${report.tablesScanned} bàn\n` +
        `⚡ Cầu hot: ${report.alerts.length} bàn\n\n` +
        report.alerts.map(a => {
          const e = a.roadType === '1-1' ? '🔁' : '🔥';
          return `${e} ${a.tableName}: ${a.label}`;
        }).join('\n');
      
      await sendTelegram(token, chatId, summary);
    }

  } catch (e) {
    report.errors.push(e.message);
  } finally {
    if (browser) await browser.close();
  }

  return res.status(200).json(report);
};

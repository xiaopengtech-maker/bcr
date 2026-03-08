/**
 * /api/debug — Inspect toàn bộ response từ platform
 * Thử REST + phân tích HTML lobby để tìm WS endpoint
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'X-Login-Url');

  const loginUrl = req.headers['x-login-url'] || req.query.loginUrl || '';
  if (!loginUrl) return res.status(200).json({ error: 'Thiếu loginUrl' });

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';
  let base = 'https://bpweb.grteud.com';
  let cookies = '';
  const report = { loginResult: {}, lobbyHtml: {}, restTests: [], wsHints: [] };

  // ── 1. Login ───────────────────────────────────────────
  try {
    // Thử với timeout 10s
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const r = await fetch(loginUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
        'Accept-Language': 'vi-VN,vi;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });
    clearTimeout(timer);

    // Base từ finalUrl sau redirect
    if (r.url && r.url.startsWith('http')) {
      try { base = new URL(r.url).origin; } catch {}
    }

    const sc = r.headers.get('set-cookie') || '';
    cookies = sc.split(/,(?=[^ ])/).map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
    const body = await r.text();
    let bodyJson = null;
    try { bodyJson = JSON.parse(body); } catch {}

    // Đọc tất cả headers để debug
    const allHeaders = {};
    r.headers.forEach((v, k) => { allHeaders[k] = v; });

    report.loginResult = {
      status: r.status,
      finalUrl: r.url,
      baseDetected: base,
      cookiesFound: cookies || 'KHÔNG CÓ COOKIE',
      contentType: r.headers.get('content-type'),
      allHeaders,
      bodyLength: body.length,
      bodyFirst300: body.substring(0, 300),
      bodyJson,
    };
  } catch(e) {
    report.loginResult = {
      error: e.message,
      errorType: e.name,
      detail: e.cause ? String(e.cause) : null,
      hint: e.name === 'AbortError' ? 'TIMEOUT — server không phản hồi trong 10s' :
            e.message.includes('ENOTFOUND') ? 'DNS không phân giải được domain' :
            e.message.includes('ECONNREFUSED') ? 'Kết nối bị từ chối' :
            e.message.includes('certificate') ? 'Lỗi SSL certificate' :
            'Fetch thất bại — có thể Vercel bị chặn bởi platform',
    };
  }

  // ── 2. Fetch lobby HTML → tìm API/WS endpoint ─────────
  try {
    const lobbyUrl = base + '/player/webMain.jsp?dm=1&title=1';
    const r = await fetch(lobbyUrl, {
      headers: { 'User-Agent': UA, 'Cookie': cookies, 'Referer': base + '/' },
    });
    // Fix: dùng finalUrl sau redirect để lấy base đúng
    if (r.url && r.url.startsWith('http')) {
      try { base = new URL(r.url).origin; } catch {}
    }
    const html = await r.text();

    // Tìm các URL API/WS trong source code
    const apiMatches = [...new Set([
      ...(html.match(/["'`](\/api\/[^"'`\s?]+)/g) || []),
      ...(html.match(/["'`](\/webapi\/[^"'`\s?]+)/g) || []),
      ...(html.match(/["'`](\/ws[^"'`\s?]*)/g) || []),
      ...(html.match(/apiUrl\s*[:=]\s*["'`]([^"'`]+)/g) || []),
      ...(html.match(/wsUrl\s*[:=]\s*["'`]([^"'`]+)/g) || []),
      ...(html.match(/socketUrl\s*[:=]\s*["'`]([^"'`]+)/g) || []),
      ...(html.match(/baseUrl\s*[:=]\s*["'`]([^"'`]+)/g) || []),
      ...(html.match(/tableList[^"'`\n]{0,50}/g) || []),
      ...(html.match(/getTable[^"'`\n]{0,50}/g) || []),
      ...(html.match(/lobby[^"'`\n]{0,50}/g) || []),
    ])];

    // Tìm JS files được load
    const jsFiles = (html.match(/src=["']([^"']+\.js[^"']*)/g) || []).map(s => s.replace(/src=["']/,'').replace(/["']/,''));

    report.lobbyHtml = {
      status: r.status,
      htmlLength: html.length,
      apiHints: apiMatches.slice(0, 20),
      jsFiles: jsFiles.slice(0, 10),
      htmlFirst500: html.substring(0, 500),
    };

    report.wsHints = apiMatches.filter(s => s.toLowerCase().includes('ws') || s.toLowerCase().includes('socket'));
  } catch(e) {
    report.lobbyHtml = { error: e.message };
  }

  // ── 3. Thử REST endpoints ─────────────────────────────
  const hdrs = {
    'User-Agent': UA, 'Accept': 'application/json',
    'Cookie': cookies, 'X-Requested-With': 'XMLHttpRequest',
    'Referer': base + '/player/webMain.jsp',
  };
  const eps = [
    '/api/player/MexAWS081/getTableList?dm=1',
    '/api/player/MexAWS081/lobby?dm=1',
    '/api/player/MexAWS081/tableInfo?dm=1',
    '/api/player/MexAWS081/gameList?dm=1',
    '/api/player/MexAWS081/roadmap?dm=1',
    '/api/player/MexAWS081/beadRoad?dm=1',
    '/api/MexAWS081/getTableList?dm=1',
    '/api/player/getTableList?dm=1',
    '/lobby/tableList?dm=1',
    '/gameList?dm=1',
  ];
  for (const ep of eps) {
    try {
      const r = await fetch(base + ep, { headers: hdrs });
      const txt = await r.text();
      const isJson = txt.trim()[0] === '{' || txt.trim()[0] === '[';
      report.restTests.push({
        ep, status: r.status, isJson,
        preview: txt.substring(0, 200),
      });
    } catch(e) {
      report.restTests.push({ ep, error: e.message });
    }
  }

  return res.status(200).json(report);
};

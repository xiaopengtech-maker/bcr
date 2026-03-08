/**
 * /api/debug — Dùng để inspect response từ platform
 * Gọi: https://your-app.vercel.app/api/debug
 * Sẽ trả về toàn bộ thông tin login + các endpoint thử
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const loginUrl = req.headers['x-login-url']
                || req.query.loginUrl
                || process.env.LOGIN_URL
                || '';

  if (!loginUrl) {
    return res.status(200).json({ error: 'Thiếu loginUrl. Truyền qua query: ?loginUrl=...' });
  }

  const report = {
    loginUrl: loginUrl.substring(0, 80) + '...',
    loginResponse: {},
    endpointTests: [],
  };

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';

  let base = 'https://bpweb.grteud.com';
  let cookies = '';

  // ── Step 1: Login ──────────────────────────────────────
  try {
    const r = await fetch(loginUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/json,*/*',
        'Accept-Language': 'vi-VN,vi;q=0.9',
      },
    });

    base = new URL(loginUrl).origin;
    const sc = r.headers.get('set-cookie') || '';
    cookies = sc.split(/,(?=[^ ])/).map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');

    const ct = r.headers.get('content-type') || '';
    let body = '';
    try { body = await r.text(); } catch {}

    let bodyJson = null;
    try { bodyJson = JSON.parse(body); } catch {}

    report.loginResponse = {
      status:       r.status,
      finalUrl:     r.url,
      contentType:  ct,
      cookies:      cookies || '(없음)',
      bodyPreview:  body.substring(0, 500),
      bodyJson:     bodyJson,
      headers: {
        location:    r.headers.get('location'),
        setCookie:   sc.substring(0, 200),
      },
    };
  } catch (e) {
    report.loginResponse = { error: e.message };
  }

  // ── Step 2: Thử tất cả endpoint ───────────────────────
  const endpoints = [
    '/api/player/MexAWS081/getTableList?dm=1&gameType=1',
    '/api/player/MexAWS081/getTableList?dm=1',
    '/api/player/MexAWS081/lobby?dm=1',
    '/api/player/MexAWS081/gameList?dm=1',
    '/api/player/MexAWS081/baccaratList?dm=1',
    '/api/player/MexAWS081/tableList?dm=1',
    '/api/MexAWS081/getTableList?dm=1',
    '/api/MexAWS081/lobby?dm=1',
    '/webapi/getTableList?dm=1',
    '/api/player/MexAWS081/getGameList?dm=1&type=baccarat',
    '/api/player/MexAWS081/getAllTable?dm=1',
  ];

  for (const ep of endpoints) {
    const url = base + ep;
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json',
          'Referer': base + '/player/webMain.jsp',
          'X-Requested-With': 'XMLHttpRequest',
          'Cookie': cookies,
        },
      });
      const body = await r.text();
      let preview = body.substring(0, 300);
      let isJson = false;
      try { JSON.parse(body); isJson = true; } catch {}

      report.endpointTests.push({
        url,
        status: r.status,
        isJson,
        preview,
      });
    } catch (e) {
      report.endpointTests.push({ url, error: e.message });
    }
  }

  return res.status(200).json(report);
};

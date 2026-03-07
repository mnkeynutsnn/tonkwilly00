const https = require('https');

// In-memory store: { ip: { count: number, resetTime: number } }
// Resets every windowMs
const rateLimitMap = new Map();
const WINDOW_MS = 60 * 1000;       // 60 seconds window
const MAX_REQUESTS = 5;            // max 5 requests per IP per window
const BLOCK_AFTER = 429;           // HTTP status to return when limited

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Get client IP (Vercel sets x-vercel-forwarded-for or falls back to cf-connecting-ip / x-forwarded-for)
  const ip = 
    req.headers['x-vercel-forwarded-for'] ||
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown';

  // Optional: simple token check (still recommended)
  const token = req.headers['x-verify-token'] || '';
  if (token !== process.env.VERIFY_TOKEN) {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: 'Invalid token' }));
    return;
  }

  // Rate limiting logic
  const now = Date.now();
  let limitInfo = rateLimitMap.get(ip) || { count: 0, resetTime: now + WINDOW_MS };

  if (now > limitInfo.resetTime) {
    // Window expired → reset
    limitInfo = { count: 1, resetTime: now + WINDOW_MS };
  } else {
    limitInfo.count += 1;
  }

  rateLimitMap.set(ip, limitInfo);

  if (limitInfo.count > MAX_REQUESTS) {
    res.statusCode = BLOCK_AFTER;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Retry-After', Math.ceil((limitInfo.resetTime - now) / 1000));
    res.end(JSON.stringify({
      error: 'Too many requests from this IP. Try again later.',
      retryAfter: Math.ceil((limitInfo.resetTime - now) / 1000)
    }));
    return;
  }

  // Optional: clean up old entries occasionally (prevent memory growth)
  if (rateLimitMap.size > 10000) {  // arbitrary high number
    for (const [key, val] of rateLimitMap.entries()) {
      if (now > val.resetTime) rateLimitMap.delete(key);
    }
  }

  // Proceed to proxy to Discord
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Server configuration error' }));
    return;
  }

  const options = {
    method: 'POST',
    headers: {
      ...req.headers,
      host: new URL(webhook).host,
    },
  };

  delete options.headers['content-length'];
  delete options.headers['host'];

  const proxyReq = https.request(webhook, options, proxyRes => {
    res.statusCode = proxyRes.statusCode;
    Object.entries(proxyRes.headers || {}).forEach(([k, v]) => {
      res.setHeader(k, v);
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    console.error('Proxy error:', err);
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'Failed to forward request' }));
  });

  req.pipe(proxyReq);
};
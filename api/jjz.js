const https = require('https'); // built-in, no install needed

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Your real webhook — loaded from env (never hardcode!)
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Server not configured' }));
    return;
  }

  // We'll forward the raw incoming request body (multipart/form-data with photo + json)
  // Vercel gives us req as a readable stream

  const options = {
    method: 'POST',
    headers: {
      ...req.headers,
      host: new URL(webhookUrl).host, // override host header
    },
  };

  // Remove headers that might cause issues
  delete options.headers['content-length']; // let Node recalculate
  delete options.headers['transfer-encoding'];

  const proxyReq = https.request(webhookUrl, options, (proxyRes) => {
    // Forward status & headers from Discord back to browser
    res.statusCode = proxyRes.statusCode;
    proxyRes.headers && Object.entries(proxyRes.headers).forEach(([k, v]) => {
      res.setHeader(k, v);
    });

    // Pipe the response body (usually empty for 204 No Content)
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err);
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'Failed to reach Discord' }));
  });

  // Pipe the client's multipart body (photo + payload_json) to Discord
  req.pipe(proxyReq);
};
/**
 * NetMirror proxy server - runs on Hermes machine (Nigerian IP, not blocked)
 * Exposed via ngrok so Render addon can reach it.
 * Forwards requests to tv.imgcdn.kim with required headers.
 */
const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3333;

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const query = url.parse(req.url, true).query;
  const target = query.target;

  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing ?target= param' }));
    return;
  }

  const targetUrl = decodeURIComponent(target);
  console.log(`[Proxy] ${targetUrl}`);

  // Parse the target URL
  const parsed = new URL(targetUrl);
  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    port: 443,
    method: 'GET',
    headers: {
      'OTT': query.ott || 'hs',
      'X-Requested-With': query.xreq || 'NetmirrorNewTV v1.0',
      'User-Agent': query.ua || 'Mozilla/5.0',
      'Referer': query.ref || 'https://net52.cc',
    },
    rejectUnauthorized: false,
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[Proxy] Error: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  proxyReq.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NetMirror proxy server listening on port ${PORT}`);
});

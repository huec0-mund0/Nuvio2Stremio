/**
 * NetMirror proxy server - runs on the server with unblocked IP
 * Relays requests from Render to blocked APIs
 * Usage: node proxy.js
 */

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PROXY_PORT || 8081;
const ALLOWED_ORIGINS = '*';

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS);
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.end();

  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;

  // Proxy endpoint: GET /proxy?target=<encoded_url>
  if (path === '/proxy' && parsed.query.target) {
    const targetUrl = decodeURIComponent(parsed.query.target);
    const headers = {};
    
    // Forward specific headers
    if (req.headers['x-forwarded-headers']) {
      try {
        Object.assign(headers, JSON.parse(req.headers['x-forwarded-headers']));
      } catch {}
    }

    // Default browser-like headers
    headers['User-Agent'] = headers['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    headers['Accept'] = headers['Accept'] || '*/*';

    console.log(`[Proxy] ${targetUrl}`);

    const targetParsed = url.parse(targetUrl);
    const options = {
      hostname: targetParsed.hostname,
      port: targetParsed.port || 443,
      path: targetParsed.path,
      method: 'GET',
      headers,
      rejectUnauthorized: false,
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[Proxy] Error: ${err.message}`);
      res.writeHead(502);
      res.end(JSON.stringify({ error: err.message }));
    });

    proxyReq.setTimeout(15000, () => {
      proxyReq.destroy();
      res.writeHead(504);
      res.end(JSON.stringify({ error: 'timeout' }));
    });

    return proxyReq.end();
  }

  // Proxy POST endpoint: POST /proxy?target=<encoded_url>
  if (path === '/proxy' && req.method === 'POST') {
    const targetUrl = decodeURIComponent(parsed.query.target);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const targetParsed = url.parse(targetUrl);
      const headers = {
        'User-Agent': 'Mozilla/5.0',
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Content-Length': Buffer.byteLength(body),
      };
      if (req.headers['x-forwarded-headers']) {
        try { Object.assign(headers, JSON.parse(req.headers['x-forwarded-headers'])); } catch {}
      }

      const options = {
        hostname: targetParsed.hostname,
        port: targetParsed.port || 443,
        path: targetParsed.path,
        method: 'POST',
        headers,
        rejectUnauthorized: false,
      };

      const proxyReq = https.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        res.writeHead(502);
        res.end(JSON.stringify({ error: err.message }));
      });

      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // Health check
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', server: 'netmirror-proxy' }));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[Proxy] NetMirror proxy running on port ${PORT}`);
  console.log(`[Proxy] Usage: GET /proxy?target=https://tv.imgcdn.kim/...`);
});

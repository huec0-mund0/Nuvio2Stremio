/**
 * NetMirror proxy server - runs on Hermes machine (Nigerian IP, not blocked)
 * Exposed via ngrok so Render addon can reach it.
 * Forwards requests to tv.imgcdn.kim with required headers.
 * Also provides 4KHDHub scraping endpoint (runs from Nigerian IP).
 */
const http = require('http');
const https = require('https');
const url = require('url');
const { getStreams: get4kHDHubStreams } = require('./providers/4khdhubnew.js');

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

  // 4KHDHub scraping endpoint (runs from Nigerian IP, not blocked)
  if (req.url.startsWith('/4khdhub/stream')) {
    const query = url.parse(req.url, true).query;
    const tmdbId = query.tmdb;
    const type = query.type || 'movie';
    const season = parseInt(query.season) || 0;
    const episode = parseInt(query.episode) || 0;

    if (!tmdbId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing ?tmdb= param' }));
      return;
    }

    console.log(`[4KHDHub] Fetching tmdb=${tmdbId} type=${type} S${season}E${episode}`);
    get4kHDHubStreams(tmdbId, type, season, episode)
      .then(streams => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ streams }));
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
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
      'Origin': query.origin || '',
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

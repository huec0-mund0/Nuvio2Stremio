/**
 * 4KHDHub proxy server - runs 4khdhubnew locally (Nigeria IP, not blocked)
 * Exposes an API endpoint that the Render addon can call via the tunnel.
 * Prevents 4khdhub.one from blocking Render's US IP.
 */

const http = require('http');
const PORT = process.env.PORT || 7891;

// Load the 4khdhubnew provider
const { getStreams } = require('/home/hueco/nuvio-vercel/providers/4khdhubnew.js');

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

  if (req.method === 'GET' && req.url.startsWith('/stream')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const tmdbId = url.searchParams.get('tmdb');
    const type = url.searchParams.get('type') || 'movie';
    const season = parseInt(url.searchParams.get('season')) || 0;
    const episode = parseInt(url.searchParams.get('episode')) || 0;

    if (!tmdbId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing ?tmdb= param' }));
      return;
    }

    console.log(`[4KHDHub-Proxy] Fetching: tmdb=${tmdbId} type=${type} S${season}E${episode}`);

    getStreams(tmdbId, type, season, episode)
      .then(streams => {
        console.log(`[4KHDHub-Proxy] Found ${streams.length} streams`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ streams }));
      })
      .catch(err => {
        console.error(`[4KHDHub-Proxy] Error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`4KHDHub proxy server listening on port ${PORT}`);
});

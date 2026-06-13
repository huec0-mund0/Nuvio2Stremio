/**
 * Nuvio Streams Addon - Render serverless entry point
 * Routes: /manifest.json, /stream/:type/:id.json
 */
const { getStreams: getGoatAPIStreams } = require('../providers/goatapi');
const { getStreams: getHDHub4uStreams } = require('../providers/hdhub4u');
const { getStreams: getPurStreamStreams } = require('../providers/purstream');
const { getStreams: getNetMirrorStreams } = require('../providers/netmirror');
const { getStreams: getZinkMoviesStreams } = require('../providers/zinkmovies');
const { getStreams: get4kHDHubStreams } = require('../providers/4khdhubnew');
const manifest = require('../manifest.json');

// ── Helpers ────────────────────────────────────────────────
function parseId(id) {
  const parts = id.split(':');
  return { imdbId: parts[0], season: parts[1] || null, episode: parts[2] || null };
}

function TMDB_cache() {
  const cache = new Map();
  return async function resolve(imdbId, type) {
    const key = `${imdbId}:${type}`;
    if (cache.has(key)) return cache.get(key);
    try {
      const resource = type === 'movie' ? 'movie' : 'series';
      const res = await fetch(`https://v3-cinemeta.strem.io/meta/${resource}/${imdbId}.json`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      const meta = data?.meta;
      if (meta) {
        const result = {
          tmdbId: meta.moviedb_id || meta.tmdb_id,
          title: meta.name || meta.title,
          year: meta.year || (meta.releaseInfo ? parseInt(meta.releaseInfo) : null),
        };
        cache.set(key, result);
        return result;
      }
    } catch {}
    return null;
  };
}
const resolveMeta = TMDB_cache();

/** Run a promise with a max duration — rejects if it takes too long */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms))
  ]);
}

// ── Route handler ───────────────────────────────────────────
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Debug endpoint
  if (path === '/debug') {
    const results = {};
    const testUrls = [
      { name: 'NetMirror API', url: 'https://tv.imgcdn.kim/newtv/search.php?s=Deadpool', headers: {'User-Agent': 'Mozilla/5.0','x-requested-with':'NetmirrorNewTV v1.0'} },
      { name: 'ZinkMovies', url: 'https://new1.zinkmovies.foo', headers: {} },
      { name: 'GoatAPI', url: 'https://api.ghpool.xyz/goatapi/search?tmdb=123&type=movie', headers: {} },
      { name: 'VixSrc API', url: 'https://vixsrc.to/api/movie/550', headers: {'User-Agent': 'Mozilla/5.0','Referer': 'https://vixsrc.to/'} },
      { name: 'VixSrc Embed', url: 'https://vixsrc.to/', headers: {'User-Agent': 'Mozilla/5.0'} },
      { name: 'VixSrc via Proxy', url: 'https://proxy.rchimezie.com/?target=' + encodeURIComponent('https://vixsrc.to/api/movie/550'), headers: {'User-Agent': 'Mozilla/5.0'} },
      { name: 'VixSrc via Proxy (embed)', url: 'https://proxy.rchimezie.com/?target=' + encodeURIComponent('https://vixsrc.to/embed/170060?token=test'), headers: {'User-Agent': 'Mozilla/5.0'} },
    ];
    for (const t of testUrls) {
      const r = { status: null, error: null, body_preview: null };
      try {
        const resp = await fetch(t.url, { headers: t.headers, signal: AbortSignal.timeout(10000) });
        r.status = resp.status;
        const text = await resp.text();
        r.body_preview = text.slice(0, 200);
      } catch(e) { r.error = e.message; }
      results[t.name] = r;
    }
    return res.status(200).json(results);
  }

  // Manifest
  if (path === '/manifest.json') {
    return res.status(200).json(manifest);
  }

  // Stream proxy — routes video/playlist requests through the tunnel
  // Stremio clients that don't respect stream.headers can still play
  if (path.startsWith('/proxy/')) {
    const targetPath = path.slice(7);
    // Reconstruct full target URL — query params may be in url.search
    const rawTarget = targetPath + (url.search || '');
    const target = decodeURIComponent(rawTarget);
    if (!target) return res.status(400).json({ error: 'missing target' });

    try {
      const proxyUrl = 'https://proxy.rchimezie.com/?target=' + encodeURIComponent(target);
      const resp = await fetch(proxyUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(30000),
      });

      const isM3u8 = (resp.headers.get('content-type') || '').includes('m3u8')
        || (resp.headers.get('content-type') || '').includes('apple.mpegurl')
        || target.includes('.m3u8');

      if (isM3u8) {
        // Read as text so we can rewrite segment URLs
        const text = await resp.text();
        const baseUrl = target.substring(0, target.lastIndexOf('/') + 1);
        const addonBase = `https://${req.headers.host}/proxy/`;

        // Strip \r so $ assertions work in multiline regex
        const cleanText = text.replace(/\r/g, '');
        const rewritten = cleanText
          // First rewrite inline URI="..." attributes in HLS tags (audio, subs, etc.)
          .replace(/URI="(https?:\/\/[^"]+)"/g, (_m, url) => `URI="${addonBase}${encodeURIComponent(url)}"`)
          // Also rewrite inline URI="/absolute/path" to full proxy URL
          .replace(/URI="\/([^"]+)"/g, (_m, path) => {
            // Resolve relative to the target URL's origin
            const targetUrl = new URL(target);
            const absUrl = `${targetUrl.protocol}//${targetUrl.host}/${path}`;
            return `URI="${addonBase}${encodeURIComponent(absUrl)}"`;
          })
          // Then rewrite standalone full URLs
          .replace(/^(https?:\/\/[^\s]+)$/gm, (match) => addonBase + encodeURIComponent(match))
          // Then rewrite relative paths
          .replace(/^([a-zA-Z0-9_\-./]+\.(ts|m3u8|m3u|key|m4s|js|jpg))$/gm, (match) => {
            const absUrl = baseUrl + match;
            return addonBase + encodeURIComponent(absUrl);
          });

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.status(200).send(rewritten);
      }

      // Binary segments — pipe raw, fix content type if MPEG-TS disguised as .js/.jpg
      if (resp.headers.get('content-length')) res.setHeader('Content-Length', resp.headers.get('content-length'));

      const buffer = Buffer.from(await resp.arrayBuffer());
      let ct = resp.headers.get('content-type') || 'application/octet-stream';

      // Detect MPEG-TS disguised as .js/.jpg and fix content type
      if (buffer.length > 4 && buffer[0] === 0x47) {
        ct = 'video/MP2T';
      }

      res.setHeader('Content-Type', ct);
      return res.status(200).send(buffer);
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // Stream request: /stream/:type/:id.json
  const match = path.match(/^\/stream\/(movie|series)\/(.+?)\.json$/);
  if (match) {
    const type = match[1];
    const fullId = decodeURIComponent(match[2]);
    const { imdbId, season, episode } = parseId(fullId);
    const meta = await resolveMeta(imdbId, type);

    const allSources = [];
    const start = Date.now();
    const ENABLED = process.env.PROVIDERS || 'goatapi,hdhub4u,purstream,netmirror,zinkmovies,4khdhub';
    const enabled = ENABLED.split(',').map(s => s.trim().toLowerCase());

    const tasks = [];
    const PROVIDER_TIMEOUT = 15000; // 15s per provider

    if (enabled.includes('goatapi') && meta?.tmdbId) {
      tasks.push(
        withTimeout(getGoatAPIStreams(meta.tmdbId, type, season, episode).then(s => allSources.push(...s)), PROVIDER_TIMEOUT)
          .catch(() => {})
      );
    }
    if (enabled.includes('hdhub4u') && meta?.tmdbId) {
      tasks.push(
        withTimeout(getHDHub4uStreams(meta.tmdbId, type, season, episode).then(s => allSources.push(...s)), PROVIDER_TIMEOUT)
          .catch(() => {})
      );
    }
    if (enabled.includes('purstream') && meta?.tmdbId) {
      tasks.push(
        withTimeout(getPurStreamStreams(meta.tmdbId, type, season, episode).then(s => allSources.push(...s)), PROVIDER_TIMEOUT)
          .catch(() => {})
      );
    }
    if (enabled.includes('netmirror')) {
      tasks.push(
        withTimeout(getNetMirrorStreams(meta?.tmdbId || imdbId, type, season, episode, meta?.title).then(s => allSources.push(...s)), PROVIDER_TIMEOUT)
          .catch(() => {})
      );
    }
    if (enabled.includes('zinkmovies') && meta?.tmdbId) {
      tasks.push(
        withTimeout(getZinkMoviesStreams(meta.tmdbId, type, season, episode).then(s => allSources.push(...s)), PROVIDER_TIMEOUT)
          .catch(() => {})
      );
    }
    if (enabled.includes('4khdhub') && meta?.tmdbId) {
      tasks.push(
        withTimeout(get4kHDHubStreams(meta.tmdbId, type, season, episode).then(s => {
          // 4KHDHub returns direct file URLs - proxy them through tunnel for geo-access
          const addonBase = `https://nuvio2stremio.onrender.com/proxy/`;
          const fixed = s.map(st => ({
            ...st,
            // Route through addon proxy so TV in Nigeria can reach them
            url: st.url ? addonBase + encodeURIComponent(st.url) : st.url,
            name: st.name && !st.name.startsWith('4KHDHub') ? '4KHDHub | ' + st.name : st.name,
          }));
          allSources.push(...fixed);
        }), 25000) // 25s timeout - 4khdhubnew is slow (7s+ locally)
          .catch(() => {})
      );
    }

    // Overall timeout so Render doesn't kill us
    await withTimeout(Promise.allSettled(tasks), 30000).catch(() => {});
    console.log(`[Nuvio] ${imdbId} → ${allSources.length} streams in ${Date.now()-start}ms`);

    return res.status(200).json({ streams: allSources });
  }

  return res.status(404).json({ error: 'not found' });
}

module.exports = (req, res) => {
  handleRequest(req, res).catch(err => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });
};

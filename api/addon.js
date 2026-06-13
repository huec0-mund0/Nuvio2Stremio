/**
 * Nuvio Streams Addon - Vercel serverless entry point
 * Routes: /manifest.json, /stream/:type/:id.json
 */
const { getStreams: getGoatAPIStreams } = require('../providers/goatapi');
const { getStreams: getHDHub4uStreams } = require('../providers/hdhub4u');
const { getStreams: getNetMirrorStreams } = require('../providers/netmirror');
const { getStreams: getZinkMoviesStreams } = require('../providers/zinkmovies');
const cineMMProvider = require('../providers/cinemm');
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

// ── Route handler ───────────────────────────────────────────
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Debug: check provider reachability from this server
  if (path === '/debug') {
    const results = {};
    const testUrls = [
      { name: 'NetMirror API', url: 'https://tv.imgcdn.kim/newtv/search.php?s=Deadpool', headers: {'User-Agent': 'Mozilla/5.0','x-requested-with':'NetmirrorNewTV v1.0'} },
      { name: 'ZinkMovies', url: 'https://new1.zinkmovies.foo', headers: {} },
      { name: 'GoatAPI', url: 'https://api.ghpool.xyz/goatapi/search?tmdb=123&type=movie', headers: {} },
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

  // Stream request: /stream/:type/:id.json
  const match = path.match(/^\/stream\/(movie|series)\/(.+?)\.json$/);
  if (match) {
    const type = match[1];
    const fullId = match[2];
    const { imdbId, season, episode } = parseId(fullId);
    const meta = await resolveMeta(imdbId, type);

    const allSources = [];
    const start = Date.now();
    const ENABLED = process.env.PROVIDERS || 'goatapi,hdhub4u,netmirror,zinkmovies,cinemm';
    const enabled = ENABLED.split(',').map(s => s.trim().toLowerCase());

    const tasks = [];
    if (enabled.includes('goatapi') && meta?.tmdbId) {
      tasks.push(getGoatAPIStreams(meta.tmdbId, type, season, episode)
        .then(s => allSources.push(...s)));
    }
    if (enabled.includes('hdhub4u') && meta?.tmdbId) {
      tasks.push(getHDHub4uStreams(meta.tmdbId, type, season, episode)
        .then(s => allSources.push(...s)));
    }
    if (enabled.includes('netmirror')) {
      tasks.push(getNetMirrorStreams(meta?.tmdbId || imdbId, type, season, episode)
        .then(s => allSources.push(...s)));
    }
    if (enabled.includes('zinkmovies') && meta?.tmdbId) {
      tasks.push(getZinkMoviesStreams(meta.tmdbId, type, season, episode)
        .then(s => allSources.push(...s)));
    }
    if (enabled.includes('cinemm')) {
      tasks.push(cineMMProvider.getStreams(meta?.tmdbId || imdbId, type, season, episode)
        .then(s => allSources.push(...s)));
    }

    await Promise.allSettled(tasks);
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

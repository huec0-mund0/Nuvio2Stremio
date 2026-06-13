/**
 * Nuvio Streams Addon - Vercel serverless entry point
 * Routes: /manifest.json, /stream/:type/:id.json
 */
const { getVideasyStreams } = require('../providers/videasy');
const { getVidFastStreams } = require('../providers/vidfast');
const { getMovieBoxStreams } = require('../providers/moviebox');
const { getHDHub4uStreams } = require('../providers/hdhub4u');
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
    const ENABLED = process.env.PROVIDERS || 'videasy,vidfast,moviebox,hdhub4u,cinemm';
    const enabled = ENABLED.split(',').map(s => s.trim().toLowerCase());

    const tasks = [];
    if (enabled.includes('videasy') && meta?.title) {
      tasks.push(getVideasyStreams(meta.title, meta.year, meta.tmdbId, imdbId, season, episode)
        .then(s => allSources.push(...s)));
    }
    if (enabled.includes('vidfast') && meta?.tmdbId) {
      tasks.push(getVidFastStreams(meta.tmdbId, season, episode)
        .then(s => allSources.push(...s)));
    }
    if (enabled.includes('moviebox') && meta?.tmdbId) {
      tasks.push(getMovieBoxStreams(meta.tmdbId, type, season, episode)
        .then(s => allSources.push(...s)));
    }
    if (enabled.includes('hdhub4u') && meta?.tmdbId) {
      tasks.push(getHDHub4uStreams(meta.tmdbId, type, meta.title, meta.year, season, episode)
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

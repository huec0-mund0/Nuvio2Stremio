/**
 * Videasy provider - ported from CineStream
 * Source: api.videasy.to using multi-server extraction
 */
const cheerio = require('cheerio');

const BASE = 'https://api.videasy.to';
const DECRYPT_API = 'https://enc-dec.app/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchJson(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || 10000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      signal: controller.signal,
    });
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function fetchText(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || 10000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      signal: controller.signal,
    });
    return await res.text();
  } finally { clearTimeout(timer); }
}

const SERVERS = [
  'cdn', 'mb-flix', 'hdmovie', 'lamovie', 'downloader2', 'cuevana',
  'moviesapi', 'tvshowbox', 'streamflix', 'primewire', 'vidplay',
  'moviedrive', 'embedgram', 'multimovies',
];

async function tryServer(title, year, tmdbId, imdbId, season, episode, server) {
  try {
    const tmdb = tmdbId || '';
    const imdb = imdbId || '';
    const body = JSON.stringify({ title, year, tmdb, imdb, tmdb_type: season != null ? 'tv' : 'movie' });
    const data = await fetchText(`${BASE}/api/${server}?tmdb_type=${season != null ? 'tv' : 'movie'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      timeout: 8000,
    });
    if (!data || data.length < 20) return [];

    const dec = await fetchJson(`${DECRYPT_API}/dec-videasy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: data }),
      timeout: 8000,
    });

    const src = dec?.result?.sources || dec?.sources || [];
    if (!src.length) return [];

    return src.map(s => ({
      name: `🎬 Videasy [${server}]`,
      title: s.quality || 'HD',
      url: s.url || s.file,
      headers: { Referer: 'https://player.videasy.to/' },
      behaviorHints: {
        proxyHeaders: { request: { Referer: 'https://player.videasy.to/' } },
      },
    }));
  } catch { return []; }
}

async function getVideasyStreams(title, year, tmdbId, imdbId, season, episode) {
  if (!title) return [];

  const results = [];
  const chunks = [];
  for (let i = 0; i < SERVERS.length; i += 4) {
    chunks.push(SERVERS.slice(i, i + 4));
  }
  for (const chunk of chunks) {
    const batch = await Promise.allSettled(
      chunk.map(s => tryServer(title, year, tmdbId, imdbId, season, episode, s))
    );
    for (const b of batch) {
      if (b.status === 'fulfilled' && b.value.length > 0) {
        results.push(...b.value);
      }
    }
  }
  return results;
}

module.exports = { getVideasyStreams };

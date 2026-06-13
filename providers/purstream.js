/**
 * PurStream provider - api.purstream.ch
 * Based on deobfuscated code from All-in-One-Nuvio (patch-1 branch)
 * Uses TMDB metadata for search, returns M3U8/MP4 streams
 */
const PURSTREAM_API = 'https://api.purstream.ch/api/v1';
const PURSTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PURSTREAM_REFERER = 'https://purstream.ch/';
const TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';

function cleanTitle(title) {
  if (!title) return '';
  return title.toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractYear(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

async function getTmdbSearchMeta(tmdbId, type) {
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  try {
    const resp = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?language=fr-FR&api_key=${TMDB_KEY}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      fr: data.title || data.name,
      orig: data.original_title || data.original_name,
      year: extractYear(data.release_date || data.first_air_date),
    };
  } catch { return null; }
}

async function findPurstreamId(title, type, year) {
  if (!title) return null;

  // Path-based search: /search-bar/search/{title}
  const searchUrl = `${PURSTREAM_API}/search-bar/search/${encodeURIComponent(title)}`;

  try {
    const resp = await fetch(searchUrl, {
      headers: { 'User-Agent': PURSTREAM_UA, 'Referer': PURSTREAM_REFERER }
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const items = data?.data?.items?.movies?.items || [];

    if (items.length === 0) return null;

    const cleanSearch = cleanTitle(title);

    // Exact title match
    let match = items.find(m => cleanTitle(m.title) === cleanSearch);

    // Original title fallback
    if (!match) {
      match = items.find(m => m.original_title && cleanTitle(m.original_title) === cleanSearch);
    }

    // Year proximity fallback
    if (!match && year) {
      match = items.find(m => {
        const itemYear = extractYear(m.release_date);
        return itemYear && Math.abs(itemYear - year) <= 1;
      });
    }

    // First result fallback
    return match ? match.id : items[0].id;
  } catch {
    return null;
  }
}

async function getMovieSources(id) {
  try {
    const resp = await fetch(`${PURSTREAM_API}/media/${id}/sheet`, {
      headers: { 'User-Agent': PURSTREAM_UA, 'Referer': PURSTREAM_REFERER }
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    // Structure: data.items.urls[]
    return data?.data?.items?.urls || [];
  } catch { return []; }
}

async function getEpisodeSources(id, season, episode) {
  try {
    const resp = await fetch(`${PURSTREAM_API}/stream/${id}/episode?season=${season || 1}&episode=${episode || 1}`, {
      headers: { 'User-Agent': PURSTREAM_UA, 'Referer': PURSTREAM_REFERER }
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    // Structure: data.items.sources[]
    return data?.data?.items?.sources || [];
  } catch { return []; }
}

function parseQuality(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('4K')) return '4K';
  if (n.includes('1080')) return '1080p';
  if (n.includes('720')) return '720p';
  return 'HD';
}

function parseLang(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('VOSTFR')) return 'VOSTFR';
  if (n.includes('VF')) return 'VF';
  return 'MULTI';
}

async function getStreams(id, type, season, episode) {
  console.log(`[PurStream] Searching for ${type} ${id}`);

  try {
    // Get French and original titles from TMDB
    const meta = await getTmdbSearchMeta(id, type);
    if (!meta || !meta.fr) {
      console.log('[PurStream] Could not get TMDB metadata');
      return [];
    }
    console.log(`[PurStream] TMDB meta: fr="${meta.fr}" orig="${meta.orig}" year=${meta.year}`);

    // Try French title first, then original
    let purstreamId = await findPurstreamId(meta.fr, type, meta.year);
    if (!purstreamId && meta.orig && meta.orig !== meta.fr) {
      purstreamId = await findPurstreamId(meta.orig, type, meta.year);
    }

    if (!purstreamId) {
      console.log('[PurStream] Could not find media ID');
      return [];
    }

    console.log(`[PurStream] Found media ID: ${purstreamId}`);

    let sources = [];

    if (type === 'tv' && season && episode) {
      sources = await getEpisodeSources(purstreamId, season, episode);
      console.log(`[PurStream] Got ${sources.length} episode sources`);

      return sources
        .filter(s => s.stream_url && (s.stream_url.includes('.m3u8') || s.stream_url.includes('.mp4')))
        .map(s => {
          const quality = parseQuality(s.source_name);
          const lang = parseLang(s.source_name);
          return {
            name: `PurStream ${quality}`,
            title: `🎬 PurStream | ${quality} | ${lang}`,
            url: s.stream_url,
            quality,
            type: s.stream_url.includes('.m3u8') ? 'hls' : 'video',
            headers: { 'User-Agent': PURSTREAM_UA, 'Referer': PURSTREAM_REFERER },
          };
        });
    }

    // Movie sources
    sources = await getMovieSources(purstreamId);
    console.log(`[PurStream] Got ${sources.length} movie sources`);

    return sources
      .filter(s => s.url && (s.url.includes('.m3u8') || s.url.includes('.mp4')))
      .map(s => {
        const quality = parseQuality(s.name);
        const lang = parseLang(s.name);
        return {
          name: `PurStream ${quality}`,
          title: `🎬 PurStream | ${quality} | ${lang}`,
          url: s.url,
          quality,
          type: s.url.includes('.m3u8') ? 'hls' : 'video',
          headers: { 'User-Agent': PURSTREAM_UA, 'Referer': PURSTREAM_REFERER },
        };
      });
  } catch (err) {
    console.error('[PurStream] Error:', err.message);
    return [];
  }
}

module.exports = { getStreams };

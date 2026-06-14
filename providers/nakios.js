// nakios.js — deobfuscated
// Original: https://github.com/D3adlyRocket/All-in-One-Nuvio/blob/main/providers/nakios.js

const TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';
const NAKIOS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DOMAINS_URL = 'https://raw.githubusercontent.com/wooodyhood/nuvio-repo/main/domains.json';
const NAKIOS_FALLBACK = 'click';

let _cachedEndpoint = null;

// ─── TMDB Metadata ──────────────────────────────────────────────────────────

function getTmdbMetadata(tmdbId, type) {
  const url =
    'https://api.themoviedb.org/3/' +
    (type === 'tv' ? 'tv' : 'movie') +
    '/' + tmdbId +
    '?api_key=' + TMDB_KEY +
    '&language=en-US';

  return fetch(url)
    .then(res => res.json())
    .then(data => {
      const name = data.title || data.name || 'Nakios';
      const rawDate = data.release_date || data.first_air_date || '';
      const year = rawDate ? rawDate.split('-')[0] : '';

      let duration = '';
      if (type === 'movie' && data.runtime) {
        duration = data.runtime + ' min';
      } else if (type === 'tv' && data.episode_run_time && data.episode_run_time.length > 0) {
        duration = data.episode_run_time[0] + ' min';
      }

      return { name, year, duration };
    })
    .catch(() => ({ name: 'Nakios', year: '', duration: '' }));
}

// ─── Episode Info ────────────────────────────────────────────────────────────

function getEpisodeInfo(tmdbId, season, episode) {
  if (!tmdbId || !season || !episode) return Promise.resolve(null);

  const url =
    'https://api.themoviedb.org/3/tv/' +
    tmdbId + '/season/' + season + '/episode/' + episode +
    '?api_key=' + TMDB_KEY +
    '&language=en-US';

  return fetch(url)
    .then(res => res.json())
    .then(data => ({
      name: data.name || null,
      duration: data.runtime ? data.runtime + ' min' : null,
    }))
    .catch(() => null);
}

// ─── Endpoint Detection ──────────────────────────────────────────────────────

function buildEndpoint(domain) {
  // Ensure domain doesn't already start with "nakios."
  const host = domain.includes('nakios.') ? domain : 'nakios.' + domain;
  return {
    base: 'https://' + host,
    api: 'https://' + host + '/api',
    referer: 'https://' + host + '/',
  };
}

function detectEndpoint() {
  if (_cachedEndpoint) return Promise.resolve(_cachedEndpoint);

  return fetch(DOMAINS_URL)
    .then(res => (res.ok ? res.json() : Promise.reject()))
    .then(data => {
      _cachedEndpoint = buildEndpoint(data.nakios || NAKIOS_FALLBACK);
      return _cachedEndpoint;
    })
    .catch(() => {
      _cachedEndpoint = buildEndpoint(NAKIOS_FALLBACK);
      return _cachedEndpoint;
    });
}

// ─── Source Helpers ──────────────────────────────────────────────────────────

function extractOrigin(url) {
  const match = url.match(/^(https?:\/\/[^/]+)/);
  return match ? match[1] : null;
}

function resolveSource(source, endpoint) {
  const rawUrl = source.url || '';

  // Direct http(s) URL
  if (rawUrl.startsWith('http')) {
    return {
      url: rawUrl,
      format: source.isM3U8 || rawUrl.indexOf('.m3u8') !== -1 ? 'm3u8' : 'mp4',
      referer: endpoint.referer,
      origin: endpoint.base,
    };
  }

  // Proxy path — extract real URL from query param
  if (rawUrl.charAt(0) === '/') {
    const match = rawUrl.match(/[?&]url=([^&]+)/);
    if (!match) return null;

    let realUrl;
    try {
      realUrl = decodeURIComponent(match[1]);
    } catch {
      return null;
    }

    const origin = extractOrigin(realUrl);
    return {
      url: realUrl,
      format: 'mp4',
      referer: origin ? origin + '/' : endpoint.referer,
      origin: origin || endpoint.base,
    };
  }

  return null;
}

// ─── Normalize Sources ───────────────────────────────────────────────────────

function normalizeSources(sources, endpoint, metadata, season, episode, episodeInfo) {
  const results = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];

    // Skip embed sources
    if (source.isEmbed) continue;

    const resolved = resolveSource(source, endpoint);
    if (!resolved) continue;

    const quality = source.quality || 'HD';
    const lang = (source.lang || 'MULTI').toUpperCase();
    const format = resolved.format.toUpperCase();

    // Language flag + label
    let flag = '🇫🇷';
    let langLabel = 'VF';

    if (lang.indexOf('MULTI') !== -1 || (source.name && source.name.toUpperCase().indexOf('MULTI') !== -1)) {
      flag = '🌍';
      langLabel = 'MULTI';
    } else if (lang.indexOf('VOSTFR') !== -1) {
      flag = '🔡';
      langLabel = 'VOST';
    }

    // Title line
    let titleLine = '🎬 ';
    if (season && episode) {
      const epName = episodeInfo && episodeInfo.name ? ' - ' + episodeInfo.name : '';
      titleLine += 'S' + season + ' E' + episode + epName + ' | ' + metadata.name;
    } else {
      titleLine += metadata.name + (metadata.year ? ' - ' + metadata.year : '');
    }

    // Info badges
    const badges = [
      '📺 ' + quality,
      flag + ' ' + langLabel,
      '🎞️ ' + format,
    ];

    if (source.size) badges.push('💾 ' + source.size);

    const duration = (episodeInfo && episodeInfo.duration) ? episodeInfo.duration : metadata.duration;
    if (duration) badges.push('⏱️ ' + duration);

    results.push({
      name: 'Nakios - ' + quality,
      title: titleLine + '\n' + badges.join(' | '),
      url: resolved.url,
      quality,
      format: resolved.format,
      headers: {
        'User-Agent': NAKIOS_UA,
        'Referer': resolved.referer,
        'Origin': resolved.origin,
      },
    });
  }

  return results;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

function getStreams(tmdbId, type, season, episode) {
  return Promise.all([
    getTmdbMetadata(tmdbId, type),
    type === 'tv' ? getEpisodeInfo(tmdbId, season, episode) : Promise.resolve(null),
    detectEndpoint(),
  ]).then(([metadata, episodeInfo, endpoint]) => {
    const apiUrl =
      type === 'tv'
        ? endpoint.api + '/sources/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1)
        : endpoint.api + '/sources/movie/' + tmdbId;

    return fetch(apiUrl, {
      headers: {
        'User-Agent': NAKIOS_UA,
        'Referer': endpoint.referer,
      },
    })
      .then(res => res.json())
      .then(data => {
        if (!data.success || !data.sources) return [];
        const s = type === 'tv' ? season : null;
        const e = type === 'tv' ? episode : null;
        return normalizeSources(data.sources, endpoint, metadata, s, e, episodeInfo);
      });
  }).catch(() => []);
}

// ─── Export ──────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.nakiosGetStreams = getStreams;
}

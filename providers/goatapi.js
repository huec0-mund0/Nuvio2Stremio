/**
 * GoatAPI provider - simple API wrapper
 * Source: goatapi.imreallydagoatt.workers.dev
 * Movies only
 */

const API = 'https://goatapi.imreallydagoatt.workers.dev/api/downloader';

async function getStreams(tmdbId, type, season, episode) {
  if (type !== 'movie' || !tmdbId) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`${API}/movie/${tmdbId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return [];
    const data = await res.json();
    if (!data?.success || !data?.downloads?.length) return [];

    const streams = [];
    for (const dl of data.downloads) {
      if (!dl.sources?.length) continue;

      // Extract quality from filename
      const quality = detectQuality(dl.title);
      const size = dl.size || 'Variable';

      for (const src of dl.sources) {
        if (!src.url) continue;
        streams.push({
          name: `🐐 GoatAPI [${src.name || 'Src'}]`,
          title: `${quality} · ${size}`,
          url: src.url,
          quality: quality.toLowerCase(),
        });
      }
    }

    return streams;
  } catch {
    return [];
  }
}

function detectQuality(filename) {
  const upper = (filename || '').toUpperCase();
  if (/\b2160P\b/.test(upper) || /\b4K\b/.test(upper) || /\bUHD\b/.test(upper)) return '4K';
  if (/\b1080P\b/.test(upper)) return '1080p';
  if (/\b720P\b/.test(upper)) return '720p';
  if (/\b480P\b/.test(upper)) return '480p';
  return 'HD';
}

module.exports = { getStreams };

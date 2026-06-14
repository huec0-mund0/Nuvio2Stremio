const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const PROVIDER_ID = "Movix";
const BASE_URL = "https://movix.to";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// Proxy tunnel via Hermes (Nigeria IP) to bypass Cloudflare on movix.to
const PROXY_TUNNEL = "https://proxy.rchimezie.com/?target=";

async function safeFetch(url, options = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    Referer: BASE_URL + "/",
    ...options.headers,
  };

  try {
    // Route through proxy if it's a movix.to URL
    const fetchUrl = url.includes(BASE_URL)
      ? PROXY_TUNNEL + encodeURIComponent(url) + "&ref=" + encodeURIComponent(BASE_URL + "/")
      : url;
    const res = await fetch(fetchUrl, { ...options, headers });
    return res;
  } catch (err) {
    console.error("[Movix] Fetch error:", err.message);
    return null;
  }
}

// ─── Quality Helpers ─────────────────────────────────────
function getQualityFromUrl(url) {
  const lower = String(url || "").toLowerCase();
  if (lower.includes("2160") || lower.includes("4k")) return "4K";
  if (lower.includes("1440") || lower.includes("2k")) return "1440p";
  if (lower.includes("1080")) return "1080p";
  if (lower.includes("720")) return "720p";
  if (lower.includes("480")) return "480p";
  return "720p";
}

function inferQualityScore(urlOrText) {
  const str = String(urlOrText || "").toLowerCase();
  if (str.includes("2160") || str.includes("4k")) return 2160;
  if (str.includes("1440")) return 1440;
  if (str.includes("1080")) return 1080;
  if (str.includes("720")) return 720;
  if (str.includes("480")) return 480;
  return 720;
}

// ─── TMDB Helpers ────────────────────────────────────────
async function getTmdbMetadata(tmdbId, type, season, episode) {
  const mediaType = type === "tv" ? "tv" : "movie";
  let name = "Unknown";
  let year = "";
  let duration = type === "tv" ? "45 min" : "90 min";
  let episodeTitle = "";

  try {
    const metaUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
    const res = await safeFetch(metaUrl);
    if (res && res.ok) {
      const data = await res.json();
      name = data.title || data.name || name;
      year = (data.release_date || data.first_air_date || "").split("-")[0];
      if (data.runtime) duration = data.runtime + " min";
    }

    if (type === "tv" && season && episode) {
      const epUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}`;
      const epRes = await safeFetch(epUrl);
      if (epRes && epRes.ok) {
        const epData = await epRes.json();
        episodeTitle = epData.name || "";
        if (epData.runtime) duration = epData.runtime + " min";
      }
    }
  } catch (e) {
    console.warn("[Movix] Metadata fetch failed");
  }

  return { name, year, duration, episodeTitle };
}

// ─── Main Stream Resolver ────────────────────────────────
async function getStreams(tmdbId, mediaType, season, episode, options = null) {
  const streams = [];
  const type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";

  try {
    const meta = await getTmdbMetadata(tmdbId, type, season, episode);

    // Movix uses a direct embed/API pattern
    let apiUrl = `${BASE_URL}/api/${type}/${tmdbId}`;
    if (type === "tv") {
      apiUrl += `/${season}/${episode}`;
    }

    console.log(`[Movix] Fetching: ${apiUrl}`);

    const response = await safeFetch(apiUrl, {
      headers: { Accept: "application/json" },
    });

    if (!response || !response.ok) {
      console.warn(`[Movix] API returned status ${response?.status}`);
      return [];
    }

    const data = await response.json();

    // The site usually returns an array of sources or a single source object
    const sources = Array.isArray(data.sources)
      ? data.sources
      : data.sources
        ? [data.sources]
        : [];

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (!source || !source.url) continue;

      let url = source.url;

      // Some URLs are base64 encoded or have extra parameters
      if (url.startsWith("http") === false && url.length > 20) {
        try {
          url = Buffer.from(url, "base64").toString();
        } catch (e) {}
      }

      if (!url.startsWith("http")) continue;

      const quality = source.quality || getQualityFromUrl(url);
      const score = inferQualityScore(quality);

      // Only return streams above a certain quality threshold
      if (score < 720) continue;

      const title =
        `🎥 ${meta.name} ${meta.year ? `(${meta.year})` : ""}\n` +
        `📺 ${quality} • ${source.type || "HLS"} • ${meta.duration}\n` +
        (meta.episodeTitle ? `📖 ${meta.episodeTitle}` : "");

      streams.push({
        name: `${PROVIDER_ID} ${quality}`,
        title: title.trim(),
        url: url,
        quality: quality,
        headers: {
          "User-Agent": USER_AGENT,
          Referer: BASE_URL + "/",
        },
        provider: PROVIDER_ID,
        _score: score,
      });
    }

    // Sort by quality (highest first)
    return streams
      .sort((a, b) => b._score - a._score)
      .map(({ _score, ...stream }) => stream);
  } catch (err) {
    console.error("[Movix] Error:", err.message);
    return [];
  }
}

// ─── Export ──────────────────────────────────────────────
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}

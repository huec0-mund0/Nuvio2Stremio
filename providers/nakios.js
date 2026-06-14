const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const PROVIDER_ID = "Nakios";
const BASE_URL = "https://nakios.to";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

async function safeFetch(url, options = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    Referer: BASE_URL + "/",
    Accept: "application/json, text/html",
    ...options.headers,
  };

  try {
    const res = await fetch(url, { ...options, headers });
    return res;
  } catch (err) {
    console.error("[Nakios] Fetch error:", err.message);
    return null;
  }
}

// ─── Quality & Metadata Helpers ─────────────────────────────
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

async function getTmdbMetadata(tmdbId, mediaType, season, episode) {
  const type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
  let name = "Unknown Title";
  let year = "";
  let duration = type === "tv" ? "45 min" : "90 min";
  let episodeTitle = "";

  try {
    const metaUrl = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=it-IT`;
    const res = await safeFetch(metaUrl);
    if (res?.ok) {
      const data = await res.json();
      name = data.title || data.name || name;
      year = (data.release_date || data.first_air_date || "").split("-")[0];
      if (data.runtime) duration = `${data.runtime} min`;
    }

    if (type === "tv" && season && episode) {
      const epUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}`;
      const epRes = await safeFetch(epUrl);
      if (epRes?.ok) {
        const epData = await epRes.json();
        episodeTitle = epData.name || episodeTitle;
        if (epData.runtime) duration = `${epData.runtime} min`;
      }
    }
  } catch (err) {
    console.warn("[Nakios] Metadata fetch failed");
  }

  return { name, year, duration, episodeTitle };
}

// ─── Main Stream Resolver ───────────────────────────────────
async function getStreams(tmdbId, mediaType, season, episode, options = null) {
  const streams = [];
  const type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";

  try {
    const meta = await getTmdbMetadata(tmdbId, mediaType, season, episode);

    let apiUrl = `${BASE_URL}/api/${type === "movie" ? "film" : "serie"}/${tmdbId}`;
    if (type === "tv") {
      apiUrl += `/${season || 1}/${episode || 1}`;
    }

    console.log(`[Nakios] Fetching API: ${apiUrl}`);

    const response = await safeFetch(apiUrl);
    if (!response?.ok) {
      console.warn(`[Nakios] API returned ${response?.status}`);
      return [];
    }

    const data = await response.json();

    // Nakios usually returns { sources: [...] } or direct array
    const rawSources = data.sources || data.results || data;
    const sources = Array.isArray(rawSources)
      ? rawSources
      : rawSources
        ? [rawSources]
        : [];

    for (const source of sources) {
      if (!source?.url) continue;

      let streamUrl = source.url.trim();

      // Some links come base64 encoded
      if (!streamUrl.startsWith("http") && streamUrl.length > 15) {
        try {
          streamUrl = Buffer.from(streamUrl, "base64").toString("utf-8");
        } catch (e) {}
      }

      if (!streamUrl.startsWith("http")) continue;

      const quality = source.quality || getQualityFromUrl(streamUrl);
      const score = inferQualityScore(quality);

      // Filter out very low quality streams
      if (score < 720) continue;

      const titleParts = [
        `🎬 ${meta.name}`,
        meta.year ? `(${meta.year})` : "",
        meta.episodeTitle ? `— ${meta.episodeTitle}` : "",
        `\n📺 ${quality} • ${source.type || "HLS"} • ${meta.duration}`,
      ];

      streams.push({
        name: `${PROVIDER_ID} ${quality}`,
        title: titleParts.join(" ").trim(),
        url: streamUrl,
        quality: quality,
        headers: {
          "User-Agent": USER_AGENT,
          Referer: `${BASE_URL}/`,
          Origin: BASE_URL,
        },
        provider: PROVIDER_ID,
        _score: score,
      });
    }

    // Return highest quality first
    return streams
      .sort((a, b) => b._score - a._score)
      .map(({ _score, ...stream }) => stream);
  } catch (err) {
    console.error("[Nakios] Critical error:", err.message);
    return [];
  }
}

// ─── Export ─────────────────────────────────────────────────
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}

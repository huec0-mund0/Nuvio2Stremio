const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";

// Inferred from log strings and behavior.
const BASE_URL = "https://vixsrc.to";

// Original bundle used a real browser UA string.
// Exact value is not important to the logic.
const USER_AGENT = "Mozilla/5.0";

// In the bundled file, this formatter ended up being a passthrough.
function formatStream(stream) {
  return stream;
}

/* ---------------------------------
 * Fetch timeout helper
 * --------------------------------- */

function createTimeoutSignal(timeoutMs) {
  const ms = Number.parseInt(String(timeoutMs), 10);

  if (!Number.isFinite(ms) || ms <= 0) {
    return { signal: undefined, cleanup: null, timed: false };
  }

  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    return {
      signal: AbortSignal.timeout(ms),
      cleanup: null,
      timed: true,
    };
  }

  if (
    typeof AbortController !== "undefined" &&
    typeof setTimeout === "function"
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);

    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timer),
      timed: true,
    };
  }

  return { signal: undefined, cleanup: null, timed: false };
}

async function fetchWithTimeout(url, options = {}) {
  if (typeof fetch === "undefined") {
    throw new Error("No fetch implementation found!");
  }

  const { timeout, ...rest } = options;
  const timeoutMs = timeout || 30000;
  const timeoutCtl = createTimeoutSignal(timeoutMs);
  const finalOptions = { ...rest };

  if (timeoutCtl.signal) {
    if (
      finalOptions.signal &&
      typeof AbortSignal !== "undefined" &&
      typeof AbortSignal.any === "function"
    ) {
      finalOptions.signal = AbortSignal.any([
        finalOptions.signal,
        timeoutCtl.signal,
      ]);
    } else if (!finalOptions.signal) {
      finalOptions.signal = timeoutCtl.signal;
    }
  }

  try {
    return await fetch(url, finalOptions);
  } catch (err) {
    if (err?.name === "AbortError" && timeoutCtl.timed) {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    if (typeof timeoutCtl.cleanup === "function") {
      timeoutCtl.cleanup();
    }
  }
}

/* ---------------------------------
 * Quality helpers
 * --------------------------------- */

function checkQualityFromText(text) {
  if (!text) return null;

  if (/RESOLUTION=\d+x2160/i.test(text) || /RESOLUTION=2160/i.test(text))
    return "4K";
  if (/RESOLUTION=\d+x1440/i.test(text) || /RESOLUTION=1440/i.test(text))
    return "1440p";
  if (/RESOLUTION=\d+x1080/i.test(text) || /RESOLUTION=1080/i.test(text))
    return "1080p";
  if (/RESOLUTION=\d+x720/i.test(text) || /RESOLUTION=720/i.test(text))
    return "720p";
  if (/RESOLUTION=\d+x480/i.test(text) || /RESOLUTION=480/i.test(text))
    return "480p";

  return null;
}

function getQualityFromUrl(url) {
  if (!url) return null;

  const lower = url.split("?")[0].toLowerCase();

  if (lower.includes("4k") || lower.includes("2160")) return "4K";
  if (lower.includes("1440") || lower.includes("2k")) return "1440p";
  if (lower.includes("1080") || lower.includes("fullhd")) return "1080p";
  if (lower.includes("720") || lower.includes("hd")) return "720p";
  if (lower.includes("480") || lower.includes("sd")) return "480p";
  if (lower.includes("360")) return "360p";

  return null;
}

/* ---------------------------------
 * Base / headers
 * --------------------------------- */

function getBaseUrl() {
  return BASE_URL;
}

function getCommonHeaders() {
  return {
    "User-Agent": USER_AGENT,
    Referer: `${getBaseUrl()}/`,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
}

function getEmbedHeaders() {
  return {
    "User-Agent": USER_AGENT,
    Referer: `${getBaseUrl()}/`,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
  };
}

function getPlaylistHeaders(referer) {
  return {
    "User-Agent": USER_AGENT,
    Referer: referer,
    Origin: getBaseUrl(),
    Accept: "*/*",
    "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
}

/* ---------------------------------
 * Parsing helpers
 * --------------------------------- */

function extractEmbedSrcFromApiPayload(payload) {
  const url = payload && typeof payload === "object" ? payload.url : null;
  if (!url) return null;

  try {
    return new URL(url, getBaseUrl()).toString();
  } catch {
    return null;
  }
}

function extractMasterPlaylistFromEmbedHtml(html) {
  if (!html) return null;

  const token = html.match(/'token'\s*:\s*'([^']+)'/i)?.[1];
  const expires = html.match(/'expires'\s*:\s*'([^']+)'/i)?.[1];
  const url = html.match(/url\s*:\s*'([^']+\/playlist\/\d+[^']*)'/i)?.[1];

  if (!token || !expires || !url) return null;
  return { token, expires, url };
}

/* ---------------------------------
 * Display helpers
 * --------------------------------- */

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return "Unknown";

  const units = ["B", "KB", "MB", "GB"];
  let i = 0;

  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }

  return `${bytes.toFixed(2)} ${units[i]}`;
}

function buildTitle(meta, quality, audioLabel, format, size, season, episode) {
  const badge =
    quality.includes("4K") || quality.includes("2160") ? "🌟" : "💎";

  let line1 = "🎬 ";
  if (season && episode) {
    line1 += `S${season} E${episode} • ${meta.name}`;
    if (meta.episodeTitle && meta.episodeTitle !== "") {
      line1 += ` • ${meta.episodeTitle}`;
    }
  } else {
    line1 += `${meta.name}${meta.year ? ` (${meta.year})` : ""}`;
  }

  const line2 = `${badge} ${quality} • ${audioLabel} • ${size}`;
  const line3 = `📺 ${String(format).toUpperCase()} | ⏱️ ${meta.duration} | 📼 AVC • 🔊 AAC`;

  return `${line1}\n${line2}\n${line3}`;
}

function calculateFallbackSize(quality, durationText) {
  const minutes = parseInt(durationText) || 90;
  const lower = String(quality || "").toLowerCase();

  let bitrateKbps = 5200; // default 1080p-ish

  if (lower.includes("4k") || lower.includes("2160")) {
    bitrateKbps = 16000;
  } else if (lower.includes("1440") || lower.includes("2k")) {
    bitrateKbps = 9000;
  } else if (lower.includes("1080") || lower.includes("fullhd")) {
    bitrateKbps = 5200;
  } else if (lower.includes("720") || lower.includes("hd")) {
    bitrateKbps = 2500;
  } else if (lower.includes("480") || lower.includes("sd")) {
    bitrateKbps = 1200;
  }

  const fudgeFactor = 0.94 + (minutes % 9) / 100;
  const bytes = ((bitrateKbps * fudgeFactor * 1000) / 8) * (minutes * 60);

  return formatBytes(bytes);
}

async function getM3U8Size(m3u8Url, durationText, quality, headers = {}) {
  try {
    const res = await fetch(m3u8Url, { headers });
    if (!res.ok) {
      return calculateFallbackSize(quality, durationText);
    }

    const text = await res.text();
    const matches = [...text.matchAll(/BANDWIDTH=(\d+)/gi)];

    if (matches.length > 0) {
      const maxBandwidth = matches
        .map((m) => parseInt(m[1], 10))
        .sort((a, b) => b - a)[0];

      const minutes = parseInt(durationText) || 90;
      const bytes = (maxBandwidth / 8) * (minutes * 60);
      return formatBytes(bytes);
    }

    return calculateFallbackSize(quality, durationText);
  } catch {
    return calculateFallbackSize(quality, durationText);
  }
}

/* ---------------------------------
 * TMDB helpers
 * --------------------------------- */

async function getTmdbId(imdbId, mediaType) {
  const type = String(mediaType).toLowerCase();
  const url =
    `https://api.themoviedb.org/3/find/${imdbId}` +
    `?api_key=${TMDB_API_KEY}` +
    `&external_source=imdb_id`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (!data) return null;

    if (
      type === "movie" &&
      data.movie_results &&
      data.movie_results.length > 0
    ) {
      return data.movie_results[0].id.toString();
    }

    if (type === "tv" && data.tv_results && data.tv_results.length > 0) {
      return data.tv_results[0].id.toString();
    }

    return null;
  } catch (err) {
    console.error("[VixSrc] TMDB find lookup failed:", err);
    return null;
  }
}

async function getMetadata(
  tmdbId,
  mediaType,
  season,
  episode,
  fallback = null,
) {
  let name = "Unknown";
  let duration = mediaType === "tv" ? "45 min" : "90 min";
  let episodeTitle = "";

  if (fallback && typeof fallback === "object") {
    if (fallback.name) name = fallback.name;
    else if (fallback.title) name = fallback.title;

    if (fallback.episodeName) episodeTitle = fallback.episodeName;
    else if (fallback.episodeTitle) episodeTitle = fallback.episodeTitle;

    if (fallback.duration) duration = fallback.duration;
  }

  try {
    const type = String(mediaType).toLowerCase() === "movie" ? "movie" : "tv";

    const metaUrl =
      `${TMDB_BASE}/${type}/${tmdbId}` +
      `?api_key=${TMDB_API_KEY}` +
      `&language=it-IT`;

    const res = await fetch(metaUrl);
    if (!res.ok) throw new Error("Metadata request failed");

    const data = await res.json();

    let finalDuration = duration;
    let finalEpisodeTitle = episodeTitle;

    if (type === "movie") {
      if (data.runtime) {
        finalDuration = `${data.runtime} min`;
      }
    } else {
      const episodeUrl =
        `${TMDB_BASE}/tv/${tmdbId}/season/${season}/episode/${episode}` +
        `?api_key=${TMDB_API_KEY}`;

      const episodeRes = await fetch(episodeUrl);
      if (episodeRes.ok) {
        const episodeData = await episodeRes.json();

        if (episodeData.name) {
          finalEpisodeTitle = episodeData.name;
        }

        if (episodeData.runtime) {
          finalDuration = `${episodeData.runtime} min`;
        } else if (data.episode_run_time && data.episode_run_time.length > 0) {
          finalDuration = `${data.episode_run_time[0]} min`;
        }
      }
    }

    return {
      name: data.title || data.name || name,
      year: (data.release_date || data.first_air_date || "").split("-")[0],
      duration: finalDuration,
      episodeTitle: finalEpisodeTitle,
    };
  } catch {
    return {
      name,
      year: "",
      duration,
      episodeTitle,
    };
  }
}

/* ---------------------------------
 * Main resolver
 * --------------------------------- */

async function getStreams(id, mediaType, season, episode, options = null) {
  const rawType = String(mediaType).toLowerCase();
  const type = rawType === "series" ? "tv" : rawType;

  const baseUrl = getBaseUrl();
  const commonHeaders = getCommonHeaders();

  let tmdbId = id.toString();
  let finalSeason = season;

  // If caller already passed a TMDB id in options, prefer it.
  const explicitTmdbId =
    options && /^\d+$/.test(String(options.tmdbId || ""))
      ? String(options.tmdbId)
      : null;

  if (explicitTmdbId) {
    tmdbId = explicitTmdbId;
  } else if (tmdbId.startsWith("tmdb:")) {
    tmdbId = tmdbId.replace("tmdb:", "");
  } else if (tmdbId.startsWith("tt")) {
    const converted = await getTmdbId(tmdbId, type);
    if (converted) {
      console.log(`[VixSrc] Converted ${id} -> ${converted}`);
      tmdbId = converted;
    } else {
      console.warn(`[VixSrc] Failed to convert IMDB id ${id} to TMDB id`);
    }
  }

  let metadata = {
    name: "Unknown",
    year: "",
    duration: "90 min",
    episodeTitle: "",
  };

  try {
    metadata = await getMetadata(
      tmdbId,
      mediaType,
      finalSeason,
      episode,
      options,
    );
  } catch (err) {
    console.error("[VixSrc] Error fetching metadata:", err);
  }

  // These route patterns are inferred from behavior.
  let pageUrl;
  let apiUrl;

  if (type === "movie") {
    pageUrl = `${baseUrl}/movie/${tmdbId}`;
    apiUrl = `${baseUrl}/api/movie/${tmdbId}`;
  } else if (type === "tv") {
    pageUrl = `${baseUrl}/tv/${tmdbId}/${finalSeason}/${episode}`;
    apiUrl = `${baseUrl}/api/tv/${tmdbId}/${finalSeason}/${episode}`;
  } else {
    return [];
  }

  try {
    console.log(`[VixSrc] Fetching API: ${apiUrl}`);

    const apiRes = await fetch(apiUrl, { headers: commonHeaders });
    if (!apiRes.ok) {
      console.error(`[VixSrc] API request failed: ${apiRes.status}`);
      return [];
    }

    const apiPayload = await apiRes.json().catch(() => null);
    const embedUrl = extractEmbedSrcFromApiPayload(apiPayload);

    if (!embedUrl) {
      console.log("[VixSrc] Could not find embed src in API payload");
      return [];
    }

    // Original code had an obfuscated option flag here that switches to returning
    // the page URL directly instead of the playlist URL. Name inferred:
    if (options?.returnPageUrl) {
      const webUrl = pageUrl.endsWith("/") ? pageUrl : `${pageUrl}/`;
      const size = calculateFallbackSize("1080p", metadata.duration);
      const title = buildTitle(
        metadata,
        "AUTO",
        "MULTI",
        "HLS",
        size,
        type === "tv" ? finalSeason : null,
        type === "tv" ? episode : null,
      );

      const stream = {
        name: "🎦 VixSrc | Auto | Multi-Audio",
        title,
        url: webUrl,
        easyProxySourceUrl: webUrl,
        quality: "1080p",
        type: "url",
        behaviorHints: {
          notWebReady: false,
        },
      };

      return [formatStream(stream)].filter(Boolean);
    }

    console.log(`[VixSrc] Fetching embed: ${embedUrl}`);

    const embedRes = await fetch(embedUrl, { headers: getEmbedHeaders() });
    if (!embedRes.ok) {
      console.error(`[VixSrc] Embed request failed: ${embedRes.status}`);
      return [];
    }

    const embedHtml = await embedRes.text();
    if (!embedHtml) return [];

    const playlistInfo = extractMasterPlaylistFromEmbedHtml(embedHtml);
    if (!playlistInfo) {
      console.log("[VixSrc] Could not find playlist info in HTML");
      return [];
    }

    const playlistUrl =
      `${playlistInfo.url}` +
      `?token=${encodeURIComponent(playlistInfo.token)}` +
      `&expires=${encodeURIComponent(playlistInfo.expires)}` +
      `&h=1&lang=it`;

    const playlistHeaders = getPlaylistHeaders(embedUrl);

    console.log(`[VixSrc] Master playlist: ${playlistUrl}`);

    let audioLabel = "MULTI";
    let quality = "1080p";

    try {
      const playlistRes = await fetch(playlistUrl, {
        headers: playlistHeaders,
      });
      if (playlistRes.ok) {
        const playlistText = await playlistRes.text();

        quality =
          checkQualityFromText(playlistText) ||
          getQualityFromUrl(playlistUrl) ||
          getQualityFromUrl(embedUrl) ||
          "1080p";

        const langMatches = [...playlistText.matchAll(/LANGUAGE="([^"]+)"/gi)];
        const langs = [...new Set(langMatches.map((m) => m[1].toLowerCase()))];

        if (
          langs.length > 1 ||
          playlistText.includes('GROUP-ID="audio"') ||
          playlistUrl.includes("lang=it")
        ) {
          audioLabel = "MULTI";
        } else if (langs.length === 1) {
          const lang = langs[0];
          if (lang.includes("it")) {
            audioLabel = "ITA";
          } else if (lang.includes("en")) {
            audioLabel = "ENG";
          } else {
            audioLabel = lang.toUpperCase();
          }
        }
      }
    } catch (err) {
      console.warn("[VixSrc] Failed to inspect master playlist:", err);
    }

    const size = await getM3U8Size(
      playlistUrl,
      metadata.duration,
      quality,
      playlistHeaders,
    );

    let format = "HLS";
    const lowerPath = playlistUrl.split("?")[0].toLowerCase();

    if (lowerPath.includes(".m3u8")) {
      format = "HLS";
    } else if (lowerPath.includes(".mkv")) {
      format = "MKV";
    } else if (lowerPath.includes(".mpd")) {
      format = "DASH";
    } else if (lowerPath.includes(".mp4")) {
      format = "MP4";
    }

    const title = buildTitle(
      metadata,
      quality,
      audioLabel,
      format,
      size,
      type === "tv" ? finalSeason : null,
      type === "tv" ? episode : null,
    );

    const stream = {
      name: `🎦 VixSrc | ${quality} • ${audioLabel}`,
      title,
      url: playlistUrl,
      easyProxySourceUrl: embedUrl,
      quality: quality.toLowerCase().includes("p") ? quality : "1080p",
      type: "url",
      headers: playlistHeaders,
      behaviorHints: {
        notWebReady: false,
      },
    };

    return [formatStream(stream)].filter(Boolean);
  } catch (err) {
    console.error("[VixSrc] Error:", err);
    return [];
  }
}

module.exports = {
  getStreams,
};

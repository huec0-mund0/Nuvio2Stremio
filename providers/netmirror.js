/**
 * NetMirror provider - routes through Cloudflare Worker proxy
 * Worker URL can be set via CF_WORKER_URL env var, or defaults below
 */
const PROXY_BASE = process.env.NETMIRROR_PROXY || process.env.CF_WORKER_URL || 'https://proxy.rchimezie.com/?target=';
const STREAM_PROXY_BASE = process.env.ADDON_URL || 'https://nuvio2stremio.onrender.com';

async function proxyFetch(url, options = {}) {
  const targetEncoded = encodeURIComponent(url);
  let targetUrl = PROXY_BASE + targetEncoded;
  
  // Pass headers as URL params (cleaner than header forwarding)
  const headers = options.headers || {};
  if (headers.ott) targetUrl += '&ott=' + encodeURIComponent(headers.ott);
  if (headers['x-requested-with']) targetUrl += '&xreq=' + encodeURIComponent(headers['x-requested-with']);
  if (headers['User-Agent']) targetUrl += '&ua=' + encodeURIComponent(headers['User-Agent']);
  if (headers.Referer) targetUrl += '&ref=' + encodeURIComponent(headers.Referer);

  return fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
}

const FALLBACK_NF_API = 'https://tv.imgcdn.kim/newtv';
const OTT_SERVICES = [
  { code: 'nf', name: 'Netflix' },
  { code: 'pv', name: 'PrimeVideo' },
  { code: 'hs', name: 'Hotstar' },
];

async function getNfMirrorApi() {
  try {
    const resp = await fetch('https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json');
    const data = await resp.json();
    return data.nfmirror || FALLBACK_NF_API;
  } catch {
    console.log('[NetMirror] Using fallback API URL');
    return FALLBACK_NF_API;
  }
}

async function generateM3u8(m3u8Url, headers = {}) {
  try {
    console.log('[NetMirror] Parsing master m3u8:', m3u8Url);
    const resp = await proxyFetch(m3u8Url, { headers });
    const text = await resp.text();
    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    const streams = [];
    const regex = /#EXT-X-STREAM-INF:.*?RESOLUTION=(\d+x\d+).*?\n([^\n]+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const height = parseInt(match[1].split('x')[1]);
      if (height < 720) continue;
      const quality = height + 'p';
      let streamUrl = match[2].trim();
      if (!streamUrl.startsWith('http')) {
        if (streamUrl.startsWith('/')) {
          streamUrl = new URL(m3u8Url).origin + streamUrl;
        } else {
          streamUrl = baseUrl + streamUrl;
        }
      }
      streams.push({ quality, url: streamUrl });
    }
    return streams;
  } catch (err) {
    console.warn('[NetMirror] Error parsing M3U8:', err.message);
    return [];
  }
}

function matchTitle(results, title) {
  if (!results || !title) return null;
  const lowerTitle = title.toLowerCase().trim();
  return results.find(r => r.t && r.t.toLowerCase().trim() === lowerTitle) || null;
}

/** Find all exact title matches (handles duplicate titles, picks the right one) */
function matchAllTitles(results, title) {
  if (!results || !title) return [];
  const lowerTitle = title.toLowerCase().trim();
  return results.filter(r => r.t && r.t.toLowerCase().trim() === lowerTitle);
}

async function getStreams(id, type, season, episode, mediaTitle) {
  console.log(`[NetMirror] Starting search for ${type} ${id} title="${mediaTitle || '?'}"`);
  const streams = [];
  
  // Normalize type — Stremio passes 'series' but API expects 'tv'
  const normalizedType = type === 'series' ? 'tv' : type;

  try {
    const apiBase = await getNfMirrorApi();
    console.log('[NetMirror] Resolved API base:', apiBase);

    for (const service of OTT_SERVICES) {
      try {
        console.log(`[NetMirror] Searching ${service.name} for "${mediaTitle}"`);
        
        const searchResp = await proxyFetch(
          `${apiBase}/search.php?s=${encodeURIComponent(mediaTitle)}`,
          { headers: { 'ott': service.code, 'x-requested-with': 'NetmirrorNewTV v1.0', 'User-Agent': 'Mozilla/5.0' } }
        );
        
        // Check response
        const text = await searchResp.text();
        let searchData;
        try { searchData = JSON.parse(text); } catch {
          console.log(`[NetMirror] ${service.name} returned non-JSON, skipping`);
          continue;
        }
        
        const results = searchData.searchResult || [];
        const match = matchTitle(results, mediaTitle);

        if (!match || !match.id) {
          console.log(`[NetMirror] No direct match on ${service.name}`);
          continue;
        }

        let contentId = match.id;

        if (normalizedType === 'tv' && season && episode) {
          console.log(`[NetMirror] TV Match on ${service.name}, ID: ${match.id}, looking for S${season}E${episode}`);
          
          // Try all exact title matches — some may be wrong entries with no matching season
          const allMatches = matchAllTitles(results, mediaTitle);
          let episodeFound = false;
          
          for (const candidate of allMatches) {
            const cid = candidate.id;
            console.log(`[NetMirror] Trying candidate ID: ${cid}`);
            
            const postResp = await proxyFetch(
              `${apiBase}/post.php?id=${cid}`,
              { headers: { 'ott': service.code, 'x-requested-with': 'NetmirrorNewTV v1.0', 'User-Agent': 'Mozilla/5.0' } }
            );
            const postText = await postResp.text();
            let postData;
            try { postData = JSON.parse(postText); } catch { continue; }
            
            const seasons = postData.season || [];
            const seasonStr = `Season ${season}`;
            const seasonMatch = seasons.find(s => s.s && s.s.toString().includes(seasonStr));
            if (!seasonMatch || !seasonMatch.id) {
              console.log(`[NetMirror] Season ${season} not found in candidate ${cid}`);
              continue;
            }

            let episodeId = null;
            let page = 1;
            while (!episodeId && page < 10) {
              const epResp = await proxyFetch(
                `${apiBase}/episodes.php?season_id=${seasonMatch.id}&page=${page}`,
                { headers: { 'ott': service.code, 'x-requested-with': 'NetmirrorNewTV v1.0', 'User-Agent': 'Mozilla/5.0' } }
              );
              const epText = await epResp.text();
              let epData;
              try { epData = JSON.parse(epText); } catch { break; }
              
              const episodes = epData.episodes || [];
              const epMatch = episodes.find(e => e.ep && parseInt(e.ep) === parseInt(episode));
              if (epMatch && epMatch.id) { episodeId = epMatch.id; }
              if (parseInt(epData.nextPageShow) !== 1) break;
              page++;
            }
            
            if (episodeId) {
              contentId = episodeId;
              episodeFound = true;
              console.log(`[NetMirror] Found episode, ID: ${episodeId}`);
              break; // Found the right entry, stop trying candidates
            }
          }
          
          if (!episodeFound) {
            console.log(`[NetMirror] Episode ${episode} not found on ${service.name}`);
            continue;
          }
        }

        console.log(`[NetMirror] Fetching final stream payload for ID ${contentId} on ${service.name}`);
        const playerResp = await proxyFetch(
          `${apiBase}/player.php?id=${contentId}`,
          { headers: { 'ott': service.code, 'x-requested-with': 'NetmirrorNewTV v1.0', 'User-Agent': 'Mozilla/5.0' } }
        );
        const playerText = await playerResp.text();
        let playerData;
        try { playerData = JSON.parse(playerText); } catch { continue; }

        if (playerData && playerData.video_link) {
          const videoUrl = playerData.video_link;
          const isHls = videoUrl.includes('.m3u8');

          streams.push({
            name: service.name,
            title: 'Auto',
            url: STREAM_PROXY_BASE + '/proxy/' + encodeURIComponent(videoUrl),
            quality: 'Auto',
            type: isHls ? 'hls' : (videoUrl.includes('.mp4') || videoUrl.includes('.mkv') ? 'video' : null),
            headers: { Referer: playerData.referer || '', 'User-Agent': 'Mozilla/5.0' },
            provider: 'netmirror',
          });

          if (isHls) {
            try {
              const qualities = await generateM3u8(videoUrl, {
                Referer: playerData.referer || '',
                'User-Agent': 'Mozilla/5.0',
              });
              qualities.forEach(q => {
                streams.push({
                  name: service.name,
                  title: q.quality,
                  url: STREAM_PROXY_BASE + '/proxy/' + encodeURIComponent(q.url),
                  quality: q.quality,
                  type: 'hls',
                  headers: { Referer: playerData.referer || '', 'User-Agent': 'Mozilla/5.0' },
                  provider: 'netmirror',
                });
              });
            } catch {}
          }
          console.log(`[NetMirror] SUCCESS: Captured link for ${service.name}`);
        }
      } catch (err) {
        console.log(`[NetMirror] Error with ${service.name}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[NetMirror] Error:', err.message);
  }

  console.log(`[NetMirror] Returning total ${streams.length} stream(s).`);
  return streams.map(s => ({
    ...s,
    quality: s.quality === 'Auto' ? s.quality : '​​' + s.quality,
  }));
}

module.exports = { getStreams };

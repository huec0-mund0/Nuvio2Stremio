/**
 * VidFast provider - ported from CineStream
 * Source: vidfast.pro using Next.js RSC + decrypt API
 */
const DECRYPT_API = 'https://enc-dec.app/api';
const VIDFAST = 'https://vidfast.pro';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

async function fetchText(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || 10000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body,
      signal: controller.signal,
    });
    return await res.text();
  } finally { clearTimeout(timer); }
}

async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  return JSON.parse(text);
}

async function getVidFastStreams(tmdbId, season, episode) {
  if (!tmdbId) return [];

  try {
    const url = season == null
      ? `${VIDFAST}/movie/${tmdbId}/`
      : `${VIDFAST}/tv/${tmdbId}/${season}/${episode}/`;

    const html = await fetchText(url, { timeout: 12000 });

    // Extract 'en' value from Next.js __next_f.push payloads
    let fullPayload = '';
    const pushRegex = /self\.__next_f\.push\(\[1,"(.+?)"\]\)/g;
    let m;
    while ((m = pushRegex.exec(html)) !== null) fullPayload += m[1];
    const unescaped = fullPayload.replace(/\\"/g, '"');
    const enIdx = unescaped.indexOf('"en":"');
    if (enIdx < 0) return [];
    const encodedText = unescaped.substring(enIdx + 6, unescaped.indexOf('"', enIdx + 6));

    const decData = await fetchJson(`${DECRYPT_API}/enc-vidfast?text=${encodeURIComponent(encodedText)}&version=1`, { timeout: 10000 });
    const decoded = decData?.result;
    if (!decoded?.servers || !decoded?.stream || !decoded?.token) return [];

    const csrfHeaders = {
      'User-Agent': UA,
      'X-CSRF-Token': decoded.token,
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    const serversEnc = await fetchText(decoded.servers, { method: 'POST', headers: csrfHeaders, timeout: 10000 });
    if (!serversEnc || serversEnc.length < 10) return [];

    const serversDec = await fetchJson(`${DECRYPT_API}/dec-vidfast`, {
      timeout: 10000,
      method: 'POST',
      body: JSON.stringify({ text: serversEnc, version: '1' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const serverList = (serversDec?.result || []).slice(0, 5);
    const results = await Promise.allSettled(serverList.map(async (server) => {
      try {
        const hash = server.data;
        if (!hash) return null;
        const enc2 = await fetchText(`${decoded.stream}/${hash}`, { method: 'POST', headers: csrfHeaders, timeout: 8000 });
        if (!enc2 || enc2.length < 10) return null;
        const dec2 = await fetchJson(`${DECRYPT_API}/dec-vidfast`, {
          timeout: 8000,
          method: 'POST',
          body: JSON.stringify({ text: enc2, version: '1' }),
          headers: { 'Content-Type': 'application/json' },
        });
        const streamData = dec2?.result;
        const fileUrl = streamData?.url || streamData?.sources?.[0]?.url;
        if (!fileUrl) return null;
        const name = `🎬 VidFast [${server.name || 'Server'}]`;
        const is4k = streamData?.is4kAvailable || server.description?.includes('4K');
        return {
          name,
          title: is4k ? '4K' : '1080p',
          url: fileUrl,
        };
      } catch { return null; }
    }));

    const streams = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) streams.push(r.value);
    }
    return streams;
  } catch (e) {
    console.log(`[VidFast] Error: ${e.message}`);
    return [];
  }
}

module.exports = { getVidFastStreams };

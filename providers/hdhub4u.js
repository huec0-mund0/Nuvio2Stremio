/**
 * HDHub4u provider - dynamic domains with hubcloud resolver
 * Based on the working version from All-in-One-Nuvio
 */

const cheerio = require('cheerio');

const DOMAINS_URL = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';
let MAIN_URL = 'https://new1.hdhub4u.cl';
let domainCache = 0;

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

async function fetchText(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || 10000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: `${MAIN_URL}/`, ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body,
      signal: controller.signal,
    });
    return await res.text();
  } finally { clearTimeout(timer); }
}

async function updateDomain() {
  if (Date.now() - domainCache < 300000) return;
  try {
    const text = await fetchText(DOMAINS_URL, { timeout: 5000 });
    const data = JSON.parse(text);
    if (data?.HDHUB4u && data.HDHUB4u !== MAIN_URL) {
      MAIN_URL = data.HDHUB4u;
      domainCache = Date.now();
    }
  } catch {}
}

function rot13(str) {
  return str.replace(/[a-zA-Z]/g, c =>
    String.fromCharCode(c <= 'Z' ? 90 : 122 >= (c = c.charCodeAt(0) + 13) ? c : c - 26)
  );
}

function btoa(s) { return Buffer.from(s).toString('base64'); }
function atob(s) { return Buffer.from(s, 'base64').toString('utf-8'); }

async function resolveHubCloud(url, referer) {
  try {
    let currentUrl = url;
    if (currentUrl.includes('hubcloud.ink')) {
      currentUrl = currentUrl.replace('hubcloud.ink', 'hubcloud.dad');
    }

    const pageHtml = await fetchText(currentUrl, { headers: { Referer: referer }, timeout: 8000 });
    if (!pageHtml) return null;

    const $ = cheerio.load(pageHtml);
    const size = $('i#size').text().trim();
    const header = $('div.card-header').text().trim();
    const qualityMatch = header.match(/(\d{3,4})[pP]/);
    const quality = qualityMatch ? qualityMatch[0].toLowerCase() : 'HD';

    // Try to find gamerxyt redirector link
    let directUrl = null;
    $('a[href*="gamerxyt.com"]').each((i, el) => {
      if (!directUrl) directUrl = $(el).attr('href');
    });

    if (directUrl) {
      try {
        const gamerHtml = await fetchText(directUrl, { headers: { Referer: currentUrl }, timeout: 8000 });
        if (gamerHtml) {
          const $$ = cheerio.load(gamerHtml);
          let finalUrl = null;
          $$('a[id="fsl"]').each((i, el) => {
            if (!finalUrl) finalUrl = $(el).attr('href');
          });
          if (!finalUrl) {
            const match = gamerHtml.match(/href="([^"]*\.(?:mkv|mp4)[^"]*)"/);
            if (match) finalUrl = match[1];
          }
          if (finalUrl) {
            return { url: finalUrl, quality, size };
          }
        }
      } catch {}
    }

    // Try alternative: x-href attribute with base64
    const xHrefMatch = pageHtml.match(/x-href="([^"]+)"/);
    if (xHrefMatch) {
      try {
        const decoded = atob(xHrefMatch[1]);
        if (decoded.includes('gamerxyt')) {
          const gamerHtml = await fetchText(decoded, { headers: { Referer: currentUrl }, timeout: 8000 });
          if (gamerHtml) {
            const match = gamerHtml.match(/href="([^"]*\.(?:mkv|mp4)[^"]*)"/);
            if (match) return { url: match[1], quality, size };
          }
        }
      } catch {}
    }

    return null;
  } catch { return null; }
}

async function getStreams(tmdbId, type, season, episode) {
  if (type !== 'movie' || !tmdbId) return [];
  await updateDomain();

  try {
    // Search: HDHub4u uses title-based URLs
    // We need TMDB metadata first - we'll search by tmdbId or title
    // The site search is title-based, so we use TMDB API for the title
    let title = '';
    try {
      const meta = await fetchText(
        `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=439c478a771f35c05022f9feabcca01c`,
        { timeout: 5000 }
      );
      const metaData = JSON.parse(meta);
      title = metaData.title || '';
    } catch {}

    if (!title) return [];

    const searchUrl = `${MAIN_URL}/?s=${encodeURIComponent(title)}`;
    const html = await fetchText(searchUrl, { timeout: 12000 });
    if (!html) return [];

    const $ = cheerio.load(html);
    const movieLinks = [];

    // Find movie post links
    $('a[href*="/movies/"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && !href.includes('/genre/') && !href.includes('/category/') && !movieLinks.includes(href)) {
        movieLinks.push(href);
      }
    });

    if (movieLinks.length === 0) return [];

    // Visit the movie page and find hubcloud links
    const movieHtml = await fetchText(movieLinks[0], { timeout: 12000 });
    if (!movieHtml) return [];

    const $$ = cheerio.load(movieHtml);
    const hubLinks = [];
    $$('a[href*="hubcloud"], a[href*="hubdrive"], a[href*="hubcdn"]').each((i, el) => {
      const href = $$(el).attr('href');
      const label = $$(el).text().trim() || 'HD';
      if (href) {
        hubLinks.push({ url: href, label });
      }
    });

    // If no direct hub links, look for redirect/embed links
    if (hubLinks.length === 0) {
      $$('a[href*="?id="]').each((i, el) => {
        const href = $$(el).attr('href');
        if (href) hubLinks.push({ url: href, label: 'HD' });
      });
    }

    // Resolve up to 5 hubcloud links
    const results = [];
    const batch = hubLinks.slice(0, 5);
    const resolved = await Promise.allSettled(
      batch.map(l => resolveHubCloud(l.url, movieLinks[0]))
    );

    for (const r of resolved) {
      if (r.status === 'fulfilled' && r.value) {
        results.push({
          name: `📀 HDHub4u | ${r.value.quality}`,
          title: r.value.quality + (r.value.size ? ` · ${r.value.size}` : ''),
          url: r.value.url,
          quality: r.value.quality,
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}

module.exports = { getStreams };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

const GENRE_OPTIONS = ['Trending', 'Censored', 'Không che', 'Beauty', 'Việt sub'];

const GENRE_MAP = {
  'Trending': 'trending',
  'Censored': 'category/censored-2',
  'Không che': 'category/uncensored-3',
  'Beauty': 'category/beauty-4',
  'Việt sub': 'tag/vietsub'
};

const MANIFEST = {
  id: 'org.stremio.javhd.vercel.v1',
  version: '1.0.0',
  name: 'JavHD - Vercel',
  description: 'Addon xem JavHD trên Stremio qua Vercel',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  idPrefixes: ['javhd:'],
  catalogs: [
    {
      type: 'movie',
      id: 'javhd_catalog',
      name: 'JavHD',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
        { name: 'skip', isRequired: false }
      ],
      extraSupported: ['search', 'genre', 'skip']
    }
  ]
};

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function decodeEntities(encodedString) {
  if (!encodedString) return '';
  let str = encodedString;
  str = str.replace(/&#(\d+);?/g, (match, dec) => String.fromCharCode(dec));
  str = str.replace(/&#x([0-9a-f]+);?/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  return str
    .replace(/&quot;?/gi, '"')
    .replace(/&apos;?/gi, "'")
    .replace(/&#039;?/g, "'")
    .replace(/&#39;?/g, "'")
    .replace(/&amp;?/gi, '&')
    .replace(/&lt;?/gi, '<')
    .replace(/&gt;?/gi, '>')
    .replace(/&nbsp;?/gi, ' ')
    .trim();
}

function encodeId(url, title) {
  const payload = JSON.stringify([url, title]);
  return 'javhd:' + Buffer.from(payload).toString('base64').replace(/=/g, '');
}

function decodeId(rawId) {
  try {
    let base64 = rawId.replace(/^javhd:/, '');
    while (base64.length % 4) base64 += '=';
    const jsonStr = Buffer.from(base64, 'base64').toString('utf8');
    const [url, title] = JSON.parse(jsonStr);
    return { url, title };
  } catch (e) {
    const clean = rawId.replace(/^javhd:/, '');
    return { url: clean, title: 'Phim JavHD' };
  }
}

async function getBaseUrl() {
  return 'https://javhdz.cam/';
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const urlObj = new URL(req.url, `https://${req.headers.host}`);
  const pathname = urlObj.pathname;
  const query = Object.fromEntries(urlObj.searchParams.entries());

  try {
    if (pathname === '/' || pathname === '/api' || pathname === '/api/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`<h1>${MANIFEST.name}</h1><p>Install: <a href="/manifest.json">manifest.json</a></p>`);
    }

    if (pathname === '/manifest.json' || pathname === '/api/manifest.json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).json(MANIFEST);
    }

    if (pathname.startsWith('/catalog/movie/javhd_catalog')) {
      const baseUrl = await getBaseUrl();
      let genreName = 'Trending';
      let searchQuery = query.search || '';
      let skipVal = parseInt(query.skip || '0', 10);

      const pathParts = pathname.split('/');
      for (let part of pathParts) {
        if (part.includes('genre=')) {
          const matchGenre = part.match(/genre=([^&]+)/);
          if (matchGenre) genreName = decodeURIComponent(matchGenre[1]);
        }
        if (part.includes('search=')) {
          const matchSearch = part.match(/search=([^&]+)/);
          if (matchSearch) searchQuery = decodeURIComponent(matchSearch[1]);
        }
        if (part.includes('skip=')) {
          const matchSkip = part.match(/skip=(\d+)/);
          if (matchSkip) skipVal = parseInt(matchSkip[1], 10);
        }
      }

      const page = Math.floor(skipVal / 24) + 1;
      const slugSegment = GENRE_MAP[genreName] || 'trending';

      let targetUrl = baseUrl;
      if (searchQuery) {
        targetUrl = page > 1 
          ? `${baseUrl}search/${encodeURIComponent(searchQuery)}/page/${page}/` 
          : `${baseUrl}search/${encodeURIComponent(searchQuery)}`;
      } else {
        const cleanSlug = slugSegment.replace(/\/+$/, '');
        targetUrl = page > 1 
          ? `${baseUrl}${cleanSlug}/page/${page}/` 
          : `${baseUrl}${cleanSlug}`;
      }

      const response = await fetch(targetUrl, {
        headers: { 
          'User-Agent': UA, 
          'Referer': baseUrl,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (!response.ok) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).json({ metas: [] });
      }

      const html = await response.text();
      const metas = [];
      const itemRegex = /<a[^>]*href="([^"]+)"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/g;
      let match;
      while ((match = itemRegex.exec(html)) !== null) {
        let href = match[1];
        let title = decodeEntities(match[2]);
        let poster = match[3];

        if (!href.startsWith('http')) {
          href = `${baseUrl.slice(0, -1)}${href.startsWith('/') ? '' : '/'}${href}`;
        }
        if (!poster.startsWith('http')) {
          poster = `${baseUrl.slice(0, -1)}${poster.startsWith('/') ? '' : '/'}${poster}`;
        }

        const safeStremioId = encodeId(href, title);

        if (!metas.some(m => m.id === safeStremioId)) {
          metas.push({
            id: safeStremioId,
            type: 'movie',
            name: title,
            poster: poster,
            posterShape: 'landscape'
          });
        }
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).json({ metas });
    }

    if (pathname.startsWith('/meta/movie/')) {
      const baseUrl = await getBaseUrl();
      const rawId = pathname.replace('/meta/movie/', '').replace('.json', '');
      const { url: detailUrl, title: fallbackTitle } = decodeId(rawId);

      let title = fallbackTitle;
      let description = fallbackTitle;
      let poster = '';

      if (detailUrl) {
        const response = await fetch(detailUrl, {
          headers: { 'User-Agent': UA, 'Referer': baseUrl }
        });

        if (response.ok) {
          const html = await response.text();
          const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
                             html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
          if (titleMatch) {
            title = decodeEntities(titleMatch[1].replace(/<[^>]+>/g, ''));
          }
          const posterMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
          if (posterMatch) {
            poster = posterMatch[1];
          }
          const descMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
          if (descMatch) {
            description = decodeEntities(descMatch[1]);
          }
        }
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).json({
        meta: {
          id: rawId,
          type: 'movie',
          name: title,
          poster: poster,
          posterShape: 'landscape',
          description: description || title
        }
      });
    }

    if (pathname.startsWith('/stream/movie/')) {
      const baseUrl = await getBaseUrl();
      const rawId = pathname.replace('/stream/movie/', '').replace('.json', '');
      const { url: detailUrl } = decodeId(rawId);

      if (!detailUrl) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).json({ streams: [] });
      }

      let directStreamUrl = null;
      const response = await fetch(detailUrl, {
        headers: { 'User-Agent': UA, 'Referer': baseUrl }
      });

      if (response.ok) {
        const html = await response.text();
        const atobMatch = html.match(/atob\((["'])(.*?)\1\)/);
        if (atobMatch && atobMatch[2]) {
          const base64Str = atobMatch[2];
          directStreamUrl = Buffer.from(base64Str, 'base64').toString('utf8').trim().replace(/\s+/g, '%20');
        }
      }

      const streams = [];
      if (directStreamUrl) {
        streams.push({
          name: 'JavHD',
          title: '▶ Xem Trực Tiếp (HD)',
          url: directStreamUrl,
          behaviorHints: {
            notWebReady: false,
            proxyHeaders: {
              request: {
                'User-Agent': UA,
                'Referer': baseUrl
              }
            }
          }
        });
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).json({ streams });
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(404).json({ error: 'Not Found' });

  } catch (e) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ error: e.message });
  }
}
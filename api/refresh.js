// News Pulse backend - Google News RSS only
// One file, no dependencies, runs on Vercel's free tier.

export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN = '*'; // tighten this to your app's URL once deployed

function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res;
}

function json(body, status = 200) {
  return cors(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

// Pull the text inside an XML tag, e.g. <title>...</title>
function tag(xml, name) {
  const re = new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i');
  const m = xml.match(re);
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
}

function parseRss(xml) {
  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/g;
  const matches = xml.match(itemRegex) || [];
  for (const raw of matches) {
    const title = tag(raw, 'title');
    const link = tag(raw, 'link');
    const pubDate = tag(raw, 'pubDate');
    const description = tag(raw, 'description');
    const sourceMatch = raw.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch
      ? sourceMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()
      : 'Google News';
    items.push({ title, link, pubDate, description, source });
  }
  return items;
}

const OBITUARY_KEYWORDS = [
  'obituary', 'obituaries', 'passed away', 'died', 'death of',
  'in memoriam', 'funeral', 'remembering', 'laid to rest',
];
const isObituary = (t) => OBITUARY_KEYWORDS.some((k) => t.toLowerCase().includes(k));

function stableId(...parts) {
  const s = parts.filter(Boolean).join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 'gnews-' + Math.abs(h).toString(36);
}

async function fetchForPerson(person) {
  const query = encodeURIComponent('"' + person.fullName + '"');
  const url = 'https://news.google.com/rss/search?q=' + query + '&hl=en-US&gl=US&ceid=US:en';
  const res = await fetch(url, { headers: { 'User-Agent': 'NewsPulse/1.0' } });
  if (!res.ok) throw new Error('Google News returned ' + res.status);
  const xml = await res.text();
  return parseRss(xml).slice(0, 10).map((item) => {
    const text = (item.title || '') + ' ' + (item.description || '');
    return {
      articleId: stableId(person.personId, item.link || item.title),
      title: item.title,
      summary: (item.description || '').replace(/<[^>]+>/g, '').slice(0, 280),
      source: item.source || 'Google News',
      url: item.link,
      publishedDate: item.pubDate
        ? new Date(item.pubDate).toISOString().slice(0, 10)
        : '',
      personId: person.personId,
      topic: { Value: 'Leadership' },
      sentiment: { Value: 'Neutral' },
      isObituary: isObituary(text),
      isDemo: false,
    };
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method === 'GET') {
    return json({ ok: true, version: '1.0', message: 'News Pulse backend is running' });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const people = (body.people || []).filter((p) => p && p.fullName && p.personId);
  if (people.length === 0) {
    return json({ articles: [], note: 'No people to query.' });
  }

  const results = await Promise.allSettled(people.map(fetchForPerson));
  const articles = [];
  let errors = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') articles.push(...r.value);
    else errors++;
  }
  return json({
    articles,
    note:
      'Pulled ' + articles.length + ' headlines for ' + people.length +
      (people.length === 1 ? ' person' : ' people') +
      (errors ? ' (' + errors + ' failed)' : '') + '.',
  });
}

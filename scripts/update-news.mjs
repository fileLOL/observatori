import fs from 'node:fs/promises';

const CONTENT_FILE = 'data/content.json';
const SOURCES_FILE = 'data/sources.json';
const MOVEMENTS_FILE = 'data/movements.json';
const STANCES_FILE = 'data/stances.json';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8';
const DAY_MS = 86400000;

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  middot: '·', deg: '°', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à',
  acirc: 'â', ccedil: 'ç', iacute: 'í', oacute: 'ó', uacute: 'ú', ograve: 'ò',
  ucirc: 'û', shy: '', zwnj: ''
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function decodeEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (match, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
    });
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try { return String.fromCodePoint(code); } catch { return ''; }
}

function stripCdata(value) {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function cleanText(value) {
  if (!value) return '';
  return decodeEntities(stripCdata(value))
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstTag(block, tags) {
  for (const tag of tags) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = block.match(re);
    if (match && match[1] != null) {
      const value = cleanText(match[1]);
      if (value) return value;
    }
  }
  return '';
}

function rawTag(block, tags) {
  for (const tag of tags) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = block.match(re);
    if (match && match[1] != null) return stripCdata(match[1]).trim();
  }
  return '';
}

function extractLink(block) {
  const links = [...block.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
  const withHref = links
    .map(tag => ({ tag, href: (tag.match(/href=["']([^"']+)["']/i) || [])[1] }))
    .filter(entry => entry.href);
  const preferred = withHref.find(entry => /rel=["']?alternate/i.test(entry.tag)) || withHref[0];
  if (preferred) return decodeEntities(preferred.href).trim();
  const inline = rawTag(block, ['link']);
  if (inline && /^https?:\/\//i.test(inline)) return inline;
  const guid = rawTag(block, ['guid', 'id']);
  if (/^https?:\/\//i.test(guid)) return guid;
  return '';
}

function extractImage(block) {
  const media = block.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*url=["']([^"']+)["']/i);
  if (media) return media[1];
  const body = block.match(/<img\b[^>]*src=["']([^"']+)["']/i);
  return body ? body[1] : '';
}

function parseDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso;
  const dmy = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) {
    const parsed = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const dmyEnd = trimmed.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (dmyEnd) {
    const parsed = new Date(Number(dmyEnd[1]), Number(dmyEnd[2]) - 1, Number(dmyEnd[3]));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function splitBlocks(xml) {
  const items = [...xml.matchAll(/<item\b[\s>][\s\S]*?<\/item>/gi)].map(m => m[0]);
  if (items.length) return items;
  return [...xml.matchAll(/<entry\b[\s>][\s\S]*?<\/entry>/gi)].map(m => m[0]);
}

function truncate(value, max) {
  if (!value) return '';
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

const TRACKING_PARAMS = /^(utm_|ic_|at_|cmp|cmpid|ito|fbclid|gclid|ref|source|origen|origem)/i;

function normalizeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const kept = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAMS.test(key));
    url.search = '';
    kept.forEach(([key, val]) => url.searchParams.append(key, val));
    return url.toString().replace(/\/$/, '');
  } catch {
    return String(value).trim();
  }
}

function normalizeTitle(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 70);
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function hasKeyword(haystack, needle) {
  const term = normalize(needle);
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}`, 'i').test(haystack);
}

function findMatches(haystack, needles) {
  let count = 0;
  for (const needle of needles) {
    if (!needle) continue;
    if (hasKeyword(haystack, needle)) count += 1;
  }
  return count;
}

function buildHaystack(title, text) {
  return normalize(`${title} ${text}`);
}

function classify(title, text, bias, topics) {
  const haystack = buildHaystack(title, text);
  const titleHay = buildHaystack(title, '');
  let best = null;
  let bestScore = 0;
  for (const [topic, keywords] of Object.entries(topics)) {
    if (!keywords || !keywords.length) continue;
    const score = findMatches(haystack, keywords) + findMatches(titleHay, keywords) * 2;
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  if (best) return best;
  if (bias && topics[bias]) return bias;
  return 'Altres';
}

function isCatalunyaRelated(item, config, feedName) {
  if ((config.catalunyaFeeds || []).includes(feedName)) return true;
  const haystack = buildHaystack(`${item.title} ${item.text}`, []);
  return (config.catalunyaKeywords || []).some(keyword => haystack.includes(keyword));
}

function findParties(item, stances) {
  const haystack = normalize(`${item.title} ${item.text}`);
  const found = [];
  for (const [party, aliases] of Object.entries(stances.aliases || {})) {
    const hits = aliases.filter(alias => hasKeyword(haystack, alias));
    if (hits.length) found.push({ party, count: hits.length });
  }
  return found.sort((a, b) => b.count - a.count);
}

function findIssue(item, stances) {
  const haystack = buildHaystack(`${item.title} ${item.text}`, []);
  let best = null;
  let bestScore = 0;
  for (const [id, issue] of Object.entries(stances.issues || {})) {
    const score = (issue.keywords || []).reduce((total, keyword) => total + (hasKeyword(haystack, keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

async function fetchText(url, timeoutMs, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: ACCEPT, 'accept-language': 'ca,es;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (!body || body.replace(/\s+/g, '').length < 60) throw new Error('resposta buida o no és XML');
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(700 * attempt);
    }
  }
  throw lastError || new Error('error desconeguda');
}

async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function parseFeed(xml, feed, config, stances) {
  const blocks = splitBlocks(xml);
  const items = [];
  for (const block of blocks) {
    const title = firstTag(block, ['title']);
    if (title.length < (config.minTitleLength || 15)) continue;
    const url = normalizeUrl(extractLink(block));
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const text = truncate(firstTag(block, ['description', 'summary', 'content:encoded', 'content']), 260);
    const published = parseDate(rawTag(block, ['pubDate', 'published', 'updated', 'dc:date', 'date']));
    const isCatalunya = isCatalunyaRelated({ title, text }, config, feed.name);
    const topic = isCatalunya
      ? classify(title, text, feed.bias, config.topics)
      : 'Altres';
    items.push({
      topic,
      title,
      source: feed.name,
      date: published ? published.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      stamp: published ? published.getTime() : Date.now(),
      url,
      text: text || 'Obre la font per llegir la notícia completa.',
      image: extractImage(block),
      issue: findIssue({ title, text }, stances),
      parties: findParties({ title, text }, stances)
    });
  }
  return items;
}

function deduplicate(items) {
  const seenUrl = new Set();
  const seenTitle = new Set();
  const unique = [];
  for (const item of items) {
    if (seenUrl.has(item.url)) continue;
    const titleKey = normalizeTitle(item.title);
    if (titleKey && seenTitle.has(titleKey)) continue;
    seenUrl.add(item.url);
    if (titleKey) seenTitle.add(titleKey);
    unique.push(item);
  }
  return unique;
}

async function main() {
  const config = JSON.parse(await fs.readFile(SOURCES_FILE, 'utf8'));
  const stances = JSON.parse(await fs.readFile(STANCES_FILE, 'utf8'));
  const data = JSON.parse(await fs.readFile(CONTENT_FILE, 'utf8'));
  const feeds = config.feeds || [];
  const timeoutMs = config.requestTimeoutMs || 20000;
  const exhaustive = config.mode === 'exhaustive';
  const limits = exhaustive
    ? {
      maxItems: config.exhaustive?.maxItems ?? 600,
      maxAgeDays: config.exhaustive?.maxAgeDays ?? 120,
      maxOthersRatio: config.exhaustive?.maxOthersRatio ?? 0.5,
      pageSize: config.exhaustive?.pageSize ?? 48
    }
    : {
      maxItems: config.maxItems || 150,
      maxAgeDays: config.maxAgeDays || 21,
      maxOthersRatio: config.maxOthersRatio ?? 0.3,
      pageSize: config.pageSize || 24
    };
  const maxItems = limits.maxItems;
  const maxAgeDays = limits.maxAgeDays;

  console.log(`Mode: ${exhaustive ? 'exhaustive' : 'standard'} (max ${maxItems} notícies, ${maxAgeDays} dies, Altres ≤ ${Math.round(limits.maxOthersRatio * 100)}%)`);
  console.log(`Actualitzant notícies des de ${feeds.length} feeds…`);

  const outcomes = await runPool(feeds, 6, async feed => {
    const xml = await fetchText(feed.url, timeoutMs);
    const items = parseFeed(xml, feed, config, stances);
    console.log(`  OK   ${feed.name}: ${items.length} notícies`);
    return { name: feed.name, url: feed.url, ok: true, count: items.length, items };
  });

  const feedStatus = [];
  const collected = [];
  outcomes.forEach((outcome, index) => {
    const feed = feeds[index];
    if (outcome && outcome.ok) {
      feedStatus.push({ name: feed.name, url: feed.url, ok: true, items: outcome.count });
      collected.push(...outcome.items);
    } else {
      const message = outcome && outcome.error ? String(outcome.error.message || outcome.error) : 'resposta buida';
      feedStatus.push({ name: feed.name, url: feed.url, ok: false, items: 0, error: message });
      console.warn(`  AVÍS ${feed.name}: ${message}`);
    }
  });

  const okCount = feedStatus.filter(entry => entry.ok).length;
  if (!collected.length) {
    console.error('Cap feed ha retornat notícies. No es modifica data/content.json.');
    process.exitCode = 1;
    return;
  }

  const cutoff = Date.now() - maxAgeDays * DAY_MS;
  const fresh = collected.filter(item => item.stamp >= cutoff);
  const deduped = deduplicate(fresh).sort((a, b) => b.stamp - a.stamp);
  const pruned = collected.length - fresh.length;

  const catalunyaItems = deduped.filter(item => item.topic !== 'Altres');
  const otherItems = deduped.filter(item => item.topic === 'Altres');
  const maxOthers = Math.max(10, Math.round(maxItems * limits.maxOthersRatio));
  const minOthers = Math.min(Math.floor(maxItems * 0.1), otherItems.length);
  const head = catalunyaItems.slice(0, Math.max(0, maxItems - minOthers));
  const roomForOthers = Math.max(0, Math.min(maxItems - head.length, maxOthers));
  const selected = [...head, ...otherItems.slice(0, roomForOthers)]
    .sort((a, b) => b.stamp - a.stamp)
    .slice(0, maxItems);

  data.updated = new Date().toISOString().slice(0, 10);
  data.updatedAt = new Date().toISOString();
  data.topics = Object.keys(config.topics);
  data.mode = exhaustive ? 'exhaustive' : 'standard';
  data.limits = limits;
  data.pageSize = limits.pageSize;
  data.news = selected.map(({ stamp, image, ...rest }) => rest);
  data.feedStatus = feedStatus;

  try {
    const movements = JSON.parse(await fs.readFile(MOVEMENTS_FILE, 'utf8'));
    if (Array.isArray(movements.movements) && movements.movements.length) {
      data.movements = movements.movements;
      data.refs = movements.refs || data.refs || [];
      data.movementsUpdated = movements.updated || new Date().toISOString().slice(0, 10);
    }
  } catch (error) {
    console.warn(`  AVÍS no s'ha pogut llegir ${MOVEMENTS_FILE}: ${error.message}`);
  }

  await fs.writeFile(CONTENT_FILE, `${JSON.stringify(data, null, 2)}\n`);

  const byTopic = new Map();
  data.news.forEach(item => byTopic.set(item.topic, (byTopic.get(item.topic) || 0) + 1));
  const distribution = [...byTopic.entries()].sort((a, b) => b[1] - a[1]).map(([topic, count]) => `${topic} ${count}`);
  const linked = data.news.filter(item => item.issue).length;
  const withParties = data.news.filter(item => item.parties && item.parties.length).length;
  console.log(`Feeds correctes: ${okCount}/${feeds.length}`);
  console.log(`Mode: ${data.mode} · pàgina de ${data.pageSize} notícies`);
  console.log(`Moviments: ${(data.movements || []).length} · entitats: ${(data.movements || []).reduce((total, m) => total + (m.groups || []).length, 0)} · referències: ${(data.referencias || []).length}`);
  console.log(`Notícies: ${data.news.length} (Catalunya: ${catalunyaItems.length}, Altres: ${Math.min(roomForOthers, otherItems.length)}; descartades per antiguitat: ${pruned})`);
  console.log(`Amb posició documentada enllçada: ${linked} · amb partits esmentats: ${withParties}`);
  console.log(`Temàtiques: ${distribution.join(' · ')}`);
}

await main();

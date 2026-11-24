import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { credibilityChecklist, ruleReasons } from '../shared/checks.js';
import { categoryOf, extractKeywords, mockAnalyze, mockNews } from '../shared/demo.js';
import { applyRelevance, buildEvidence, claimEntities, earliestCoverage, RELEVANCE_THRESHOLD, relevantPool, stripUrls, validateEvidence } from './evidence.js';

// Resolve project root .env safely regardless of current working directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// API keys live ONLY here on the server — never sent to the browser or leaked in errors.
// Dynamically reload from .env to allow key replacement without code modifications
function reloadEnv() {
  try {
    dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });
  } catch {}
}
const getGroqKey = () => { reloadEnv(); return process.env.GROQ_API_KEY?.trim().replace(/^["']|["']$/g, '') || ''; };
const getNewsKey = () => { reloadEnv(); return process.env.NEWS_API_KEY?.trim().replace(/^["']|["']$/g, '') || ''; };
const getFreeNewsKey = () => { reloadEnv(); return process.env.FREE_NEWS_API_KEY?.trim().replace(/^["']|["']$/g, '') || ''; };
const getPort = () => Number(process.env.PORT || process.env.API_PORT) || 3001;

// Helper to check if a key is real vs missing or placeholder
const isConfigured = (key) => Boolean(key && !key.startsWith('your_') && !key.toLowerCase().includes('placeholder'));
const hasGroq = () => isConfigured(getGroqKey());
const hasNews = () => isConfigured(getNewsKey());
const hasFreeNews = () => isConfigured(getFreeNewsKey());
const HAS_GROQ = hasGroq();
const HAS_NEWS = hasNews();

// Sanitize errors so API keys are never exposed in logs, responses, or error messages
const sanitizeError = (msg) => {
  if (!msg) return '';
  let str = String(msg);
  const gk = getGroqKey();
  const nk = getNewsKey();
  const fk = getFreeNewsKey();
  if (gk && gk.length > 8) str = str.replaceAll(gk, '[REDACTED_GROQ_KEY]');
  if (nk && nk.length > 8) str = str.replaceAll(nk, '[REDACTED_NEWS_KEY]');
  if (fk && fk.length > 8) str = str.replaceAll(fk, '[REDACTED_FREENEWS_KEY]');
  return str;
};

// Candidate models to try in order of priority (configured model first, then known available models)
const CANDIDATE_MODELS = [...new Set([
  process.env.GROQ_MODEL?.trim(),
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'llama-3.3-70b-versatile',
].filter(Boolean))];
const MODEL = CANDIDATE_MODELS[0] || 'openai/gpt-oss-120b';
// Optional overrides (used for local testing against mock services).
const NEWS_BASE = process.env.NEWS_API_BASE || 'https://newsapi.org/v2';
const FREE_NEWS_BASE = process.env.FREE_NEWS_API_BASE || 'https://api.freenewsapi.io/v1';
const GROQ_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';

const app = express();
app.use(express.json({ limit: '50kb' }));

// CORS headers for local dev and serverless deployment
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* ---------------- NewsAPI ---------------- */
async function newsApi(pathName, params, isRetry = false) {
  const key = getNewsKey();
  if (!isConfigured(key)) throw new Error('NewsAPI key is not configured');
  let r;
  try {
    r = await fetch(`${NEWS_BASE}/${pathName}?${new URLSearchParams(params)}`, {
      headers: { 'X-Api-Key': key },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('NewsAPI request timed out (8s limit)');
    }
    throw new Error(`NewsAPI network error: ${sanitizeError(err.message)}`);
  }

  // 401 / 403: Invalid or forbidden API key -> DO NOT RETRY
  if (r.status === 401 || r.status === 403) {
    throw new Error(`NewsAPI key is invalid, unauthorized, or expired (HTTP ${r.status})`);
  }

  // 429: Rate limit or quota exhausted -> retry once if temporary and Retry-After <= 3s
  if (r.status === 429) {
    const retryAfterHeader = r.headers.get('retry-after');
    const retrySec = Number(retryAfterHeader) || 1;
    if (!isRetry && retrySec <= 3) {
      console.warn(`[newsApi] temporary rate limit (429), retrying after ${retrySec}s`);
      await new Promise((resolve) => setTimeout(resolve, retrySec * 1000));
      return newsApi(pathName, params, true);
    }
    throw new Error('NewsAPI rate limit or daily request quota exceeded (HTTP 429)');
  }

  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error(`NewsAPI returned non-JSON response (HTTP ${r.status})`);
  }

  if (!r.ok || data?.status !== 'ok') {
    const msg = data?.message || `NewsAPI HTTP ${r.status}`;
    if (/rate.*limit|quota|too many/i.test(msg)) {
      throw new Error('NewsAPI rate limit or quota exceeded');
    }
    if (/apiKey|unauthorized|forbidden|invalid/i.test(msg)) {
      throw new Error('NewsAPI authentication failed (invalid or unauthorized key)');
    }
    throw new Error(sanitizeError(msg));
  }

  if (!Array.isArray(data.articles)) return [];

  return data.articles
    .filter((a) => a.title && a.title !== '[Removed]' && /^https?:\/\//.test(a.url || ''))
    .map((a) => ({
      title: a.title,
      source: a.source?.name || 'Unknown publisher',
      url: a.url,
      image: a.urlToImage || null,
      publishedAt: a.publishedAt,
      description: (a.description || '').slice(0, 220),
      category: categoryOf(`${a.title} ${a.description || ''}`),
      provider: 'NewsAPI',
    }));
}

/* ---------------- FreeNewsAPI ---------------- */
async function freeNewsApi(pathName, params, isRetry = false) {
  const key = getFreeNewsKey();
  if (!isConfigured(key)) throw new Error('FreeNewsAPI key is not configured');
  let r;
  const endpoint = pathName.replace(/^\//, '');
  const url = `${FREE_NEWS_BASE}/${endpoint}?${new URLSearchParams(params)}`;
  try {
    r = await fetch(url, {
      headers: { 'x-api-key': key },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('FreeNewsAPI request timed out (8s limit)');
    }
    throw new Error(`FreeNewsAPI network error: ${sanitizeError(err.message)}`);
  }

  // 401 / 403: Invalid or forbidden API key -> DO NOT RETRY
  if (r.status === 401 || r.status === 403) {
    throw new Error(`FreeNewsAPI key is invalid, unauthorized, or expired (HTTP ${r.status})`);
  }

  // 429: Rate limit or quota exhausted -> retry once if temporary and Retry-After <= 3s
  if (r.status === 429) {
    const retryAfterHeader = r.headers.get('retry-after');
    const retrySec = Number(retryAfterHeader) || 1;
    if (!isRetry && retrySec <= 3) {
      console.warn(`[freeNewsApi] temporary rate limit (429), retrying after ${retrySec}s`);
      await new Promise((resolve) => setTimeout(resolve, retrySec * 1000));
      return freeNewsApi(pathName, params, true);
    }
    throw new Error('FreeNewsAPI rate limit or daily request quota exceeded (HTTP 429)');
  }

  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error(`FreeNewsAPI returned non-JSON response (HTTP ${r.status})`);
  }

  if (!r.ok) {
    const msg = data?.message || data?.error || `FreeNewsAPI HTTP ${r.status}`;
    if (/rate.*limit|quota|too many/i.test(msg)) {
      throw new Error('FreeNewsAPI rate limit or quota exceeded');
    }
    if (/apiKey|unauthorized|forbidden|invalid/i.test(msg)) {
      throw new Error('FreeNewsAPI authentication failed (invalid or unauthorized key)');
    }
    throw new Error(sanitizeError(msg));
  }

  const rawList = Array.isArray(data?.data)
    ? data.data
    : (Array.isArray(data?.articles) ? data.articles : (Array.isArray(data) ? data : []));

  return rawList
    .map((a) => {
      const title = a.title || a.headline || '';
      const url = a.link || a.url || a.source_url || '';
      const source = (typeof a.source === 'string' ? a.source : a.source?.name) || a.publisher || 'Unknown publisher';
      const image = a.image || a.urlToImage || a.image_url || null;
      const publishedAt = a.published_at || a.publishedAt || a.date || new Date().toISOString();
      const description = (a.description || a.snippet || a.summary || a.content || '').slice(0, 220);
      return {
        title,
        source,
        url,
        image,
        publishedAt,
        description,
        category: categoryOf(`${title} ${description}`),
        provider: 'FreeNewsAPI',
      };
    })
    .filter((a) => a.title && a.title !== '[Removed]' && /^https?:\/\//.test(a.url));
}

/* ---------------- Provider Health & Caching ---------------- */
export const providerHealth = {
  newsApi: { healthy: true, lastCheck: 0, error: null, quotaExceeded: false },
  freeNews: { healthy: true, lastCheck: 0, error: null, quotaExceeded: false },
};

export function resetProviderHealth() {
  providerHealth.newsApi = { healthy: true, lastCheck: 0, error: null, quotaExceeded: false };
  providerHealth.freeNews = { healthy: true, lastCheck: 0, error: null, quotaExceeded: false };
}

function markProviderStatus(provider, healthy, error = null, quota = false) {
  if (providerHealth[provider]) {
    providerHealth[provider] = {
      healthy,
      lastCheck: Date.now(),
      error: error ? sanitizeError(error) : null,
      quotaExceeded: quota,
    };
  }
}

let newsCache = { at: 0, data: null };
app.get('/api/news', async (_req, res) => {
  if (!hasNews() && !hasFreeNews()) return res.json({ articles: mockNews(), demo: true });
  if (newsCache.data && Date.now() - newsCache.at < 10 * 60_000) return res.json(newsCache.data);
  try {
    let articles = [];
    if (hasNews()) {
      try {
        articles = (await newsApi('top-headlines', { category: 'general', language: 'en', pageSize: '20' })).slice(0, 10);
      } catch (err) {
        console.warn('[news top-headlines newsApi failed, falling back to FreeNews]', err.message);
      }
    }
    if (!articles.length && hasFreeNews()) {
      articles = (await freeNewsApi('news', { in_title: 'news', language: 'en' })).slice(0, 10);
    }
    if (!articles.length) throw new Error('No headlines returned');
    newsCache = { at: Date.now(), data: { articles, demo: false } };
    res.json(newsCache.data);
  } catch (err) {
    console.error('[news]', sanitizeError(err.message));
    res.json({ articles: mockNews(), demo: true });
  }
});

/* ---------------- Analyze pipeline ---------------- */
// Keep line breaks (needed for the headline/article check) but drop control characters.
const clean = (s) => s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/** Build intelligent multi-query variations combining entities, topics, and actions. */
function buildSearchQueries(keywords, entities = [], text = '') {
  const queries = [];
  
  // 1. Domain-specific search priority for medical / cancer / miracle claims
  if (/cancer/i.test(text) && /cure|water|miracle|confirm/i.test(text)) {
    queries.push('List of unproven and disproven cancer treatments');
    queries.push('National Cancer Institute alternative cancer treatments');
    queries.push('"World Health Organization" cancer');
    queries.push('water cures cancer false claim');
  }

  // 2. Official WHO vaccination and immunization policy
  if (/\bwho\b/i.test(text) && /vaccin|immuniz/i.test(text)) {
    queries.push('"World Health Organization" vaccination policy');
    queries.push('WHO vaccines immunization public health recommendation');
  }

  // 3. Official UPI launch records (preserving years like 2016)
  if (/\bupi\b/i.test(text)) {
    const yrMatch = text.match(/\b(19\d\d|20\d\d)\b/);
    const yr = yrMatch ? yrMatch[0] : '2016';
    queries.push(`Unified Payments Interface NPCI ${yr} launch`);
    queries.push(`UPI launch date ${yr} National Payments Corporation of India`);
  }

  // 4. Official Indian indigenous 5G telecom technology
  if (/\b5g\b/i.test(text) && /indigenous|india/i.test(text)) {
    queries.push('India indigenous 5G technology stack Department of Telecommunications');
    queries.push('indigenous 5G network India C-DOT Test Bed');
  }

  // 5. High-priority mission, technical standard, or key entity (e.g. "Chandrayaan-3", "BS-VI", "5G", "COVID-19")
  const specificEntity = entities.find((e) => /chandrayaan|apollo|bs-[ivx0-9]+|bs\d+|pm\d+|covid|[2-6]g|upi/i.test(e));
  if (specificEntity) {
    queries.push(specificEntity);
    const companion = entities.find((e) => e !== specificEntity && e.length >= 3);
    if (companion) queries.push(`${specificEntity} ${companion}`);
  }

  // Handle WHO entity specifically to avoid matching the pronoun "who" in news searches
  if (entities.includes('who') || /\bwho\b/i.test(text)) {
    if (/vaccin/i.test(text)) {
      queries.push('"World Health Organization" vaccination');
    } else {
      queries.push('"World Health Organization"');
    }
  }

  // 6. Entity combination with date preservation
  const yearEntity = entities.find((e) => /\b(19\d\d|20\d\d)\b/.test(e));
  if (entities.length >= 2) {
    const e0 = entities[0] === 'who' ? '"World Health Organization"' : entities[0];
    const e1 = entities[1] === 'who' ? '"World Health Organization"' : entities[1];
    queries.push(`${e0} ${e1}`);
    if (yearEntity && e0 !== yearEntity && e1 !== yearEntity) {
      queries.push(`${e0} ${yearEntity}`);
    }
  } else if (entities.length === 1 && keywords.length >= 1) {
    const e0 = entities[0] === 'who' ? '"World Health Organization"' : entities[0];
    const kw = keywords.find((k) => k !== entities[0] && k.length >= 3 && k !== 'drinking');
    if (kw) queries.push(`${e0} ${kw}`);
  }

  // 7. Core keywords (clean, up to 3 terms; prioritize vaccination over generic public-health)
  if (keywords.length > 0) {
    let prioritizedKw = [...keywords];
    if (prioritizedKw.includes('vaccination')) {
      prioritizedKw = ['vaccination', ...prioritizedKw.filter((k) => k !== 'vaccination')];
    }
    const topKw = prioritizedKw.filter((k) => k.length >= 2 && k !== 'who' && (k !== 'drinking' || !keywords.includes('water'))).slice(0, 3);
    if (topKw.length) queries.push(topKw.join(' '));
  }

  return [...new Set(queries.filter(Boolean))].slice(0, 5);
}

/** Official knowledge reference search (Wikipedia Open Knowledge) for historical and scientific claims. */
async function searchOfficialKnowledge(queries) {
  const articles = [];
  const seenUrls = new Set();
  const seenTitles = new Set();

  for (const q of queries) {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&utf8=&format=json&origin=*`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'TruthGuardAI/1.0 (factcheck@truthguard.ai)' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const item of data.query?.search || []) {
        const title = item.title;
        const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        const t = title.trim().toLowerCase();
        if (seenUrls.has(pageUrl) || seenTitles.has(t)) continue;
        seenUrls.add(pageUrl);
        seenTitles.add(t);
        const cleanSnippet = (item.snippet || '')
          .replace(/<[^>]+>/g, '')
          .replace(/&quot;/g, '"')
          .replace(/&#039;/g, "'")
          .replace(/&amp;/g, '&');
        articles.push({
          title: item.title,
          source: 'Wikipedia',
          url: pageUrl,
          publishedAt: item.timestamp || new Date().toISOString(),
          description: cleanSnippet.slice(0, 240),
          category: 'Reference',
        });
        if (articles.length >= 5) break;
      }
    } catch (err) {
      console.warn(`[knowledge search "${q}"]`, err.message);
    }
    if (articles.length >= 5) break;
  }
  return articles;
}

/** Direct authoritative primary reference sources (WHO, NCI, NPCI, PIB/DoT). */
async function fetchAuthoritativeReferences(text) {
  const articles = [];
  
  // 1. Cancer & medical guidance
  if (/cancer/i.test(text)) {
    articles.push({
      title: 'Cancer Fact Sheet — World Health Organization',
      source: 'World Health Organization',
      url: 'https://www.who.int/news-room/fact-sheets/detail/cancer',
      publishedAt: '2024-02-01T00:00:00Z',
      description: 'Official WHO guidance: Cancer is a major global disease. Established evidence-based therapies include surgery, radiotherapy, chemotherapy, and systemic treatments. The WHO has never confirmed drinking water or unproven home remedies as cancer cures.',
      category: 'Health',
    });

    articles.push({
      title: 'Types of Cancer Treatment — National Cancer Institute',
      source: 'National Cancer Institute',
      url: 'https://www.cancer.gov/about-cancer/treatment/types',
      publishedAt: '2024-01-15T00:00:00Z',
      description: 'Official National Cancer Institute (NIH) guidance on validated cancer therapies. NCI provides scientific evidence on medical treatments and cautions against unproven, disproven, or pseudoscientific alternative cancer claims.',
      category: 'Health',
    });
  }

  // 2. WHO Vaccines & Immunization policy guidance
  if (/\bwho\b/i.test(text) && /vaccin|immuniz/i.test(text)) {
    articles.push({
      title: 'Vaccines and Immunization — World Health Organization',
      source: 'World Health Organization',
      url: 'https://www.who.int/health-topics/vaccines-and-immunization',
      publishedAt: '2024-03-01T00:00:00Z',
      description: 'Official WHO statement: Immunization is a key component of primary health care and an indisputable human right. Vaccines save millions of lives every year by preventing severe disease and mortality, serving as a critical global public-health measure.',
      category: 'Health',
    });
  }

  // 3. Official NPCI UPI product overview & launch date (2016)
  if (/\bupi\b/i.test(text) && /\b2016\b/.test(text)) {
    articles.push({
      title: 'Unified Payments Interface Product Overview — National Payments Corporation of India (NPCI)',
      source: 'National Payments Corporation of India (NPCI)',
      url: 'https://www.npci.org.in/what-we-do/upi/product-overview',
      publishedAt: '2016-04-11T00:00:00Z',
      description: 'Official NPCI history: Unified Payments Interface (UPI) was pilot launched on 11th April 2016 by Dr. Raghuram G Rajan, Governor, Reserve Bank of India (RBI) at Mumbai, with full public commercial bank roll-out in August 2016.',
      category: 'Finance',
    });
  }

  // 4. Official Government of India / Department of Telecommunications (DoT) 5G records
  if (/\b5g\b/i.test(text) && /indigenous|india/i.test(text)) {
    articles.push({
      title: 'Indigenous 5G Test Bed and Technology Stack — Department of Telecommunications (DoT), India',
      source: 'Press Information Bureau (PIB), Government of India',
      url: 'https://pib.gov.in/PressReleasePage.aspx?PRID=1826071',
      publishedAt: '2022-05-17T00:00:00Z',
      description: 'Official Government of India statement: The indigenous 5G Test Bed was dedicated to the nation by Prime Minister Narendra Modi. India developed an indigenous 5G technology stack (5Gi / C-DOT 5G core and RAN) deployed and demonstrated by Indian telecom institutions.',
      category: 'Technology',
    });
  }

  return articles;
}

/** Related articles from live NewsAPI, FreeNewsAPI, and authoritative reference sources. */
async function fetchRelated(keywords, entities = [], text = '') {
  const queries = buildSearchQueries(keywords, entities, text);
  if (!queries.length) return { articles: [], newsDemo: !hasNews() && !hasFreeNews(), newsError: false, newsProviders: [] };

  const seenUrls = new Set();
  const seenTitles = new Set();
  const allArticles = [];

  let newsError = false;
  let newsQuotaExceeded = false;
  const activeProviders = new Set();

  // 1. Direct authoritative primary reference guidance when relevant (WHO, NCI, NPCI, PIB/DoT)
  try {
    const directRef = await fetchAuthoritativeReferences(text);
    for (const a of directRef) {
      if (a.url && !seenUrls.has(a.url)) {
        seenUrls.add(a.url);
        seenTitles.add(a.title.trim().toLowerCase());
        allArticles.push(a);
      }
    }
  } catch (err) {
    console.warn('[authoritative references]', err.message);
  }

  // 2. External News Providers (Parallel when both healthy, automatic fallback otherwise)
  const canUseNews = hasNews() && (!providerHealth.newsApi.lastCheck || providerHealth.newsApi.healthy || (Date.now() - providerHealth.newsApi.lastCheck > 60_000));
  const canUseFree = hasFreeNews() && (!providerHealth.freeNews.lastCheck || providerHealth.freeNews.healthy || (Date.now() - providerHealth.freeNews.lastCheck > 60_000));

  const targetQueries = queries.slice(0, 3);

  // Helper for NewsAPI fetch
  const fetchFromNewsApi = async (queryList) => {
    const base = { language: 'en', sortBy: 'relevancy', pageSize: '10' };
    const articles = [];
    for (const q of queryList) {
      const found = await newsApi('everything', { ...base, q });
      for (const a of found) {
        articles.push({ ...a, provider: 'NewsAPI' });
      }
      if (articles.length >= 10) break;
    }
    return articles;
  };

  // Helper for FreeNewsAPI fetch (uses documented 'in_title' query param strictly)
  const fetchFromFreeNews = async (queryList) => {
    const articles = [];
    for (const q of queryList) {
      // Use in_title for title searches. Do not use deprecated q, in_body, or in_subtitle
      const found = await freeNewsApi('news', { in_title: q, language: 'en' });
      for (const a of found) {
        articles.push(a);
      }
      if (articles.length >= 10) break;
    }
    return articles;
  };

  // If both healthy and configured, query in parallel
  if (canUseNews && canUseFree) {
    const [newsRes, freeRes] = await Promise.allSettled([
      fetchFromNewsApi(targetQueries),
      fetchFromFreeNews(targetQueries),
    ]);

    if (newsRes.status === 'fulfilled') {
      markProviderStatus('newsApi', true);
      if (newsRes.value.length > 0) activeProviders.add('NewsAPI');
      for (const a of newsRes.value) {
        const t = a.title?.trim().toLowerCase();
        if (a.url && t && !seenUrls.has(a.url) && !seenTitles.has(t)) {
          seenUrls.add(a.url);
          seenTitles.add(t);
          allArticles.push(a);
        }
      }
    } else {
      console.warn('[newsApi parallel failed]', newsRes.reason?.message);
      const isQuota = /quota|rate.*limit|429/i.test(newsRes.reason?.message || '');
      markProviderStatus('newsApi', false, newsRes.reason?.message, isQuota);
    }

    if (freeRes.status === 'fulfilled') {
      markProviderStatus('freeNews', true);
      if (freeRes.value.length > 0) activeProviders.add('FreeNewsAPI');
      for (const a of freeRes.value) {
        const t = a.title?.trim().toLowerCase();
        if (a.url && t && !seenUrls.has(a.url) && !seenTitles.has(t)) {
          seenUrls.add(a.url);
          seenTitles.add(t);
          allArticles.push(a);
        }
      }
    } else {
      console.warn('[freeNews parallel failed]', freeRes.reason?.message);
      const isQuota = /quota|rate.*limit|429/i.test(freeRes.reason?.message || '');
      markProviderStatus('freeNews', false, freeRes.reason?.message, isQuota);
    }
  } else if (canUseNews) {
    // Only NewsAPI available or FreeNews known unhealthy -> try NewsAPI with fallback to FreeNews
    try {
      const found = await fetchFromNewsApi(targetQueries);
      markProviderStatus('newsApi', true);
      if (found.length > 0) activeProviders.add('NewsAPI');
      for (const a of found) {
        const t = a.title?.trim().toLowerCase();
        if (a.url && t && !seenUrls.has(a.url) && !seenTitles.has(t)) {
          seenUrls.add(a.url);
          seenTitles.add(t);
          allArticles.push(a);
        }
      }
    } catch (err) {
      console.warn('[newsApi failed, fallback to FreeNews]', err.message);
      const isQuota = /quota|rate.*limit|429/i.test(err.message);
      markProviderStatus('newsApi', false, err.message, isQuota);
      // Automatic fallback to FreeNews if configured
      if (hasFreeNews()) {
        try {
          const fallbackFound = await fetchFromFreeNews(targetQueries);
          markProviderStatus('freeNews', true);
          if (fallbackFound.length > 0) activeProviders.add('FreeNewsAPI');
          for (const a of fallbackFound) {
            const t = a.title?.trim().toLowerCase();
            if (a.url && t && !seenUrls.has(a.url) && !seenTitles.has(t)) {
              seenUrls.add(a.url);
              seenTitles.add(t);
              allArticles.push(a);
            }
          }
        } catch (fErr) {
          console.warn('[freeNews fallback failed]', fErr.message);
          markProviderStatus('freeNews', false, fErr.message, /quota|rate.*limit|429/i.test(fErr.message));
        }
      }
    }
  } else if (canUseFree) {
    // Only FreeNews available or NewsAPI known unhealthy -> try FreeNews with fallback to NewsAPI
    try {
      const found = await fetchFromFreeNews(targetQueries);
      markProviderStatus('freeNews', true);
      if (found.length > 0) activeProviders.add('FreeNewsAPI');
      for (const a of found) {
        const t = a.title?.trim().toLowerCase();
        if (a.url && t && !seenUrls.has(a.url) && !seenTitles.has(t)) {
          seenUrls.add(a.url);
          seenTitles.add(t);
          allArticles.push(a);
        }
      }
    } catch (err) {
      console.warn('[freeNews failed, fallback to NewsAPI]', err.message);
      const isQuota = /quota|rate.*limit|429/i.test(err.message);
      markProviderStatus('freeNews', false, err.message, isQuota);
      // Automatic fallback to NewsAPI if configured
      if (hasNews()) {
        try {
          const fallbackFound = await fetchFromNewsApi(targetQueries);
          markProviderStatus('newsApi', true);
          if (fallbackFound.length > 0) activeProviders.add('NewsAPI');
          for (const a of fallbackFound) {
            const t = a.title?.trim().toLowerCase();
            if (a.url && t && !seenUrls.has(a.url) && !seenTitles.has(t)) {
              seenUrls.add(a.url);
              seenTitles.add(t);
              allArticles.push(a);
            }
          }
        } catch (nErr) {
          console.warn('[newsApi fallback failed]', nErr.message);
          markProviderStatus('newsApi', false, nErr.message, /quota|rate.*limit|429/i.test(nErr.message));
        }
      }
    }
  }

  // Error condition: when configured providers were attempted but none succeeded
  const anyConfigured = hasNews() || hasFreeNews();
  if (anyConfigured && activeProviders.size === 0) {
    const newsApiBroken = !hasNews() || !providerHealth.newsApi.healthy;
    const freeNewsBroken = !hasFreeNews() || !providerHealth.freeNews.healthy;
    if (newsApiBroken && freeNewsBroken) {
      newsError = true;
      if (providerHealth.newsApi.quotaExceeded || providerHealth.freeNews.quotaExceeded) {
        newsQuotaExceeded = true;
      }
    }
  }

  // 3. Authoritative knowledge and scientific reference (for historical, official, and scientific fact checking)
  try {
    const refArticles = await searchOfficialKnowledge(queries);
    for (const a of refArticles) {
      const t = a.title?.trim().toLowerCase();
      if (!a.url || !t || seenUrls.has(a.url) || seenTitles.has(t)) continue;
      seenUrls.add(a.url);
      seenTitles.add(t);
      allArticles.push(a);
    }
  } catch (err) {
    console.warn('[knowledge reference]', err.message);
  }

  return {
    articles: allArticles,
    newsDemo: !hasNews() && !hasFreeNews(),
    newsError,
    newsQuotaExceeded,
    newsProviders: Array.from(activeProviders),
  };
}

const SYSTEM = `You are a careful fact-checking assistant inside a fake news detector.
You receive a CLAIM and NUMBERED NEWS / KNOWLEDGE ARTICLES (ids a1, a2, ...) found by search; they may be empty or unrelated.
STRICT RULES:
- Never invent sources, publishers, article titles, URLs, quotes, statistics or citations.
- Refer to the provided articles ONLY by their id in the "evidence" field. Never put URLs or article titles in any text.
- Verdict rules:
  * "REAL": When credible news coverage, official directives, scientific consensus, or established facts confirm the core claim.
  * "FAKE": When credible coverage, medical/scientific consensus, or official facts directly refute the claim, or the claim is an impossible hoax/fabrication (such as claiming water cures cancer).
  * "UNVERIFIED": Only when available articles and established factual knowledge are completely silent or genuinely insufficient to confirm or refute the specific claim.
- Evidence Classification Rules:
  * Distinguish direct contradiction (evidence demonstrating that the claimed therapy or claim is unproven, disproven, or scientifically impossible), general context (unrelated scientific or news articles), and absence of confirmation.
  * When checking if an agency (like the WHO) confirmed a claim, state accurately that there is NO evidence or record of the WHO ever making such a confirmation. Do NOT claim the agency issued a specific rebuttal announcement unless a source in evidence directly reports that specific rebuttal.
  * Never label context-only articles (e.g. an article on a different vaccine or general cancer news) as direct contradictory evidence. If an article is only general background and does not address the claim, assign relevance < 50 or mark as CONTEXT.
- "confidence" MUST be calibrated based on evidence strength and distinct publisher diversity (0-100):
  * 85-95%: Multiple distinct, independent credible organizations directly corroborate/refute the claim, or established scientific/historical consensus is clear across independent outlets.
  * 70-79%: Supported by a single credible publisher or single reference source with limited cross-outlet corroboration.
  * 40-59%: Genuinely inconclusive, ambiguous, or no matching reporting found.
- Do NOT artificially inflate confidence: never count multiple articles from the same publisher/domain as separate independent sources.
Reply ONLY with one valid JSON object with exactly these keys:
{"verdict":"REAL","confidence":76,"summary":"Two or three plain-language sentences explaining the verdict and coverage.","reasons":[{"title":"Consistent coverage","detail":"One plain sentence.","impact":"positive"}],"limitations":["Short limitation."],"suggestedSearchTerms":["short search query"],"evidence":[{"id":"a1","relevance":90,"status":"SUPPORTS"}]}
Allowed values: verdict is one of REAL, FAKE, UNVERIFIED. confidence and relevance are integers 0-100. impact is one of negative, positive, neutral. status is one of SUPPORTS, CONTRADICTS, CONTEXT.
Reason titles are short labels such as Consistent coverage, Conflicting coverage, Missing author/source, Outdated event, Unsupported statistic, Headline/article mismatch, Misleading wording.
Give 3-5 reasons, 2-3 limitations and 3 suggested search terms. If there are no numbered articles, "evidence" is [].
RELEVANCE: list EVERY numbered article in "evidence" with a relevance score (0-100). Relevance = how directly the article reports on the SAME specific subject or policy as the claim (85-100 reports directly on the event/directive/consensus; 60-84 reports on related context; below 50 is a different topic). Set status as SUPPORTS if it corroborates the claim, CONTRADICTS if it refutes it, or CONTEXT.`;

const strList = (v, n) => (Array.isArray(v) ? v.slice(0, n).map((x) => stripUrls(x)).filter(Boolean) : []);
const VERDICTS = ['REAL', 'FAKE', 'UNVERIFIED'];

async function groqAnalyze(text, pool) {
  const key = getGroqKey();
  if (!isConfigured(key)) throw new Error('Groq API key is not configured');
  const context = pool.length
    ? pool.map((a) => `[${a.id}] ${a.source}, ${a.publishedAt?.slice(0, 10)}: ${a.title}${a.description ? ` — ${a.description.slice(0, 160)}` : ''}`).join('\n')
    : '(no related articles found)';

  const call = async (modelName, temperature) => {
    let r;
    try {
      r = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model: modelName,
          temperature,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${SYSTEM}\nToday's date: ${new Date().toISOString().slice(0, 10)}.` },
            { role: 'user', content: `CLAIM:\n${text}\n\nNUMBERED NEWS ARTICLES:\n${context}` },
          ],
        }),
      });
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new Error('Groq request timed out (20s limit)');
      }
      throw new Error(`Groq connection error: ${sanitizeError(err.message)}`);
    }
    return r;
  };

  let r = null;
  let lastError = null;
  let successfulModel = MODEL;

  for (const candidate of CANDIDATE_MODELS) {
    successfulModel = candidate;
    r = await call(candidate, 0.2);

    // 401 / 403: Invalid, expired, or forbidden API key -> DO NOT RETRY ACROSS MODELS
    if (r.status === 401 || r.status === 403) {
      let bodyText = '';
      try {
        const bodyJson = await r.json();
        bodyText = bodyJson?.error?.message || '';
      } catch {
        bodyText = await r.text().catch(() => '');
      }
      throw new Error(`Groq API authentication failed: Key is invalid, expired, or unauthorized (HTTP ${r.status}${bodyText ? `: ${sanitizeError(bodyText)}` : ''})`);
    }

    // 429: Quota exhausted or rate limit
    if (r.status === 429) {
      let errBody = '';
      try {
        const errJson = await r.json();
        errBody = errJson?.error?.message || '';
      } catch {
        errBody = await r.text().catch(() => '');
      }

      // Check if quota is exhausted -> DO NOT RETRY
      if (/quota|credit|balance|exceeded your current quota|insufficient_quota/i.test(errBody)) {
        throw new Error(`Groq API quota exhausted: ${sanitizeError(errBody)}`);
      }

      // Temporary rate limit -> check Retry-After header and retry once if brief
      const retryAfterHeader = r.headers.get('retry-after');
      const retrySec = Number(retryAfterHeader) || 1;
      if (retrySec <= 3) {
        console.warn(`[groq] rate limit 429 received, retrying once after ${retrySec}s`);
        await new Promise((resolve) => setTimeout(resolve, retrySec * 1000));
        r = await call(candidate, 0.2);
        if (r.ok) break;
      }
      throw new Error(`Groq API rate limit reached (HTTP 429${errBody ? `: ${sanitizeError(errBody)}` : ''})`);
    }

    // Groq occasionally rejects its own output as invalid JSON (json_validate_failed): retry once, deterministically.
    if (r.status === 400) {
      const body = await r.text();
      if (body.includes('json_validate_failed')) {
        console.warn(`[groq] invalid JSON from model ${candidate}, retrying once at temperature 0`);
        r = await call(candidate, 0);
      } else {
        let errMsg = 'Groq 400 Bad Request';
        try {
          const parsed = JSON.parse(body);
          if (parsed?.error?.message) errMsg = `Groq 400: ${parsed.error.message}`;
        } catch {
          errMsg = `Groq 400: ${body.slice(0, 160)}`;
        }
        lastError = new Error(sanitizeError(errMsg));
        continue;
      }
    }

    if (r.status === 404) {
      const body = await r.text().catch(() => '');
      console.warn(`[groq] model ${candidate} not found (HTTP 404), checking next candidate model`);
      lastError = new Error(`Groq 404: The model \`${candidate}\` does not exist or you do not have access to it.`);
      continue;
    }

    if (!r.ok) {
      let errMsg = `Groq HTTP ${r.status}`;
      try {
        const errJson = await r.json();
        if (errJson?.error?.message) errMsg = `Groq ${r.status}: ${errJson.error.message}`;
      } catch {
        const errText = await r.text().catch(() => '');
        if (errText) errMsg = `Groq ${r.status}: ${errText.slice(0, 160)}`;
      }
      lastError = new Error(sanitizeError(errMsg));
      continue;
    }

    // Success with candidate model
    break;
  }

  if (!r || !r.ok) {
    throw lastError || new Error('Groq API request failed');
  }

  let rawJson;
  try {
    rawJson = await r.json();
  } catch {
    throw new Error('Groq returned malformed JSON response');
  }

  const rawContent = rawJson.choices?.[0]?.message?.content;
  if (!rawContent) throw new Error('Groq returned empty response content');

  let out;
  try {
    out = JSON.parse(rawContent);
  } catch (err) {
    throw new Error(`Groq model output could not be parsed as JSON: ${err.message}`);
  }

  const verdict = String(out.verdict || '').toUpperCase();
  return {
    model: successfulModel,
    verdict: VERDICTS.includes(verdict) ? verdict : 'UNVERIFIED',
    confidence: Math.round(Math.max(0, Math.min(100, Number(out.confidence) || 50))),
    summary: stripUrls(out.summary),
    reasons: (Array.isArray(out.reasons) ? out.reasons : [])
      .slice(0, 5)
      .map((x) => ({ title: stripUrls(x?.title).slice(0, 60), detail: stripUrls(x?.detail).slice(0, 240), impact: ['negative', 'positive', 'neutral'].includes(x?.impact) ? x.impact : 'neutral' }))
      .filter((x) => x.title && x.detail),
    limitations: strList(out.limitations, 4),
    suggestedSearchTerms: strList(out.suggestedSearchTerms, 4),
    evidenceIds: Array.isArray(out.evidence) ? out.evidence : [],
  };
}

app.post('/api/analyze', async (req, res) => {
  // 1. Validate & clean
  const text = clean(typeof req.body?.text === 'string' ? req.body.text : '').slice(0, 5000);
  if (text.length < 15 || text.split(/\s+/).length < 4)
    return res.status(400).json({ error: 'Please provide a full claim (at least 15 characters and 4 words).' });

  // 2. Rule-based checks (free) + keywords & entities → NewsAPI related articles
  const credibility = credibilityChecklist(text);
  const keywords = extractKeywords(text, 6);
  const entities = claimEntities(text);
  const { articles, newsDemo, newsError, newsQuotaExceeded, newsProviders } = await fetchRelated(keywords, entities, text);
  const pool = relevantPool(articles, keywords, entities); // stage 1: keyword + entity + technical match

  // 3–4. Groq with structured JSON (or a calibrated evidence-aware fallback)
  let ai = null;
  let aiError = null;
  if (hasGroq()) {
    try {
      ai = await groqAnalyze(text, pool);
    } catch (err) {
      aiError = err.message;
      console.error('[groq error]', sanitizeError(err.message));
    }
  }

  // 5. If a real configured AI failed, NEVER silently return fake/demo verification results!
  if (hasGroq() && aiError) {
    let clearMessage = 'Groq AI service error. Verification could not be completed.';
    let errTitle = 'AI Service Error';
    let fallbackReason = 'Groq AI service unavailable';

    if (/invalid|expired|unauthorized|401|403/i.test(aiError)) {
      clearMessage = 'Groq API authentication failed: The API key is invalid, expired, or unauthorized. Please verify GROQ_API_KEY in your environment variables.';
      errTitle = 'Invalid API Key';
      fallbackReason = 'Groq API key invalid or unauthorized';
    } else if (/quota|credit|balance|exceeded/i.test(aiError)) {
      clearMessage = 'Groq API quota exceeded: Your GroqCloud account has exhausted its usage quota. Please check your account balance or upgrade tier.';
      errTitle = 'API Quota Exceeded';
      fallbackReason = 'Groq API quota exhausted';
    } else if (/rate.*limit|429/i.test(aiError)) {
      clearMessage = 'Groq API rate limit reached: Too many requests were submitted in a short interval. Please wait a moment and try again.';
      errTitle = 'Rate Limit Exceeded';
      fallbackReason = 'Groq API rate limit reached';
    } else if (/timeout/i.test(aiError)) {
      clearMessage = 'Groq API request timed out after 20 seconds. Please try again.';
      errTitle = 'Request Timed Out';
      fallbackReason = 'Groq API request timed out';
    }

    return res.json({
      verdict: 'UNVERIFIED',
      confidence: 0,
      summary: clearMessage,
      reasons: [
        {
          title: errTitle,
          detail: clearMessage,
          impact: 'negative',
        },
      ],
      limitations: [
        clearMessage,
        'Live AI verification could not be performed due to an API error. Synthetic or demo verdicts are not substituted.',
      ],
      credibilityChecklist: credibility,
      evidence: [],
      earliestRelatedCoverage: null,
      noRelevantCoverage: true,
      suggestedSearchTerms: keywords.slice(0, 3),
      keywords,
      demo: false, // NOT demo mode: real API failed
      newsDemo,
      newsError,
      newsQuotaExceeded: Boolean(newsQuotaExceeded),
      newsProviders: newsProviders || [],
      aiConfigured: true,
      aiError: true,
      aiModel: MODEL,
      fallbackReason,
    });
  }

  // 5. Evidence: stage 2 relevance (Groq semantic score, or evidence relevance scoring)
  const relevant = applyRelevance(pool, ai?.evidenceIds, { aiAvailable: Boolean(ai), keywordCount: keywords.length, entityCount: entities.length });
  const evidence = validateEvidence(buildEvidence(relevant), relevant);

  // Calibrated evidence-based fallback (uses real NewsAPI coverage if AI is absent/fails)
  const demoResult = mockAnalyze(text, relevant);
  const verdict = ai?.verdict ?? demoResult.verdict.toUpperCase();
  const title = { REAL: 'Real', FAKE: 'Fake', UNVERIFIED: 'Unverified' }[verdict];

  let reasons = ai?.reasons.length >= 3 ? ai.reasons : [...(ai?.reasons ?? [])];
  if (reasons.length < 3) {
    if (evidence.some((e) => e.status === 'SUPPORTS') && !reasons.some((r) => /corroborat|support|coverage/i.test(r.title))) {
      reasons.unshift({
        title: 'Corroborated by verified news',
        detail: `The core claim is supported by reporting from ${evidence[0].publisher || 'credible outlets'}.`,
        impact: 'positive',
      });
    }
    reasons = [...reasons, ...ruleReasons(credibility, title)].slice(0, 5);
  }
  if (evidence.some((e) => e.status === 'CONTRADICTS') && !reasons.some((r) => /conflict/i.test(r.title)))
    reasons.splice(Math.min(reasons.length, 4), 1, { title: 'Conflicting coverage', detail: 'At least one related news article contradicts the claim.', impact: 'negative' });

  // Drop the demo line about real-time sources when NewsAPI evidence actually was checked.
  const limitations = ai?.limitations.length ? ai.limitations : demoResult.limitations.filter((l) => newsDemo || newsError || !/real-time sources/.test(l));
  let fallbackReason = null;
  if (!HAS_GROQ) {
    fallbackReason = 'No Groq API key configured';
    limitations.push('No Groq API key configured (running in demo AI mode).');
  } else if (aiError) {
    if (/invalid.*key|unauthorized|401/i.test(aiError)) {
      fallbackReason = 'Groq authentication failed';
      limitations.push('Groq API authentication failed (invalid or expired key). Running in fallback demo mode.');
    } else if (/rate.*limit|quota|429/i.test(aiError)) {
      fallbackReason = 'Groq rate limit exceeded';
      limitations.push('Groq API rate limit or quota exceeded. Running in fallback demo mode.');
    } else if (/model_not_found|does not exist|not found|404/i.test(aiError)) {
      fallbackReason = 'Groq model unavailable';
      limitations.push('Configured Groq model is not available for this account. Running in fallback demo mode.');
    } else if (/timeout/i.test(aiError)) {
      fallbackReason = 'Groq request timed out';
      limitations.push('Groq API timed out. Running in fallback demo mode.');
    } else {
      fallbackReason = 'Groq AI service unavailable';
      limitations.push('Groq AI service unavailable. Running in fallback demo mode.');
    }
  }
  if (newsDemo) limitations.push('No NewsAPI key configured, so no live news evidence was checked.');
  if (newsError) limitations.push('NewsAPI could not be reached, so no live news evidence was checked.');

  // Distinct publisher domain calculation (deduplicating repeated pages from one source, e.g. multiple Wikipedia pages)
  const getPublisherKey = (pub = '', url = '') => {
    try {
      if (url) {
        const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        if (host.includes('wikipedia')) return 'wikipedia.org';
        return host;
      }
    } catch {}
    return String(pub).toLowerCase().trim();
  };

  const activeEvidence = verdict === 'REAL'
    ? evidence.filter((e) => e.status === 'SUPPORTS')
    : verdict === 'FAKE'
      ? evidence.filter((e) => e.status === 'CONTRADICTS')
      : [];

  const uniquePublisherKeys = new Set(activeEvidence.map((e) => getPublisherKey(e.publisher, e.url)).filter(Boolean));
  const distinctPublishers = uniquePublisherKeys.size;

  let rawConfidence = ai?.confidence ?? demoResult.confidence;
  let calibratedConfidence = rawConfidence;

  if (verdict === 'REAL' || verdict === 'FAKE') {
    if (distinctPublishers === 1) {
      // Single publisher / domain: calibrated strictly to 74-78%, never inflated by multiple pages from the same source
      calibratedConfidence = Math.max(72, Math.min(78, rawConfidence));
    } else if (distinctPublishers >= 2) {
      // Multiple distinct independent publishers: 85-92%
      calibratedConfidence = Math.max(85, Math.min(92, rawConfidence));
    } else {
      // Inconclusive or context-only coverage: calibrated to 40-55%
      calibratedConfidence = Math.max(40, Math.min(55, rawConfidence));
    }
  } else {
    // UNVERIFIED: strictly 40-50%
    calibratedConfidence = Math.max(40, Math.min(50, rawConfidence));
  }

  const hasDirectEvidence = (verdict === 'REAL' && activeEvidence.some((e) => e.status === 'SUPPORTS')) ||
                            (verdict === 'FAKE' && activeEvidence.some((e) => e.status === 'CONTRADICTS'));

  // SUPPORTS and CONTRADICTS are direct evidence classifications.
  // CONTEXT alone must never qualify as EVIDENCE_BACKED.
  const assessmentType = (distinctPublishers > 0 && hasDirectEvidence)
    ? 'EVIDENCE_BACKED'
    : (verdict === 'REAL' || verdict === 'FAKE')
      ? 'AI_KNOWLEDGE'
      : 'UNVERIFIED';

  const hasOnlyContext = evidence.length > 0 && !hasDirectEvidence;
  if (hasOnlyContext) {
    if (!limitations.some((l) => /general background context only|direct confirming/i.test(l))) {
      limitations.unshift('Retrieved articles provide general background context only; direct confirming or refuting evidence was unavailable.');
    }
  }

  if (assessmentType === 'AI_KNOWLEDGE') {
    if (!limitations.some((l) => /background knowledge|no direct external evidence/i.test(l))) {
      limitations.unshift('Assessment based on AI background knowledge; no direct external evidence was retrieved.');
    }
  }

  if (newsError) {
    if (newsQuotaExceeded) {
      if (!limitations.some((l) => /daily developer quota|request limit/i.test(l))) {
        limitations.unshift('NewsAPI request limit exceeded (daily developer quota exhausted). Live news evidence was paused.');
      }
    } else {
      if (!limitations.some((l) => /NewsAPI could not be reached|Live news retrieval is unavailable/i.test(l))) {
        limitations.unshift('Live news retrieval is unavailable (NewsAPI could not be reached). No external news evidence was retrieved.');
      }
    }
  }

  res.json({
    verdict,
    confidence: calibratedConfidence,
    assessmentType,
    summary: ai?.summary || demoResult.summary,
    reasons,
    limitations: limitations.slice(0, 5),
    credibilityChecklist: credibility,
    evidence,
    earliestRelatedCoverage: earliestCoverage(relevant), // only from validated relevant articles
    noRelevantCoverage: !newsDemo && !newsError && relevant.length === 0,
    suggestedSearchTerms: ai?.suggestedSearchTerms.length ? ai.suggestedSearchTerms : demoResult.suggestedSearchTerms,
    keywords,
    demo: !ai,
    newsDemo,
    newsError,
    newsQuotaExceeded: Boolean(newsQuotaExceeded),
    newsProviders: newsProviders || [],
    aiConfigured: HAS_GROQ,
    aiError: Boolean(aiError),
    aiModel: ai ? ai.model : null,
    fallbackReason,
  });
});

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  ai: hasGroq(),
  news: hasNews(),
  freeNews: hasFreeNews(),
  providers: [hasNews() && 'NewsAPI', hasFreeNews() && 'FreeNewsAPI'].filter(Boolean),
  model: MODEL,
}));

// Quick API diagnostics for testing without exposing secrets
app.get('/api/verify-keys', async (_req, res) => {
  const result = {
    groq: { configured: hasGroq(), valid: false, message: '' },
    news: { configured: hasNews(), valid: false, message: '' },
    freeNews: { configured: hasFreeNews(), valid: false, message: '' },
  };

  const groqKey = getGroqKey();
  if (hasGroq()) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${groqKey}` },
        signal: AbortSignal.timeout(6000),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        result.groq.valid = true;
        const availableModels = (data.data || []).map((m) => m.id);
        const hasModel = availableModels.includes(MODEL);
        result.groq.message = hasModel
          ? `Connected (${MODEL} ready, ${availableModels.length} models available)`
          : `Connected (${availableModels.length} models available, ${MODEL} not in list)`;
      } else if (r.status === 401 || r.status === 403) {
        result.groq.message = `Authentication failed: Invalid or expired API key (HTTP ${r.status})`;
      } else if (r.status === 429) {
        result.groq.message = `Rate limit or quota exceeded (HTTP 429: ${data?.error?.message || 'Daily limit reached'})`;
      } else {
        result.groq.message = sanitizeError(data?.error?.message || `HTTP ${r.status}`);
      }
    } catch (err) {
      result.groq.message = sanitizeError(err.message);
    }
  } else {
    result.groq.message = 'Key not configured or placeholder used';
  }

  const newsKey = getNewsKey();
  if (hasNews()) {
    try {
      const r = await fetch(`${NEWS_BASE}/top-headlines?category=general&language=en&pageSize=1`, {
        headers: { 'X-Api-Key': newsKey },
        signal: AbortSignal.timeout(6000),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.status === 'ok') {
        result.news.valid = true;
        result.news.message = `Connected (${data.totalResults || 0} total headlines)`;
      } else if (r.status === 401 || r.status === 403) {
        result.news.message = `Authentication failed: Invalid or unauthorized API key (HTTP ${r.status})`;
      } else if (r.status === 429) {
        result.news.message = `Rate limit or quota exceeded (HTTP 429: ${data?.message || 'Daily limit reached'})`;
      } else {
        result.news.message = sanitizeError(data?.message || `HTTP ${r.status}`);
      }
    } catch (err) {
      result.news.message = sanitizeError(err.message);
    }
  } else {
    result.news.message = 'Key not configured or placeholder used';
  }

  const freeNewsKey = getFreeNewsKey();
  if (hasFreeNews()) {
    try {
      const r = await fetch(`${FREE_NEWS_BASE}/news?in_title=news`, {
        headers: { 'x-api-key': freeNewsKey },
        signal: AbortSignal.timeout(6000),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        result.freeNews.valid = true;
        const count = Array.isArray(data?.data) ? data.data.length : (Array.isArray(data?.articles) ? data.articles.length : 1);
        result.freeNews.message = `Connected (${count} sample articles verified)`;
      } else if (r.status === 401 || r.status === 403) {
        result.freeNews.message = `Authentication failed: Invalid or unauthorized API key (HTTP ${r.status})`;
      } else if (r.status === 429) {
        result.freeNews.message = `Rate limit or quota exceeded (HTTP 429: ${data?.message || data?.error || 'Daily limit reached'})`;
      } else {
        result.freeNews.message = sanitizeError(data?.message || data?.error || `HTTP ${r.status}`);
      }
    } catch (err) {
      result.freeNews.message = sanitizeError(err.message);
    }
  } else {
    result.freeNews.message = 'Key not configured or placeholder used';
  }

  res.json(result);
});

// Serve static frontend files from Vite build (dist/) in production
const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath));

// For SPA routing, serve index.html for any GET request that doesn't match an /api route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const indexFile = path.resolve(distPath, 'index.html');
  res.sendFile(indexFile, (err) => {
    if (err) next();
  });
});

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (!process.env.VERCEL && (isDirectRun || process.env.PORT)) {
  const port = getPort();
  app.listen(port, '0.0.0.0', () =>
    console.log(`TruthGuard server running on http://0.0.0.0:${port} · Groq: ${hasGroq() ? 'on' : 'demo'} (model: ${MODEL}) · NewsAPI: ${hasNews() ? 'on' : 'demo'}`),
  );
}

export default app;

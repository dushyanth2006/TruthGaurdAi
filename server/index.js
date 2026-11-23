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

// API keys live ONLY here on the server — never sent to the browser.
const GROQ_KEY = process.env.GROQ_API_KEY?.trim();
const NEWS_KEY = process.env.NEWS_API_KEY?.trim();
const PORT = Number(process.env.API_PORT) || 3001;

// Helper to check if a key is real vs missing or placeholder
const isConfigured = (key) => Boolean(key && !key.startsWith('your_') && !key.toLowerCase().includes('placeholder'));
const HAS_GROQ = isConfigured(GROQ_KEY);
const HAS_NEWS = isConfigured(NEWS_KEY);

// Default to llama-3.3-70b-versatile (Groq's recommended production model) or override via GROQ_MODEL in .env
const MODEL = process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile';
// Optional overrides (used for local testing against mock services).
const NEWS_BASE = process.env.NEWS_API_BASE || 'https://newsapi.org/v2';
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
async function newsApi(pathName, params) {
  if (!HAS_NEWS) throw new Error('NewsAPI key is not configured');
  let r;
  try {
    r = await fetch(`${NEWS_BASE}/${pathName}?${new URLSearchParams(params)}`, {
      headers: { 'X-Api-Key': NEWS_KEY },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('NewsAPI request timed out (8s limit)');
    }
    throw new Error(`NewsAPI network error: ${err.message}`);
  }

  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error(`NewsAPI returned non-JSON response (HTTP ${r.status})`);
  }

  if (!r.ok || data?.status !== 'ok') {
    throw new Error(data?.message || `NewsAPI HTTP ${r.status}`);
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
    }));
}

let newsCache = { at: 0, data: null };
app.get('/api/news', async (_req, res) => {
  if (!HAS_NEWS) return res.json({ articles: mockNews(), demo: true });
  if (newsCache.data && Date.now() - newsCache.at < 10 * 60_000) return res.json(newsCache.data);
  try {
    const articles = (await newsApi('top-headlines', { category: 'general', language: 'en', pageSize: '20' })).slice(0, 10);
    if (!articles.length) throw new Error('No headlines returned');
    newsCache = { at: Date.now(), data: { articles, demo: false } };
    res.json(newsCache.data);
  } catch (err) {
    console.error('[news]', err.message);
    res.json({ articles: mockNews(), demo: true });
  }
});

/* ---------------- Analyze pipeline ---------------- */
// Keep line breaks (needed for the headline/article check) but drop control characters.
const clean = (s) => s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/** Related NewsAPI articles for the claim. Uses intelligent multi-query strategy. */
async function fetchRelated(keywords, entities = []) {
  if (!HAS_NEWS || (!keywords.length && !entities.length)) return { articles: [], newsDemo: !HAS_NEWS, newsError: false };
  try {
    const base = { language: 'en', sortBy: 'relevancy', pageSize: '10' };
    
    // Extract technical standards (BS-VI, BS6, PM2.5, AQI, WHO, etc.) vs general named entities
    const tech = entities.filter((e) => /^(?:bs-[ivx0-9]+|bs\d+|pm\d*(?:\.\d+)?|aqi|cng|ev|who|nasa|cji|sc|epa)$/i.test(e));
    const named = entities.filter((e) => !tech.includes(e) && !['amid', 'will', 'that', 'with', 'from', 'stated', 'allow', 'directive'].includes(e.toLowerCase()));

    const queries = [];
    
    // Query 1: Location/named entity + technical standard (e.g. "Delhi BS-VI" or "Delhi pollution BS-VI")
    if (tech.length > 0 && named.length > 0) {
      queries.push(`${named[0]} ${tech[0]}`);
      queries.push(`${named[0]} pollution ${tech[0]}`);
    }
    
    // Query 2: Authority/Court + Location + Topic (e.g. "Delhi Supreme Court vehicles")
    if (named.length >= 2) {
      queries.push(`${named.slice(0, 2).join(' ')} vehicles`);
      queries.push(`${named.slice(0, 2).join(' ')} pollution`);
    }
    
    // Query 3: Core subject keywords
    if (keywords.length > 0) {
      queries.push(keywords.filter((k) => k.length >= 3 && !tech.includes(k)).slice(0, 3).join(' '));
    }

    const seenUrls = new Set();
    const seenTitles = new Set();
    const allArticles = [];

    const distinctQueries = [...new Set(queries.filter(Boolean))].slice(0, 3);
    for (const q of distinctQueries) {
      try {
        const found = await newsApi('everything', { ...base, q });
        for (const a of found) {
          const t = a.title?.trim().toLowerCase();
          if (!a.url || !t || seenUrls.has(a.url) || seenTitles.has(t)) continue;
          seenUrls.add(a.url);
          seenTitles.add(t);
          allArticles.push(a);
        }
        if (allArticles.length >= 10) break;
      } catch (err) {
        console.warn(`[newsApi query "${q}"]`, err.message);
      }
    }

    return { articles: allArticles, newsDemo: false, newsError: false };
  } catch (err) {
    console.error('[related news]', err.message);
    return { articles: [], newsDemo: false, newsError: true };
  }
}

const SYSTEM = `You are a careful fact-checking assistant inside a fake news detector.
You receive a CLAIM and NUMBERED NEWS ARTICLES (ids a1, a2, ...) found by search; they may be empty or unrelated.
STRICT RULES:
- Never invent sources, publishers, article titles, URLs, quotes, statistics or citations.
- Refer to the provided articles ONLY by their id in the "evidence" field. Never put URLs or article titles in any text.
- Verdict rules:
  * "REAL": When credible news coverage, official directives, court statements, or established facts confirm the core claim.
  * "FAKE": When credible coverage directly refutes the claim, or the claim is a known hoax/fabrication.
  * "UNVERIFIED": Only when available articles are completely silent or insufficient to confirm or refute the specific claim.
- "confidence" MUST be calibrated based on evidence strength and distinct publisher diversity (0-100):
  * 85-90%: Multiple distinct, independent news organizations (different publishers) directly corroborate the claim.
  * 70-79%: Supported by a single credible publisher or strong context with limited cross-outlet corroboration.
  * 40-59%: Inconclusive, ambiguous, or no matching reporting found.
- Do NOT artificially inflate confidence: never count multiple articles from the same publisher as separate independent sources.
Reply ONLY with one valid JSON object with exactly these keys:
{"verdict":"REAL","confidence":76,"summary":"Two or three plain-language sentences explaining the verdict and coverage.","reasons":[{"title":"Consistent coverage","detail":"One plain sentence.","impact":"positive"}],"limitations":["Short limitation."],"suggestedSearchTerms":["short search query"],"evidence":[{"id":"a1","relevance":90,"status":"SUPPORTS"}]}
Allowed values: verdict is one of REAL, FAKE, UNVERIFIED. confidence and relevance are integers 0-100. impact is one of negative, positive, neutral. status is one of SUPPORTS, CONTRADICTS, CONTEXT.
Reason titles are short labels such as Consistent coverage, Conflicting coverage, Missing author/source, Outdated event, Unsupported statistic, Headline/article mismatch, Misleading wording.
Give 3-5 reasons, 2-3 limitations and 3 suggested search terms. If there are no numbered articles, "evidence" is [].
RELEVANCE: list EVERY numbered article in "evidence" with a relevance score (0-100). Relevance = how directly the article reports on the SAME specific subject or policy as the claim (85-100 reports directly on the event/directive; 60-84 reports on related regulations/context; below 50 is a different topic). Set status as SUPPORTS if it corroborates the claim, CONTRADICTS if it refutes it, or CONTEXT.`;

const strList = (v, n) => (Array.isArray(v) ? v.slice(0, n).map((x) => stripUrls(x)).filter(Boolean) : []);
const VERDICTS = ['REAL', 'FAKE', 'UNVERIFIED'];

async function groqAnalyze(text, pool) {
  if (!HAS_GROQ) throw new Error('Groq API key is not configured');
  const context = pool.length
    ? pool.map((a) => `[${a.id}] ${a.source}, ${a.publishedAt?.slice(0, 10)}: ${a.title}${a.description ? ` — ${a.description.slice(0, 160)}` : ''}`).join('\n')
    : '(no related articles found)';

  const call = async (temperature) => {
    let r;
    try {
      r = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model: MODEL,
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
      throw new Error(`Groq connection error: ${err.message}`);
    }
    return r;
  };

  let r = await call(0.2);

  // Groq occasionally rejects its own output as invalid JSON (json_validate_failed): retry once, deterministically.
  if (r.status === 400) {
    const body = await r.text();
    if (body.includes('json_validate_failed')) {
      console.warn('[groq] invalid JSON from model, retrying once at temperature 0');
      r = await call(0);
    } else {
      let errMsg = 'Groq 400 Bad Request';
      try {
        const parsed = JSON.parse(body);
        if (parsed?.error?.message) errMsg = `Groq 400: ${parsed.error.message}`;
      } catch {
        errMsg = `Groq 400: ${body.slice(0, 160)}`;
      }
      throw new Error(errMsg);
    }
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
    throw new Error(errMsg);
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
  const { articles, newsDemo, newsError } = await fetchRelated(keywords, entities);
  const pool = relevantPool(articles, keywords, entities); // stage 1: keyword + entity + technical match

  // 3–4. Groq with structured JSON (or a calibrated evidence-aware fallback)
  let ai = null;
  let aiError = null;
  if (HAS_GROQ) {
    try {
      ai = await groqAnalyze(text, pool);
    } catch (err) {
      aiError = err.message;
      console.error('[groq error]', err.message);
    }
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
  if (!HAS_GROQ) {
    limitations.push('No Groq API key configured (running in demo AI mode).');
  } else if (aiError) {
    if (/invalid.*key|unauthorized|401/i.test(aiError)) {
      limitations.push('Groq API authentication failed (invalid or expired key). Running in fallback demo mode.');
    } else if (/rate.*limit|quota|429/i.test(aiError)) {
      limitations.push('Groq API rate limit or quota exceeded. Running in fallback demo mode.');
    } else if (/timeout/i.test(aiError)) {
      limitations.push('Groq API timed out. Running in fallback demo mode.');
    } else {
      limitations.push('Groq AI service unavailable. Running in fallback demo mode.');
    }
  }
  if (newsDemo) limitations.push('No NewsAPI key configured, so no live news evidence was checked.');
  if (newsError) limitations.push('NewsAPI could not be reached, so no live news evidence was checked.');

  res.json({
    verdict,
    confidence: ai?.confidence ?? demoResult.confidence,
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
    aiConfigured: HAS_GROQ,
    aiError: Boolean(aiError),
  });
});

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  ai: HAS_GROQ,
  news: HAS_NEWS,
  model: MODEL,
}));

// Quick API diagnostics for testing without exposing secrets
app.get('/api/verify-keys', async (_req, res) => {
  const result = {
    groq: { configured: HAS_GROQ, valid: false, message: '' },
    news: { configured: HAS_NEWS, valid: false, message: '' },
  };

  if (HAS_GROQ) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${GROQ_KEY}` },
        signal: AbortSignal.timeout(6000),
      });
      const data = await r.json();
      if (r.ok) {
        result.groq.valid = true;
        result.groq.message = `Connected (${data.data?.length || 0} models available)`;
      } else {
        result.groq.message = data?.error?.message || `HTTP ${r.status}`;
      }
    } catch (err) {
      result.groq.message = err.message;
    }
  } else {
    result.groq.message = 'Key not configured or placeholder used';
  }

  if (HAS_NEWS) {
    try {
      const r = await fetch(`${NEWS_BASE}/top-headlines?category=general&language=en&pageSize=1`, {
        headers: { 'X-Api-Key': NEWS_KEY },
        signal: AbortSignal.timeout(6000),
      });
      const data = await r.json();
      if (r.ok && data.status === 'ok') {
        result.news.valid = true;
        result.news.message = `Connected (${data.totalResults || 0} total headlines)`;
      } else {
        result.news.message = data?.message || `HTTP ${r.status}`;
      }
    } catch (err) {
      result.news.message = err.message;
    }
  } else {
    result.news.message = 'Key not configured or placeholder used';
  }

  res.json(result);
});

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun && !process.env.VERCEL) {
  app.listen(PORT, () =>
    console.log(`API on http://localhost:${PORT} · Groq: ${HAS_GROQ ? 'on' : 'demo'} (model: ${MODEL}) · NewsAPI: ${HAS_NEWS ? 'on' : 'demo'}`),
  );
}

export default app;

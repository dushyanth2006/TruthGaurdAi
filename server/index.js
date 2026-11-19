import 'dotenv/config';
import express from 'express';
import { credibilityChecklist, ruleReasons } from '../shared/checks.js';
import { categoryOf, extractKeywords, mockAnalyze, mockNews } from '../shared/demo.js';
import { applyRelevance, buildEvidence, claimEntities, earliestCoverage, RELEVANCE_THRESHOLD, relevantPool, stripUrls, validateEvidence } from './evidence.js';

// API keys live ONLY here on the server — never sent to the browser.
const GROQ_KEY = process.env.GROQ_API_KEY?.trim();
const NEWS_KEY = process.env.NEWS_API_KEY?.trim();
const PORT = process.env.API_PORT || 3001;
// llama-3.3-70b-versatile was retired by Groq; override with GROQ_MODEL in .env if this one is retired too.
const MODEL = process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';
// Optional overrides (used for local testing against mock services).
const NEWS_BASE = process.env.NEWS_API_BASE || 'https://newsapi.org/v2';
const GROQ_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';

const app = express();
app.use(express.json({ limit: '50kb' }));

/* ---------------- NewsAPI ---------------- */
async function newsApi(path, params) {
  const r = await fetch(`${NEWS_BASE}/${path}?${new URLSearchParams(params)}`, {
    headers: { 'X-Api-Key': NEWS_KEY },
    signal: AbortSignal.timeout(8000),
  });
  const data = await r.json();
  if (!r.ok || data.status !== 'ok') throw new Error(data.message || `NewsAPI ${r.status}`);
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
  if (!NEWS_KEY) return res.json({ articles: mockNews(), demo: true });
  if (newsCache.data && Date.now() - newsCache.at < 10 * 60_000) return res.json(newsCache.data);
  try {
    const articles = (await newsApi('top-headlines', { category: 'general', language: 'en', pageSize: '20' })).slice(0, 10);
    if (!articles.length) throw new Error('No headlines');
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

/** Related NewsAPI articles for the claim. Returns [] (and newsDemo) when unavailable. */
async function fetchRelated(keywords) {
  if (!NEWS_KEY || !keywords.length) return { articles: [], newsDemo: true, newsError: false };
  try {
    const base = { language: 'en', sortBy: 'relevancy', pageSize: '10', searchIn: 'title,description' };
    let articles = await newsApi('everything', { ...base, q: keywords.slice(0, 3).join(' ') });
    if (articles.length < 3) articles = [...articles, ...(await newsApi('everything', { ...base, q: keywords.slice(0, 4).join(' OR ') }))];
    return { articles, newsDemo: false, newsError: false };
  } catch (err) {
    console.error('[related]', err.message);
    return { articles: [], newsDemo: false, newsError: true };
  }
}

const SYSTEM = `You are a careful fact-checking assistant inside a fake news detector.
You receive a CLAIM and NUMBERED NEWS ARTICLES (ids a1, a2, ...) found by keyword search; they may be empty or unrelated.
STRICT RULES:
- Never invent sources, publishers, article titles, URLs, quotes, statistics or citations.
- Refer to the provided articles ONLY by their id in the "evidence" field. Never put URLs or article titles in any text.
- Verdict rules: "FAKE" when the claim is implausible, contradicts established facts or the provided coverage, or shows strong misinformation patterns (sensational urgency, extraordinary claims with no source). "REAL" when credible coverage or well-established facts confirm it. "UNVERIFIED" only when the claim is plausible but cannot be confirmed or refuted.
- "confidence" is how certain you are of the chosen verdict (0-100), not how likely the claim is true. Be calibrated.
Reply ONLY with one valid JSON object with exactly these keys (example values shown):
{"verdict":"UNVERIFIED","confidence":60,"summary":"Two or three plain-language sentences.","reasons":[{"title":"Missing author/source","detail":"One plain sentence.","impact":"negative"}],"limitations":["Short limitation."],"suggestedSearchTerms":["short search query"],"evidence":[{"id":"a1","relevance":85,"status":"CONTEXT"}]}
Allowed values: verdict is one of REAL, FAKE, UNVERIFIED. confidence and relevance are integers 0-100. impact is one of negative, positive, neutral. status is one of SUPPORTS, CONTRADICTS, CONTEXT.
Reason titles are short labels such as Misleading wording, Missing author/source, Outdated event, Conflicting coverage, Unsupported statistic, Headline/article mismatch, Consistent coverage.
Give 3-5 reasons, 2-3 limitations and 3 suggested search terms. If there are no numbered articles, "evidence" is [].
RELEVANCE: list EVERY numbered article in "evidence" with a relevance score. relevance = how directly the article reports on the SAME specific event or subject as the claim (90-100 same event; 70-89 same specific subject; below 50 merely shares words, people or places, or is a different story). Be strict: an article about a different event involving the same organisation or person is NOT relevant. "status" says how a relevant article bears on the claim. Only rely on articles with relevance >= ${RELEVANCE_THRESHOLD} when judging the claim.`;

const strList = (v, n) => (Array.isArray(v) ? v.slice(0, n).map((x) => stripUrls(x)).filter(Boolean) : []);
const VERDICTS = ['REAL', 'FAKE', 'UNVERIFIED'];

async function groqAnalyze(text, pool) {
  const context = pool.length
    ? pool.map((a) => `[${a.id}] ${a.source}, ${a.publishedAt?.slice(0, 10)}: ${a.title}${a.description ? ` — ${a.description.slice(0, 160)}` : ''}`).join('\n')
    : '(no related articles found)';
  const call = (temperature) => fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model: MODEL,
      temperature,
      reasoning_effort: 'low', // fast, cheap reasoning for gpt-oss models
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${SYSTEM}\nToday's date: ${new Date().toISOString().slice(0, 10)}.` },
        { role: 'user', content: `CLAIM:\n${text}\n\nNUMBERED NEWS ARTICLES:\n${context}` },
      ],
    }),
  });
  let r = await call(0.2);
  // Groq occasionally rejects its own output as invalid JSON (json_validate_failed): retry once, deterministically.
  if (r.status === 400) {
    const body = await r.text();
    if (!body.includes('json_validate_failed')) throw new Error(`Groq 400: ${body.slice(0, 200)}`);
    console.warn('[groq] invalid JSON from model, retrying once');
    r = await call(0);
  }
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const out = JSON.parse((await r.json()).choices[0].message.content);
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
    evidenceIds: Array.isArray(out.evidence) ? out.evidence : [], // ids only — resolved against the pool below
  };
}

app.post('/api/analyze', async (req, res) => {
  // 1. Validate & clean
  const text = clean(typeof req.body?.text === 'string' ? req.body.text : '').slice(0, 5000);
  if (text.length < 15 || text.split(/\s+/).length < 4)
    return res.status(400).json({ error: 'Please provide a full claim (at least 15 characters and 4 words).' });

  // 2. Rule-based checks (free) + keywords → NewsAPI related articles
  const credibility = credibilityChecklist(text);
  const keywords = extractKeywords(text, 5);
  const { articles, newsDemo, newsError } = await fetchRelated(keywords);
  const entities = claimEntities(text);
  const pool = relevantPool(articles, keywords, entities); // stage 1: keyword + entity overlap

  // 3–4. Groq with structured JSON (or a clearly labelled rule-based fallback)
  let ai = null;
  if (GROQ_KEY) {
    try {
      ai = await groqAnalyze(text, pool);
    } catch (err) {
      console.error('[groq]', err.message);
    }
  }
  const demoResult = mockAnalyze(text); // rule-based fallback, also fills any empty AI fields
  const verdict = ai?.verdict ?? demoResult.verdict.toUpperCase();
  const title = { REAL: 'Real', FAKE: 'Fake', UNVERIFIED: 'Unverified' }[verdict];

  // 5. Evidence: stage 2 relevance (Groq score, or a strict lexical rule without AI), then built from
  //    NewsAPI data only and validated against the relevant set. Unrelated articles are never shown.
  const relevant = applyRelevance(pool, ai?.evidenceIds, { aiAvailable: Boolean(ai), keywordCount: keywords.length, entityCount: entities.length });
  const evidence = validateEvidence(buildEvidence(relevant), relevant);
  const reasons = ai?.reasons.length >= 3 ? ai.reasons : [...(ai?.reasons ?? []), ...ruleReasons(credibility, title)].slice(0, 5);
  if (evidence.some((e) => e.status === 'CONTRADICTS') && !reasons.some((r) => /conflict/i.test(r.title)))
    reasons.splice(Math.min(reasons.length, 4), 1, { title: 'Conflicting coverage', detail: 'At least one related news article contradicts the claim.', impact: 'negative' });

  // Drop the demo line about real-time sources when NewsAPI evidence actually was checked.
  const limitations = ai?.limitations.length ? ai.limitations : demoResult.limitations.filter((l) => newsDemo || newsError || !/real-time sources/.test(l));
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
  });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, ai: Boolean(GROQ_KEY), news: Boolean(NEWS_KEY) }));

app.listen(PORT, () =>
  console.log(`API on http://localhost:${PORT} · Groq: ${GROQ_KEY ? 'on' : 'demo'} · NewsAPI: ${NEWS_KEY ? 'on' : 'demo'}`),
);

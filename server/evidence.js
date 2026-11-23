// Evidence handling. Every source shown in the UI is built HERE from NewsAPI data —
// never from text the AI model wrote. The model may only reference articles by id.
//
// Relevance is decided in two stages:
//   1. Lexical: keyword + named-entity overlap with the claim (server-side, free).
//   2. Semantic: Groq scores every remaining article 0-100 for "same specific event/subject".
//      Only articles scoring >= RELEVANCE_THRESHOLD are used. If Groq is unavailable,
//      a stricter lexical rule is used instead. Unrelated articles are never shown.

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const STATUSES = ['SUPPORTS', 'CONTRADICTS', 'CONTEXT'];
export const RELEVANCE_THRESHOLD = 55;

/** Remove any URL the model may have written into free text. */
export const stripUrls = (s) => String(s ?? '').replace(URL_RE, '').replace(/\s{2,}/g, ' ').trim();

const ENTITY_STOP = new Set(('the a an this that these those it its in on at for and or but if as of to by with from ' +
  'share breaking shocking urgent alert warning update news report reports says said according today yesterday ' +
  'tomorrow new viral claim claims post experts sources officials scientists doctors people they we you he she will stated allow').split(' '));

/** Named entities, technical standards, and acronyms in the claim (NASA, Voyager, BS-VI, Delhi). */
export function claimEntities(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\b(?:BS-[IVX0-9]+|BS\d+|PM\d*(?:\.\d+)?|AQI|COVID(?:-19)?)\b|\b[A-Z][a-zA-Z]+(?:['’]s)?\b|\b[A-Z]{2,}\b/g)) {
    const w = m[0].replace(/['’]s$/, '').toLowerCase();
    if (ENTITY_STOP.has(w) || (w.length < 2 && !/^[A-Z]{2}$/.test(m[0]))) continue;
    out.add(w);
  }
  return [...out].slice(0, 10);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Stage 1 measurement: scoring how directly an article mentions claim keywords, entities and technical codes. */
export function lexicalMatch(a, keywords, entities) {
  const hay = `${a.title} ${a.description || ''}`.toLowerCase();
  const kwHits = keywords.filter((k) => k.length >= 3 && hay.includes(k.toLowerCase())).length;
  const entHits = entities.filter((e) => e.length >= 3 && new RegExp(`\\b${escapeRe(e.toLowerCase())}\\b`, 'i').test(hay)).length;

  // Technical standard match bonus (e.g. BS-VI, BS6, PM2.5, WHO, NASA, CNG, EV)
  const techHits = entities.filter((e) => /^(?:bs-[ivx0-9]+|bs\d+|pm\d*(?:\.\d+)?|aqi|cng|ev|who|nasa|cji|sc|epa)$/i.test(e) && hay.includes(e.toLowerCase())).length;

  const score = Math.min(100, (techHits * 40) + (entHits * 22) + (kwHits * 12));
  return { kwHits, entHits, techHits, score };
}

/** Stage 1 threshold: allows articles with meaningful semantic or keyword connection. */
export function passesLexical({ kwHits, entHits, techHits, score }, keywordCount, entityCount, strict = false) {
  if (techHits >= 1 && (entHits >= 1 || kwHits >= 1)) return true;
  if (score >= (strict ? 50 : 35)) return true;
  if (strict) {
    return (kwHits >= 2 && entHits >= 1) || entHits >= 2;
  }
  return (kwHits >= 1 && entHits >= 1) || entHits >= 1 || kwHits >= 2;
}

/** Stage 1: candidate pool (deduplicated, lexically related), best matches first, ids a1..aN. */
export function relevantPool(articles, keywords, entities = [], max = 8) {
  const seen = new Set();
  return articles
    // de-duplicate by URL and by headline (outlets sometimes publish one story at two URLs)
    .filter((a) => { const t = a?.title?.trim().toLowerCase(); if (!a?.url || !t || seen.has(a.url) || seen.has(t)) return false; seen.add(a.url); seen.add(t); return true; })
    .map((a) => ({ ...a, ...lexicalMatch(a, keywords, entities) }))
    .filter((a) => passesLexical(a, keywords.length, entities.length))
    .sort((x, y) => y.score - x.score || (y.kwHits + y.entHits) - (x.kwHits + x.entHits))
    .slice(0, max)
    .map((a, i) => ({ ...a, id: `a${i + 1}` }));
}

/**
 * Stage 2: keep only genuinely relevant articles.
 * With AI: articles the model scored >= threshold (unscored / unknown ids are dropped).
 * Without AI: lexical/semantic scoring with status classification.
 */
export function applyRelevance(pool, aiItems, { aiAvailable, keywordCount, entityCount, threshold = RELEVANCE_THRESHOLD }) {
  if (!aiAvailable) {
    return pool
      .filter((a) => (a.score ?? 0) >= threshold || passesLexical(a, keywordCount, entityCount, true))
      .map((a) => {
        const hay = `${a.title} ${a.description || ''}`.toLowerCase();
        let status = 'CONTEXT';
        if (/\b(?:debunk|false|hoax|fake|rumor|misleading|refutes?)\b/i.test(hay)) {
          status = 'CONTRADICTS';
        } else if ((a.score ?? 0) >= 60 || (a.entHits >= 1 && a.kwHits >= 1)) {
          status = 'SUPPORTS';
        }
        return { ...a, status, relevance: Math.max(50, Math.min(100, a.score || 70)) };
      })
      .sort((x, y) => (y.relevance ?? 0) - (x.relevance ?? 0));
  }
  const scored = new Map();
  for (const s of Array.isArray(aiItems) ? aiItems : []) {
    const id = String(s?.id ?? '');
    const relevance = Number(s?.relevance);
    if (!pool.some((a) => a.id === id) || scored.has(id) || !Number.isFinite(relevance)) continue;
    const st = String(s?.status ?? '').toUpperCase();
    scored.set(id, { relevance: Math.max(0, Math.min(100, relevance)), status: STATUSES.includes(st) ? st : 'CONTEXT' });
  }
  return pool
    .filter((a) => (scored.get(a.id)?.relevance ?? 0) >= threshold)
    .map((a) => ({ ...a, ...scored.get(a.id) }))
    .sort((x, y) => y.relevance - x.relevance);
}

/** Up to 3 evidence cards from the relevant set. Fields come only from NewsAPI data. */
export function buildEvidence(relevant) {
  return relevant.slice(0, 3).map((a) => ({
    title: a.title,
    publisher: a.source,
    publishedAt: a.publishedAt,
    url: a.url,
    status: a.status,
  }));
}

/** Final guard: drop any evidence item whose url+title is not a relevant article from this NewsAPI response. */
export function validateEvidence(evidence, relevant) {
  const byUrl = new Map(relevant.map((a) => [a.url, a]));
  return evidence.filter((e) => {
    const a = byUrl.get(e.url);
    return a && a.title === e.title && a.source === e.publisher && a.publishedAt === e.publishedAt && STATUSES.includes(e.status);
  });
}

/** The validated relevant article with the earliest publishedAt (not necessarily the original source). */
export function earliestCoverage(relevant) {
  const dated = relevant.filter((a) => !Number.isNaN(Date.parse(a.publishedAt)));
  if (!dated.length) return null;
  const a = dated.reduce((m, x) => (Date.parse(x.publishedAt) < Date.parse(m.publishedAt) ? x : m));
  return { title: a.title, publisher: a.source, publishedAt: a.publishedAt, url: a.url, note: 'Earliest related coverage found.' };
}

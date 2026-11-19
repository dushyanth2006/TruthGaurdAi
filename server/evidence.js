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
export const RELEVANCE_THRESHOLD = 70;

/** Remove any URL the model may have written into free text. */
export const stripUrls = (s) => String(s ?? '').replace(URL_RE, '').replace(/\s{2,}/g, ' ').trim();

const ENTITY_STOP = new Set(('the a an this that these those it its in on at for and or but if as of to by with from ' +
  'share breaking shocking urgent alert warning update news report reports says said according today yesterday ' +
  'tomorrow new viral claim claims post experts sources officials scientists doctors people they we you he she').split(' '));

/** Named entities in the claim: capitalised words and acronyms (NASA, Voyager, Earth, WHO). */
export function claimEntities(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\b[A-Z][a-zA-Z]+(?:['’]s)?\b|\b[A-Z]{2,}\b/g)) {
    const w = m[0].replace(/['’]s$/, '').toLowerCase();
    if (ENTITY_STOP.has(w) || (w.length < 3 && !/^[A-Z]{2}$/.test(m[0]))) continue;
    out.add(w);
  }
  return [...out].slice(0, 8);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Stage 1 measurement: how many claim keywords and entities an article mentions. */
export function lexicalMatch(a, keywords, entities) {
  const hay = `${a.title} ${a.description || ''}`.toLowerCase();
  return {
    kwHits: keywords.filter((k) => hay.includes(k)).length,
    entHits: entities.filter((e) => new RegExp(`\\b${escapeRe(e)}\\b`, 'i').test(hay)).length,
  };
}

/** Stage 1 threshold. `strict` is used when no semantic (Groq) check is available. */
export function passesLexical({ kwHits, entHits }, keywordCount, entityCount, strict = false) {
  const needKw = keywordCount < 2 ? keywordCount : Math.max(2, Math.ceil((strict ? 0.6 : 0.4) * keywordCount));
  const needEnt = entityCount === 0 ? 0 : strict ? Math.min(2, entityCount) : 1;
  return kwHits >= needKw && entHits >= needEnt;
}

/** Stage 1: candidate pool (deduplicated, lexically related), best matches first, ids a1..aN. */
export function relevantPool(articles, keywords, entities = [], max = 6) {
  const seen = new Set();
  return articles
    // de-duplicate by URL and by headline (outlets sometimes publish one story at two URLs)
    .filter((a) => { const t = a?.title?.trim().toLowerCase(); if (!a?.url || !t || seen.has(a.url) || seen.has(t)) return false; seen.add(a.url); seen.add(t); return true; })
    .map((a) => ({ ...a, ...lexicalMatch(a, keywords, entities) }))
    .filter((a) => passesLexical(a, keywords.length, entities.length))
    .sort((x, y) => y.kwHits + y.entHits - (x.kwHits + x.entHits))
    .slice(0, max)
    .map((a, i) => ({ ...a, id: `a${i + 1}` }));
}

/**
 * Stage 2: keep only genuinely relevant articles.
 * With AI: articles the model scored >= threshold (unscored / unknown ids are dropped).
 * Without AI: the stricter lexical rule. Returns articles with { status, relevance }.
 */
export function applyRelevance(pool, aiItems, { aiAvailable, keywordCount, entityCount, threshold = RELEVANCE_THRESHOLD }) {
  if (!aiAvailable) {
    return pool
      .filter((a) => passesLexical(a, keywordCount, entityCount, true))
      .map((a) => ({ ...a, status: 'CONTEXT', relevance: null }));
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

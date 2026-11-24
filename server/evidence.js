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
  'tomorrow new viral claim claims post experts sources officials scientists doctors people they we you he she will stated allow ' +
  'drinking eating taking having doing making getting going seeing instant instantly cures cure every permanently glass water').split(' '));

/** Named entities, technical standards, mission names, acronyms, and core subjects (NASA, Chandrayaan-3, BS-VI, Delhi). */
export function claimEntities(text) {
  const out = new Set();
  
  // 1. Technical standards, codes, telecom, mission names (e.g. Chandrayaan-3, BS-VI, COVID-19, PM2.5, Apollo 11, 5G, 4G, UPI, EV)
  for (const m of String(text).matchAll(/\b(?:Chandrayaan-\d+|Apollo[- ]\d+|BS-[IVX0-9]+|BS\d+|PM\d*(?:\.\d+)?|AQI|[2-6]G|EV|UPI|CNG|COVID(?:-19)?)\b/gi)) {
    out.add(m[0].toLowerCase());
  }

  // Years (e.g. 2016, 1950, 1969, 2023, 2027)
  for (const m of String(text).matchAll(/\b(?:19\d\d|20\d\d)\b/g)) {
    out.add(m[0]);
  }

  // 2. Acronyms & organizations (ISRO, NASA, WHO, FDA, CDC, CJI, SC, EPA, UN, NPCI, RBI, DOT)
  for (const m of String(text).matchAll(/\b[A-Z]{2,}\b/g)) {
    const w = m[0].toLowerCase();
    if (!ENTITY_STOP.has(w)) out.add(w);
  }

  // 3. Proper nouns (Capitalized words, compound names)
  for (const m of String(text).matchAll(/\b[A-Z][a-zA-Z0-9]*(?:-[A-Za-z0-9]+)*\b/g)) {
    const w = m[0].replace(/['’]s$/, '').toLowerCase();
    if (ENTITY_STOP.has(w) || w.length < 2) continue;
    out.add(w);
  }

  // 4. Critical scientific, health, telecom & domain terms
  for (const term of ['cancer', 'tumor', 'vaccin', '5g', '4g', 'upi', 'telecom', 'moon', 'mars', 'earth', 'solar', 'climate', 'pollution', 'emission']) {
    if (new RegExp(`\\b${term}`, 'i').test(text)) {
      out.add(term);
    }
  }

  return [...out].slice(0, 10);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Stage 1 measurement: scoring how directly an article mentions claim keywords, entities and technical codes. */
export function lexicalMatch(a, keywords, entities) {
  const hay = `${a.title} ${a.description || ''}`.toLowerCase();
  
  // If the claim specifically mentions water, do not match alcohol drinking articles that lack water
  const claimHasWater = keywords.includes('water') || entities.includes('water');
  const articleHasWater = hay.includes('water') || hay.includes('hydration');
  const effectiveKeywords = claimHasWater && !articleHasWater
    ? keywords.filter((k) => k !== 'drinking')
    : keywords;

  const kwHits = effectiveKeywords.filter((k) => k.length >= 3 && hay.includes(k.toLowerCase())).length;
  const entHits = entities.filter((e) => e.length >= 3 && new RegExp(`\\b${escapeRe(e.toLowerCase())}\\b`, 'i').test(hay)).length;

  // Technical standard match bonus (e.g. BS-VI, BS6, PM2.5, WHO, NASA, CNG, EV, 5G, UPI)
  const techHits = entities.filter((e) => /^(?:chandrayaan-\d+|apollo[- ]\d+|bs-[ivx0-9]+|bs\d+|pm\d*(?:\.\d+)?|aqi|cng|ev|who|isro|nasa|cji|sc|epa|[2-6]g|upi|npci|rbi)$/i.test(e) && hay.includes(e.toLowerCase())).length;

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
  return (kwHits >= 1 && entHits >= 1) || entHits >= 2 || kwHits >= 2;
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

/** Up to 3 evidence cards from the relevant set. Prefers direct evidence (SUPPORTS/CONTRADICTS) over generic CONTEXT. */
export function buildEvidence(relevant) {
  const direct = relevant.filter((a) => a.status === 'SUPPORTS' || a.status === 'CONTRADICTS');
  const context = relevant.filter((a) => a.status === 'CONTEXT');
  // If direct evidence is available, exclude general context-only articles from the evidence cards
  const selected = direct.length > 0 ? direct.slice(0, 3) : context.slice(0, 3);
  return selected.map((a) => ({
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

// Rule-based credibility checks (no API usage). Shared by the Express server and the browser fallback.
import { extractKeywords } from './demo.js';

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec';
const CLICKBAIT = ['shocking', 'miracle', 'secret', "they don't want", 'share before', 'banned', "you won't believe", 'urgent', 'forward this', 'deleted', 'exposed', 'mind-blowing', '100%', 'cure', 'hoax', 'must see', 'wake up'];
const SOURCE_WORDS = /\b(according to|reported by|said in a statement|press release|spokesperson|ministry|university|institute|agency|department|official(?:ly)? (?:said|confirmed|announced|stated)|associated press|reuters|bbc|cnn|al jazeera|new york times|the guardian|washington post|bloomberg)\b/i;
const SOURCE_ACRONYMS = /\b(WHO|UN|CDC|NASA|AP|IMF|EU|NHS|FDA)\b/;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const DATE_RES = [
  /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/,
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:19|20)\\d{2}\\b`, 'i'),
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\.?,?\\s+(?:19|20)\\d{2}\\b`, 'i'),
  /\b\d{1,2}\/\d{1,2}\/(?:19|20)\d{2}\b/,
];

const item = (id, label, state, detail) => ({ id, label, state, detail });
/** Shorten a quoted snippet at a word boundary. */
const shorten = (s, n = 48) => {
  if (s.length <= n) return s;
  const cut = s.lastIndexOf(' ', n);
  return `${s.slice(0, cut > 20 ? cut : n).replace(/[\s,;:]+$/, '')}…`;
};

/* ---------- Source attribution: specific vs. vague ---------- */
// Vague references never count as an identified source: lists of possible outlets,
// "an official website", unnamed "experts say", "reportedly", "according to reports"…
const VAGUE_PATTERNS = [
  /\b[A-Z][\w&.]*(?:\s+[A-Z][\w&.]*)?(?:\s*,\s*[A-Z][\w&.]*(?:\s+[A-Z][\w&.]*)?)+\s*,?\s+(?:or|and\/or)\s+(?:an?\s+|any\s+|other\s+)?[\w\s]{0,30}/g, // "BBC, Reuters, AP, or an official website"
  /\b[A-Z][\w&.]+\s+or\s+(?:[A-Z][\w&.]+|an?\s+\w+(?:\s+\w+)?)/g, // "BBC or Reuters", "NASA or an agency"
  /\b(?:an?|the|some|other|any|several|many|various)\s+(?:official|trusted|reputable|reliable|major|mainstream|credible|leading|independent)\s+(?:website|site|source|outlet|media|news\s+(?:site|outlet|source|channel)|channel|publication|report|study)s?\b/gi,
  /\b(?:such as|e\.g\.|for example|like)\s+[A-Z][\w&.]*(?:\s*,\s*[A-Z][\w&.]*)*/g,
  /\b(?:sources|experts|officials|reports|studies|scientists|doctors|insiders|researchers|analysts|people|many|some)\s+(?:say|said|claim|claimed|suggest|suggested|believe|reveal|revealed|warn|warned|show|showed|confirm|confirmed)\b/gi,
  /\baccording to\s+(?:reports|sources|experts|officials|studies|insiders|many|some|social media)\b/gi,
  /\b(?:reportedly|allegedly|it is (?:reported|said|claimed|believed))\b/gi,
];
const GENERIC_NAMES = new Set(['experts', 'sources', 'officials', 'reports', 'scientists', 'doctors', 'insiders', 'researchers', 'analysts', 'people', 'authorities', 'police', 'media', 'government', 'they', 'it', 'this', 'he', 'she', 'we', 'many', 'some', 'everyone']);
const NAME = "(?:the\\s+)?([A-Z][\\w&.'’-]*(?:\\s+(?:of|for|and|on|de)?\\s*[A-Z][\\w&.'’-]*){0,5})";
const ATTRIBUTION_RES = [
  new RegExp(`\\b(?:according to|reported by|published by|confirmed by|announced by|issued by|released by|via|told)\\s+${NAME}`, 'g'),
  new RegExp(`\\b${NAME}\\s+(?:said|says|reported|reports|announced|announces|confirmed|confirms|stated|states|told|published|wrote|tweeted|posted)\\b`, 'g'),
  /\(\s*(Reuters|AP|AFP|PTI|ANI|IANS|Bloomberg)\s*\)/g, // wire dateline "(Reuters) -"
];

/** Removes vague references so they can't be mistaken for a specific source. */
function stripVague(text) {
  let vague = null;
  let out = text;
  for (const re of VAGUE_PATTERNS) {
    out = out.replace(re, (m) => { vague ??= m.trim(); return ' '; });
  }
  return { rest: out, vague };
}

/** A specific, named source (e.g. "NASA", "the World Health Organization"), or null. */
export function specificSource(text) {
  const { rest, vague } = stripVague(text);
  for (const re of ATTRIBUTION_RES) {
    for (const m of rest.matchAll(re)) {
      const name = (m[1] || '').replace(/^the\s+/i, '').replace(/[.,;:!?]+$/, '').trim();
      if (name.length >= 2 && !GENERIC_NAMES.has(name.toLowerCase()) && !/^(?:The|A|An|This|That|It)$/.test(name)) return { name, vague };
    }
  }
  const link = text.match(URL_RE);
  if (link) {
    try { return { name: new URL(link[0].startsWith('http') ? link[0] : `https://${link[0]}`).hostname.replace(/^www\./, ''), vague }; } catch { /* ignore */ }
  }
  // A known organisation/outlet appears, but nothing says it is the source of the claim.
  const mentioned = rest.match(SOURCE_ACRONYMS)?.[0] || rest.match(SOURCE_WORDS)?.[0] || null;
  return { name: null, vague, mentioned };
}

/** A concrete, verifiable reference: link, DOI, quote attributed to a named source, or a named report/study. */
function concreteCitation(text, source) {
  const { rest } = stripVague(text);
  if ((text.match(URL_RE) || []).length) return 'a link to the source material';
  if (/\b(?:doi:\s*10\.\d{4,}|10\.\d{4,}\/\S+|arxiv:\s*\d{4}\.\d{4,})/i.test(text)) return 'a DOI / paper reference';
  if (source && /["“][^"”]{8,}["”]/.test(text)) return `a quote attributed to ${source}`;
  const report = rest.match(/\b(?:study|report|survey|paper|analysis|statement|press release|poll|bulletin|dataset)\s+(?:published|released|issued|conducted|carried out)?\s*(?:in|by|from)\s+(?:the\s+)?([A-Z][\w&.'’-]*(?:\s+(?:of|for|and)?\s*[A-Z][\w&.'’-]*){0,5})/);
  const reportName = report?.[1].replace(/[.,;:!?]+$/, '');
  if (reportName && !GENERIC_NAMES.has(reportName.toLowerCase())) return `a named report from ${reportName}`;
  return null;
}

function findDate(text) {
  for (const re of DATE_RES) {
    const m = text.match(re);
    if (m) {
      const t = Date.parse(m[0].replace(/(\d)(st|nd|rd|th)/i, '$1'));
      if (!Number.isNaN(t)) return { raw: m[0], time: t };
      // dd/mm/yyyy that Date can't parse: fall back to the year
      const y = m[0].match(/(19|20)\d{2}/);
      if (y) return { raw: m[0], time: Date.UTC(+y[0], 0, 1) };
    }
  }
  return null;
}

/**
 * Credibility checklist for the submitted text.
 * state: 'pass' (green) | 'warn' (amber) | 'fail' (red) | 'na' (not applicable)
 */
export function credibilityChecklist(text, now = Date.now()) {
  const t = text.toLowerCase();
  const out = [];

  // 1. Author
  const author = text.match(/\b(?:[Bb]y|Written by|Author:)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){0,2})/);
  out.push(author
    ? item('author', 'Author', 'pass', `Byline found: ${author[1]}.`)
    : item('author', 'Author', 'warn', 'No author or byline found in the text.'));

  // 2. Publication date
  const date = findDate(text);
  const yearOnly = !date && text.match(/\b(?:19|20)\d{2}\b/);
  if (date) {
    const days = (now - date.time) / 86_400_000;
    out.push(days <= 365
      ? item('date', 'Publication date', 'pass', `Dated ${date.raw} — recent.`)
      : item('date', 'Publication date', 'warn', `Dated ${date.raw} — over a year old, may be outdated.`));
  } else {
    out.push(item('date', 'Publication date', 'warn', yearOnly ? `Only a year (${yearOnly[0]}) is mentioned, no full date.` : 'No publication date found.'));
  }

  // 3. Publisher / source — OK only for a specific, attributed source (not a vague mention or list)
  const src = specificSource(text);
  out.push(src.name
    ? item('publisher', 'Publisher / source', 'pass', `Specific source identified: ${src.name}.`)
    : src.vague
      ? item('publisher', 'Publisher / source', 'warn', `Sources are only mentioned vaguely (“${shorten(src.vague)}”) — no specific publisher is identified.`)
      : src.mentioned
        ? item('publisher', 'Publisher / source', 'warn', `“${shorten(src.mentioned, 30)}” is mentioned, but the claim isn’t clearly attributed to a specific source.`)
        : item('publisher', 'Publisher / source', 'fail', 'No publisher, outlet or official source is identified.'));

  // 4. Evidence links
  const links = text.match(URL_RE) || [];
  out.push(links.length
    ? item('links', 'Evidence links', 'pass', `${links.length} link${links.length > 1 ? 's' : ''} to supporting material included.`)
    : item('links', 'Evidence links', 'warn', 'No links to supporting evidence.'));

  // 5. Cited sources — OK only for a concrete, verifiable reference
  const citation = concreteCitation(text, src.name);
  const stats = /\d+(?:\.\d+)?\s?%|\b\d{2,}(?:,\d{3})*\s+(?:people|deaths|cases|patients|votes|jobs)\b/i.test(text);
  const genericRef = src.vague || src.mentioned ||/\b(?:studies|research|data|reports|statistics|science)\s+(?:show|shows|showed|prove|proves|suggest|suggests|found)\b|\ba (?:study|report|survey)\b/i.test(text);
  out.push(citation
    ? item('citations', 'Cited sources', 'pass', `Concrete citation found: ${citation}.`)
    : stats
      ? item('citations', 'Cited sources', 'fail', 'Statistics are given without a concrete, verifiable citation.')
      : genericRef
        ? item('citations', 'Cited sources', 'warn', 'References are generic (no link, quote or named report to verify).')
        : item('citations', 'Cited sources', 'warn', 'No cited sources detected.'));

  // 6. Emotional / clickbait wording
  const cues = CLICKBAIT.filter((c) => t.includes(c));
  const exclaim = (text.match(/!/g) || []).length;
  const caps = (text.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !SOURCE_ACRONYMS.test(w)).length;
  const score = cues.length + (exclaim > 1 ? 1 : 0) + (caps >= 2 ? 1 : 0);
  const found = [...cues.map((c) => `“${c}”`), ...(exclaim > 1 ? [`${exclaim} exclamation marks`] : []), ...(caps >= 2 ? ['ALL-CAPS words'] : [])];
  out.push(score === 0
    ? item('clickbait', 'Emotional / clickbait wording', 'pass', 'Wording is neutral.')
    : item('clickbait', 'Emotional / clickbait wording', score >= 2 ? 'fail' : 'warn', `Detected: ${found.slice(0, 4).join(', ')}.`));

  // 7. Headline / article mismatch (only when a headline + body were pasted)
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const body = lines.slice(1).join(' ');
  if (lines.length >= 2 && body.length >= 120) {
    const kw = extractKeywords(lines[0], 6);
    const hit = kw.filter((k) => body.toLowerCase().includes(k)).length;
    const ratio = kw.length ? hit / kw.length : 1;
    out.push(ratio < 0.34
      ? item('mismatch', 'Headline vs. article', 'fail', 'Key terms from the headline barely appear in the article body.')
      : item('mismatch', 'Headline vs. article', 'pass', 'The headline matches the article body.'));
  } else {
    out.push(item('mismatch', 'Headline vs. article', 'na', 'Not applicable — no separate headline and article body.'));
  }

  return out;
}

/** Plain-language reasons derived from the checklist (used when AI is unavailable). */
export function ruleReasons(checklist, verdict) {
  const by = Object.fromEntries(checklist.map((c) => [c.id, c]));
  const reasons = [];
  const push = (title, detail, impact) => reasons.push({ title, detail, impact });
  if (by.clickbait?.state !== 'pass') push('Misleading or emotional wording', by.clickbait.detail + ' Sensational language is a common misinformation pattern.', 'negative');
  if (by.publisher?.state === 'fail') push('Missing author or source', 'The claim does not name who reported it, so it cannot be traced or checked.', 'negative');
  if (by.citations?.state === 'fail') push('Unsupported statistic', by.citations.detail, 'negative');
  if (by.date?.state === 'warn' && /over a year/.test(by.date.detail)) push('Possibly outdated event', by.date.detail, 'negative');
  if (by.mismatch?.state === 'fail') push('Headline/article mismatch', by.mismatch.detail, 'negative');
  if (by.publisher?.state === 'warn') push('Vague sourcing', by.publisher.detail, 'negative');
  if (by.publisher?.state === 'pass') push('Attributed to an identifiable source', 'Naming a specific source makes the claim traceable and easier to verify.', 'positive');
  if (by.links?.state === 'pass') push('Evidence links provided', by.links.detail, 'positive');
  if (by.clickbait?.state === 'pass') push('Neutral, factual tone', 'The wording avoids sensational or emotional manipulation.', 'positive');
  if (reasons.length < 3) push('Limited context', verdict === 'Unverified' ? 'There is not enough detail in the text to confirm or refute it.' : 'Only the text itself could be assessed.', 'neutral');
  if (reasons.length < 3) push('No independent confirmation', 'The claim was not matched against live reporting in this mode.', 'neutral');
  return reasons.slice(0, 5);
}

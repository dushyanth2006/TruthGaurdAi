// Demo-mode helpers shared by the Express server and the browser fallback.
// Everything here is clearly labelled as demo data in the UI.

const STOP = new Set(
  ('a an the and or but if of to in on at for with by from is are was were be been being this that these those it its as into ' +
    'about over after before than then there their they them he she his her we you your our not no yes will would can could ' +
    'should may might has have had do does did just also more most very new says said say news breaking report reports ' +
    'according claim claims people what when where which while who whom why how all any some such only own same so too ' +
    'now next last first year years month months week weeks today tomorrow share before deleted know want dont ' +
    'shocking miracle urgent viral exposed secret unbelievable amazing breaking forward').split(' '),
);

/** Pick the most important keywords of a claim, preserving technical standards and entities. */
export function extractKeywords(text, n = 5) {
  // 1. Technical codes, standards, and capitalized acronyms (BS-VI, BS6, PM2.5, AQI, WHO, NASA, etc.)
  const technical = (text.match(/\b(?:BS-[IVX0-9]+|BS\d+|PM\d*(?:\.\d+)?|AQI|COVID(?:-19)?)\b/gi) || [])
    .concat(text.match(/\b[A-Z]{2,}\b/g) || [])
    .map((s) => s.toLowerCase())
    .filter((s) => !STOP.has(s));

  // 2. Multi-word proper names (e.g. "Supreme Court", "Air Quality")
  const entities = (text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [])
    .map((s) => s.toLowerCase())
    .filter((s) => !s.split(/\s+/).every((w) => STOP.has(w)));

  // 3. Regular single words (min 3 chars, not in STOP)
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));

  const counts = new Map();
  for (const t of technical) counts.set(t, (counts.get(t) || 0) + 5);
  for (const e of entities) counts.set(e, (counts.get(e) || 0) + 3);
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, n)
    .map(([w]) => w);
}

const CATEGORIES = [
  ['Politics', /elect|vote|parliament|minister|president|government|senate|policy|law/i],
  ['Business', /market|stock|econom|bank|trade|inflation|company|oil|price/i],
  ['Technology', /tech|\bai\b|software|chip|cyber|robot|phone|internet|space/i],
  ['Health', /health|vaccin|virus|disease|hospital|medic|cure|cancer|who\b/i],
  ['Climate', /climate|flood|storm|heat|wildfire|emission|weather|earthquake/i],
  ['Science', /scien|research|study|nasa|planet|discover/i],
  ['Sports', /match|league|cup|olympic|tournament|player|coach/i],
];
export const categoryOf = (text = '') => (CATEGORIES.find(([, re]) => re.test(text)) || ['World'])[0];

const FAKE_CUES = ['shocking', 'miracle', 'secret', "they don't want", 'share before', 'banned', '100%', 'cure', 'hoax', 'exposed', "you won't believe", 'urgent', 'forward this', 'deleted', 'mainstream media'];
const REAL_CUES = ['according to', 'reported', 'study', 'published', 'official', 'ministry', 'university', 'percent', 'data', 'statement', 'spokesperson', 'confirmed'];

/** Evidence-aware heuristic used when live AI is unavailable or as a calibrated fallback. */
export function mockAnalyze(text, evidence = []) {
  const t = text.toLowerCase();
  const fake = FAKE_CUES.filter((c) => t.includes(c));
  const real = REAL_CUES.filter((c) => t.includes(c));
  const exclaim = (text.match(/!/g) || []).length;
  const caps = (text.match(/\b[A-Z]{4,}\b/g) || []).length;
  const score = real.length * 2 - fake.length * 2 - Math.min(exclaim, 3) - Math.min(caps, 3);
  const kw = extractKeywords(text, 5);

  const supporting = Array.isArray(evidence) ? evidence.filter((e) => e.status === 'SUPPORTS') : [];
  const contradicting = Array.isArray(evidence) ? evidence.filter((e) => e.status === 'CONTRADICTS') : [];

  // Group supporting articles by UNIQUE publisher to avoid counting multiple articles from one publisher as independent sources
  const uniqueSupportingPublishers = [...new Set(supporting.map((e) => e.publisher || e.source).filter(Boolean))];
  const uniqueContradictingPublishers = [...new Set(contradicting.map((e) => e.publisher || e.source).filter(Boolean))];

  let verdict;
  let confidence;
  let summary;

  if (uniqueContradictingPublishers.length > 0) {
    verdict = 'Fake';
    confidence = Math.min(90, 75 + uniqueContradictingPublishers.length * 5);
    summary = `Directly contradicted by news reporting from ${uniqueContradictingPublishers.join(', ')}.`;
  } else if (uniqueSupportingPublishers.length > 0) {
    verdict = 'Real';
    const pubCount = uniqueSupportingPublishers.length;
    // Calibrated confidence based strictly on DISTINCT publisher diversity:
    // 1 publisher = 70-74%
    // 2 publishers = 78-82%
    // 3+ publishers = 85-88%
    const baseConf = pubCount >= 3 ? 84 : pubCount === 2 ? 78 : 70;
    const relBonus = supporting[0]?.relevance ? Math.round(supporting[0].relevance * 0.04) : 2;
    confidence = Math.min(88, baseConf + relBonus);

    if (pubCount > 1) {
      summary = `Corroborated by ${pubCount} distinct news publishers: ${uniqueSupportingPublishers.slice(0, 3).join(', ')}.`;
    } else {
      summary = `Supported by coverage from ${uniqueSupportingPublishers[0]}, though cross-publisher corroboration from other distinct outlets is limited in available feeds.`;
    }
  } else {
    // No direct evidence matches: without evidence, claim must remain UNVERIFIED.
    // Sensational or attribution cues are reflected in keySignals and confidence, but never force a FAKE or REAL verdict.
    verdict = 'Unverified';
    confidence = Math.max(35, Math.min(55, 50 - Math.min(Math.abs(score), 4) * 3));
    summary = 'Insufficient verified news reporting or official evidence was found to confirm or refute this specific claim. Cross-check with official sources before sharing.';
  }

  const keySignals = [
    ...(uniqueSupportingPublishers.length > 0 ? [`Corroborated by ${uniqueSupportingPublishers.length} distinct publisher(s): ${uniqueSupportingPublishers.join(', ')}`] : []),
    ...(uniqueContradictingPublishers.length > 0 ? [`Contradicted by ${uniqueContradictingPublishers.join(', ')}`] : []),
    ...fake.map((c) => `Sensational phrasing: "${c}"`),
    ...real.map((c) => `Attribution marker: "${c}"`),
    ...(exclaim > 1 ? [`Excessive punctuation (${exclaim} exclamation marks)`] : []),
    ...(caps ? [`${caps} ALL-CAPS word(s)`] : []),
  ];
  if (!keySignals.length) keySignals.push('Neutral tone with no overt sensational cues', 'Limited verifiable real-time coverage');

  return {
    verdict,
    confidence,
    summary,
    keySignals: keySignals.slice(0, 6),
    limitations: [
      'Demo mode: rule-based analysis, no live AI model was used.',
      supporting.length > 0
        ? `Evidence evaluated against ${supporting.length} live NewsAPI article(s).`
        : 'Facts were not corroborated against real-time sources.',
      'Satire, sarcasm and fast-breaking changes can alter context.',
    ],
    suggestedSearchTerms: kw.length
      ? [kw.slice(0, 3).join(' '), `${kw[0]} fact check`, `${kw.slice(0, 2).join(' ')} latest news`]
      : ['fact check', 'latest world news'],
  };
}

const gn = (q) => `https://news.google.com/search?q=${encodeURIComponent(q)}`;
const MOCK = [
  ['Global leaders meet for emergency climate summit as heatwaves spread across three continents', 'World Desk Daily', 'Climate'],
  ['Central banks signal pause on interest rate hikes as inflation cools in major economies', 'The Market Ledger', 'Business'],
  ['Health agencies roll out updated vaccine guidance ahead of winter season', 'Health Watch Today', 'Health'],
  ['Record turnout reported as voters head to the polls in closely watched national election', 'Global Politics Wire', 'Politics'],
  ['Researchers unveil energy-efficient AI chip that could cut data centre power use', 'TechPulse', 'Technology'],
  ['Relief efforts intensify after severe flooding displaces thousands in coastal region', 'World Desk Daily', 'Climate'],
  ['Space agency confirms next crewed lunar mission timeline after successful engine tests', 'Orbit Science News', 'Science'],
  ['Trade ministers reach tentative deal to ease shipping bottlenecks on key routes', 'The Market Ledger', 'Business'],
  ['Cybersecurity experts warn of rising deepfake scams targeting voters and investors', 'TechPulse', 'Technology'],
  ['International football tournament opens with record global audience', 'Sports Global', 'Sports'],
];

/** Realistic, clearly-labelled demo world news. */
export function mockNews() {
  const now = Date.now();
  return MOCK.map(([title, source, category], i) => ({
    title,
    source,
    category,
    url: gn(title.split(' ').slice(0, 6).join(' ')),
    image: null,
    publishedAt: new Date(now - (i * 47 + 18) * 60_000).toISOString(),
    description: '',
  }));
}

/** Demo "related news" for a claim: search links built from its keywords. */
export function mockRelated(keywords) {
  const q = keywords.slice(0, 3).join(' ') || 'news';
  const now = Date.now();
  return [
    { title: `Fact-checks about "${q}"`, source: 'Google Fact Check', url: `https://toolbox.google.com/factcheck/explorer/search/${encodeURIComponent(q)}` },
    { title: `Latest coverage: ${q}`, source: 'Google News', url: gn(q) },
    { title: `Wire reports mentioning ${keywords[0] || 'this topic'}`, source: 'Reuters search', url: `https://www.reuters.com/site-search/?query=${encodeURIComponent(q)}` },
  ].map((n, i) => ({ ...n, image: null, category: 'Fact-check', description: '', publishedAt: new Date(now - (i + 1) * 3_600_000).toISOString() }));
}

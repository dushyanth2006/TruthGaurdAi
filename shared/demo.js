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

/** Pick the most important keywords of a claim (simple frequency + length ranking). */
export function extractKeywords(text, n = 5) {
  const counts = new Map();
  for (const w of text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
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

/** Keyword heuristic used when GROQ_API_KEY is missing or the AI call fails. */
export function mockAnalyze(text) {
  const t = text.toLowerCase();
  const fake = FAKE_CUES.filter((c) => t.includes(c));
  const real = REAL_CUES.filter((c) => t.includes(c));
  const exclaim = (text.match(/!/g) || []).length;
  const caps = (text.match(/\b[A-Z]{4,}\b/g) || []).length;
  const score = real.length * 2 - fake.length * 2 - Math.min(exclaim, 3) - Math.min(caps, 3);
  const verdict = score <= -2 ? 'Fake' : score >= 2 ? 'Real' : 'Unverified';
  const kw = extractKeywords(text, 4);

  const keySignals = [
    ...fake.map((c) => `Sensational or manipulative phrase: "${c}"`),
    ...real.map((c) => `Attribution / sourcing language: "${c}"`),
    ...(exclaim > 1 ? [`Excessive punctuation (${exclaim} exclamation marks)`] : []),
    ...(caps ? [`${caps} ALL-CAPS word(s), common in clickbait`] : []),
  ];
  if (!keySignals.length) keySignals.push('Neutral tone with no strong sensational cues', 'No named source or verifiable attribution');

  return {
    verdict,
    confidence: Math.min(93, 56 + Math.abs(score) * 7),
    summary: {
      Fake: 'The text leans on emotionally charged, urgent language and offers no verifiable source, which are strong markers of misinformation.',
      Real: 'The text uses specific, attributed language that points to identifiable sources or data, which is typical of credible reporting.',
      Unverified: 'There is not enough evidence or attribution in the text to confirm or refute it. Cross-check with trusted outlets before sharing.',
    }[verdict],
    keySignals: keySignals.slice(0, 6),
    limitations: [
      'Demo mode: rule-based analysis, no live AI model was used.',
      'Facts were not checked against real-time sources.',
      'Satire, sarcasm and missing context can be misread.',
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

import { credibilityChecklist, ruleReasons } from '../../shared/checks.js';
import { extractKeywords, mockAnalyze, mockNews } from '../../shared/demo.js';
import type { AnalysisResult, CheckItem, NewsItem, Reason, Verdict } from './types';

export class ValidationError extends Error {}

const VERDICT: Record<string, Verdict> = { REAL: 'Real', FAKE: 'Fake', UNVERIFIED: 'Unverified' };

/** POST /api/analyze. Falls back to a labelled rule-based result if the API server is unreachable. */
export async function analyzeText(text: string): Promise<AnalysisResult> {
  let res: Response;
  try {
    res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  } catch {
    return localDemo(text, 'The backend API was unreachable (network error). Running in offline fallback mode.');
  }
  if (res.status === 400) throw new ValidationError((await res.json().catch(() => ({}))).error || 'Invalid input');
  if (!res.ok) {
    const errorNote = res.status === 404
      ? 'Backend API route /api/analyze returned 404 Not Found. Ensure Vercel serverless functions (api/index.js & vercel.json) are deployed.'
      : `Backend API request failed (HTTP ${res.status}). Running in local fallback mode.`;
    return localDemo(text, errorNote);
  }
  const data = await res.json();
  // The API uses REAL / FAKE / UNVERIFIED; the UI uses title case.
  return { ...data, verdict: VERDICT[String(data.verdict).toUpperCase()] ?? 'Unverified' } as AnalysisResult;
}

/** Offline fallback: no evidence is shown, because no NewsAPI response exists. */
export function localDemo(text: string, customLimitation?: string): AnalysisResult {
  const base = mockAnalyze(text) as { verdict: Verdict; confidence: number; summary: string; limitations: string[]; suggestedSearchTerms: string[] };
  const checklist = credibilityChecklist(text) as CheckItem[];
  return {
    verdict: base.verdict,
    confidence: base.confidence,
    summary: base.summary,
    reasons: ruleReasons(checklist, base.verdict) as Reason[],
    limitations: [...base.limitations, customLimitation || 'The API server was unreachable, so no live news evidence was checked.'],
    credibilityChecklist: checklist,
    evidence: [],
    earliestRelatedCoverage: null,
    suggestedSearchTerms: base.suggestedSearchTerms,
    keywords: extractKeywords(text, 5),
    demo: true,
    newsDemo: true,
  };
}

export async function fetchNews(): Promise<{ articles: NewsItem[]; demo: boolean }> {
  try {
    const r = await fetch('/api/news');
    if (!r.ok) throw new Error();
    return await r.json();
  } catch {
    return { articles: mockNews(), demo: true };
  }
}

export async function fetchHealth(): Promise<{ ai: boolean; news: boolean } | null> {
  try {
    return await (await fetch('/api/health')).json();
  } catch {
    return null;
  }
}

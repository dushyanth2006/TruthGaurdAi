export type Verdict = 'Real' | 'Fake' | 'Unverified';
export type InputSource = 'text' | 'voice' | 'image';

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  image?: string | null;
  publishedAt: string;
  category: string;
  description?: string;
}

/** Rule-based credibility check: green pass, amber warn, red fail, grey not-applicable. */
export type CheckState = 'pass' | 'warn' | 'fail' | 'na';
export interface CheckItem { id: string; label: string; state: CheckState; detail: string }

export interface Reason { title: string; detail: string; impact?: 'negative' | 'positive' | 'neutral' }

/** A source card — always an article actually returned by NewsAPI (validated server-side). */
export type EvidenceStatus = 'SUPPORTS' | 'CONTRADICTS' | 'CONTEXT';
export interface EvidenceSource { title: string; publisher: string; publishedAt: string; url: string; status: EvidenceStatus }
export interface EarliestCoverage { title: string; publisher: string; publishedAt: string; url: string; note: string }

export interface AnalysisResult {
  verdict: Verdict;
  confidence: number; // 0-100
  summary: string;
  reasons: Reason[];
  limitations: string[];
  credibilityChecklist: CheckItem[];
  evidence: EvidenceSource[];
  earliestRelatedCoverage: EarliestCoverage | null;
  suggestedSearchTerms: string[];
  keywords?: string[];
  assessmentType?: 'EVIDENCE_BACKED' | 'AI_KNOWLEDGE' | 'UNVERIFIED';
  demo: boolean; // verdict came from the rule-based demo, not Groq
  newsDemo: boolean; // no NewsAPI key → no live evidence
  newsError?: boolean; // NewsAPI request failed
  newsQuotaExceeded?: boolean; // NewsAPI 429 quota exhausted
  newsProviders?: string[]; // Names of active providers returning news (e.g. ['NewsAPI', 'FreeNewsAPI'])
  noRelevantCoverage?: boolean; // NewsAPI answered, but nothing passed the relevance threshold
  aiConfigured?: boolean;
  aiError?: boolean;
  aiModel?: string | null;
  fallbackReason?: string | null;
}

export interface Analysis extends AnalysisResult {
  id: string;
  title: string;
  text: string;
  source: InputSource;
  createdAt: number;
}

export interface User {
  name: string;
  email: string;
  provider: 'local' | 'google' | 'facebook';
  passHash?: string; // local demo only: SHA-256, never sent anywhere
}

export interface Settings {
  reduceMotion: boolean;
  sidebarCollapsed: boolean;
}

/** Full snapshot stored when the user clicks "Save report" (LocalStorage only). */
export interface SavedReport {
  id: string;
  analysisId: string;
  savedAt: number;
  title: string;
  text: string;
  verdict: Verdict;
  confidence: number;
  explanation: string;
  createdAt: number; // when the analysis ran
  reasons: Reason[];
  limitations: string[];
  credibilityChecklist: CheckItem[];
  evidence: EvidenceSource[];
  earliestRelatedCoverage: EarliestCoverage | null;
  suggestedSearchTerms: string[];
  demo: boolean;
  newsDemo: boolean;
}

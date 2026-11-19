import { credibilityChecklist } from '../../shared/checks.js';
import type { Analysis, CheckItem, SavedReport, Settings, User } from './types';
import { makeTitle } from './format';

const K = { users: 'tg_users', session: 'tg_session', remember: 'tg_remember', history: 'tg_history', settings: 'tg_settings', reports: 'tg_reports' };

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
};

/** Local-only hash so the demo never keeps a plain-text password. Not real security. */
export async function hashPassword(pw: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Upgrades entries saved by older versions of the app. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalize = (a: any): Analysis => {
  const legacy = !a.credibilityChecklist; // saved before reasons/checklist/evidence existed
  const { keySignals, signals, related, saved, explanation, ...rest } = a;
  void related; void saved;
  const oldSignals: string[] = keySignals ?? signals ?? [];
  return {
    ...rest,
    title: a.title ?? makeTitle(a.text ?? ''),
    summary: a.summary ?? explanation ?? '',
    reasons: a.reasons ?? oldSignals.slice(0, 5).map((s) => ({ title: 'Signal', detail: s })),
    limitations: [...(a.limitations ?? []), ...(legacy ? ['Saved by an earlier version — no verified evidence sources were stored.'] : [])],
    credibilityChecklist: a.credibilityChecklist ?? (credibilityChecklist(a.text ?? '') as CheckItem[]),
    // Old "related" links were never validated against NewsAPI, so they are not shown as evidence.
    evidence: a.evidence ?? [],
    earliestRelatedCoverage: a.earliestRelatedCoverage ?? null,
    suggestedSearchTerms: a.suggestedSearchTerms ?? [],
    source: a.source ?? 'text',
    demo: a.demo ?? true,
    newsDemo: a.newsDemo ?? true,
  };
};

/** Saved reports from older versions only had title/verdict/explanation — fill in the rest. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalizeReport = (r: any): SavedReport => {
  const a = normalize({ ...r, summary: r.explanation, id: r.analysisId });
  return { ...r, reasons: a.reasons, limitations: a.limitations, credibilityChecklist: a.credibilityChecklist, evidence: a.evidence, earliestRelatedCoverage: a.earliestRelatedCoverage, suggestedSearchTerms: a.suggestedSearchTerms, demo: a.demo, newsDemo: a.newsDemo };
};

export const store = {
  users: () => read<User[]>(K.users, []),
  findUser: (email: string) => store.users().find((u) => u.email.toLowerCase() === email.toLowerCase()),
  saveUser(user: User) {
    write(K.users, [...store.users().filter((u) => u.email.toLowerCase() !== user.email.toLowerCase()), user]);
  },
  session: () => read<User | null>(K.session, null),
  setSession: (u: User | null) => (u ? write(K.session, { ...u, passHash: undefined }) : localStorage.removeItem(K.session)),
  remembered: () => read<string>(K.remember, ''),
  setRemembered: (email: string) => (email ? write(K.remember, email) : localStorage.removeItem(K.remember)),
  history: (email: string) => read<unknown[]>(`${K.history}_${email}`, []).map(normalize),
  setHistory: (email: string, list: Analysis[]) => write(`${K.history}_${email}`, list),
  reports: (email: string) => read<unknown[]>(`${K.reports}_${email}`, []).map(normalizeReport),
  setReports: (email: string, list: SavedReport[]) => write(`${K.reports}_${email}`, list),
  settings: () => ({ reduceMotion: false, sidebarCollapsed: false, ...read<Partial<Settings>>(K.settings, {}) }),
  setSettings: (s: Settings) => write(K.settings, s),
};

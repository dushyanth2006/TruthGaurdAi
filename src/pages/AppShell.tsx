import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu } from 'lucide-react';
import Analyzer from '../components/Analyzer';
import HistoryList from '../components/HistoryList';
import NewsPanel from '../components/NewsPanel';
import Result from '../components/Result';
import Sidebar, { type View } from '../components/Sidebar';
import { Logo, pageV, useToast } from '../components/ui';
import { fetchNews } from '../lib/api';
import { greeting } from '../lib/format';
import { store } from '../lib/storage';
import type { Analysis, NewsItem, SavedReport, Settings as S, User } from '../lib/types';
import Dashboard from './Dashboard';
import Reports from './Reports';
import SettingsPage from './Settings';

/** Each page gets a fixed, centred max width so toggling the sidebar never shifts it oddly. */
const WIDTH: Record<View, string> = {
  analyze: 'max-w-[1200px]',
  dashboard: 'max-w-5xl',
  history: 'max-w-5xl',
  saved: 'max-w-5xl',
  settings: 'max-w-2xl',
};
const HEADINGS: Partial<Record<View, [string, string]>> = {
  history: ['Analysis History', 'Every claim you have checked, newest first.'],
  saved: ['Saved Reports', 'Snapshots of results you chose to keep.'],
  settings: ['Settings', 'Profile, appearance and service status.'],
};

const snapshot = (a: Analysis): SavedReport => ({
  id: crypto.randomUUID(),
  analysisId: a.id,
  title: a.title,
  text: a.text,
  verdict: a.verdict,
  confidence: a.confidence,
  explanation: a.summary,
  createdAt: a.createdAt,
  savedAt: Date.now(),
  // Full snapshot: reasons, checklist, evidence, earliest coverage, limitations.
  reasons: a.reasons,
  limitations: a.limitations,
  credibilityChecklist: a.credibilityChecklist,
  evidence: a.evidence,
  earliestRelatedCoverage: a.earliestRelatedCoverage,
  suggestedSearchTerms: a.suggestedSearchTerms,
  demo: a.demo,
  newsDemo: a.newsDemo,
});

interface Props { user: User; settings: S; onSettings: (s: S) => void; onUser: (u: User) => void; onLogout: () => void }

export default function AppShell({ user, settings, onSettings, onUser, onLogout }: Props) {
  const toast = useToast();
  const mainRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<View>('analyze');
  const [history, setHistory] = useState<Analysis[]>(() => store.history(user.email));
  const [reports, setReports] = useState<SavedReport[]>(() => {
    const saved = store.reports(user.email);
    // One-time migration of reports bookmarked in the previous version.
    return saved.length ? saved : store.history(user.email).filter((a) => (a as Analysis & { saved?: boolean }).saved).map(snapshot);
  });
  const [current, setCurrent] = useState<Analysis | null>(null);
  const [analyzerKey, setAnalyzerKey] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [newsDemo, setNewsDemo] = useState(false);

  useEffect(() => store.setHistory(user.email, history), [history, user.email]);
  useEffect(() => store.setReports(user.email, reports), [reports, user.email]);

  const loadNews = useCallback(() => {
    setNews(null);
    fetchNews().then((r) => { setNews(r.articles.slice(0, 5)); setNewsDemo(r.demo); });
  }, []);
  useEffect(loadNews, [loadNews]);

  const savedIds = useMemo(() => new Set(reports.map((r) => r.analysisId)), [reports]);
  const scrollTo = (id?: string) =>
    setTimeout(() => (id ? document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : mainRef.current?.scrollTo({ top: 0 })), 80);

  const go = (v: View) => { setView(v); setMobileOpen(false); scrollTo(); };
  const newAnalysis = () => { setCurrent(null); setAnalyzerKey((k) => k + 1); go('analyze'); };
  const open = (a: Analysis) => { setCurrent(a); setView('analyze'); setMobileOpen(false); scrollTo('result'); };
  const add = (a: Analysis) => { setHistory((h) => [a, ...h]); setCurrent(a); scrollTo('result'); };
  const remove = (id: string) => { setHistory((h) => h.filter((a) => a.id !== id)); if (current?.id === id) setCurrent(null); toast('Analysis deleted', 'info'); };
  const saveReport = (a: Analysis) => {
    if (savedIds.has(a.id)) return toast('This report is already in Saved Reports', 'info');
    setReports((r) => [snapshot(a), ...r]);
    toast('Report saved to Saved Reports', 'saved');
  };
  const deleteReport = (id: string) => { setReports((r) => r.filter((x) => x.id !== id)); toast('Saved report deleted', 'info'); };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        user={user} view={view} history={history} activeId={current?.id}
        collapsed={settings.sidebarCollapsed} mobileOpen={mobileOpen}
        onToggleCollapse={() => onSettings({ ...settings, sidebarCollapsed: !settings.sidebarCollapsed })}
        onCloseMobile={() => setMobileOpen(false)}
        onNav={go} onNew={newAnalysis} onOpen={open} onLogout={onLogout}
      />

      <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* Mobile / tablet top bar */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b glass-bar px-4 py-2.5 lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-muted hover:bg-line/[0.06] hover:text-fg" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <Logo />
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={view} variants={pageV} initial="hidden" animate="show" exit="exit" className={`mx-auto w-full ${WIDTH[view]} px-4 py-8 sm:px-6 lg:px-10 lg:py-10`}>
            {HEADINGS[view] && (
              <header className="mb-8">
                <h1 className="font-display text-4xl tracking-tight">{HEADINGS[view]![0]}</h1>
                <p className="mt-1 text-sm text-muted">{HEADINGS[view]![1]}</p>
              </header>
            )}

            {view === 'analyze' && (
              <div className="isolate grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="relative min-w-0 space-y-6">
                  <div className="glow glow-analyzer" aria-hidden="true" />
                  <header>
                    <p className="label">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                    <h1 className="mt-1 font-display text-4xl tracking-tight">{greeting()}, {user.name.split(' ')[0]}.</h1>
                    <p className="mt-1 text-sm text-muted">Paste, speak or upload a claim and we'll weigh the evidence.</p>
                  </header>
                  <Analyzer key={analyzerKey} onResult={add} />
                  <AnimatePresence mode="wait">
                    {current && <Result key={current.id} a={current} saved={savedIds.has(current.id)} onSave={() => saveReport(current)} />}
                  </AnimatePresence>
                </div>
                {/* Floating on desktop; stacks below the content on smaller screens */}
                <aside className="relative xl:sticky xl:top-10 xl:flex xl:max-h-[calc(100vh-5rem)] xl:self-start xl:flex-col">
                  <div className="glow glow-news" aria-hidden="true" />
                  <NewsPanel news={news} demo={newsDemo} onRefresh={loadNews} />
                </aside>
              </div>
            )}
            {view === 'dashboard' && <Dashboard user={user} history={history} reportCount={reports.length} onOpen={open} onNew={newAnalysis} onNav={go} />}
            {view === 'history' && <HistoryList items={history} onOpen={open} onDelete={remove} />}
            {view === 'saved' && (
              <Reports
                reports={reports} onDelete={deleteReport}
                onOpenAnalysis={(id) => { const a = history.find((x) => x.id === id); if (a) open(a); else toast('The original analysis was deleted — the snapshot is all that remains.', 'info'); }}
              />
            )}
            {view === 'settings' && (
              <SettingsPage
                user={user} settings={settings} historyCount={history.length} onSettings={onSettings}
                onRename={(name) => onUser({ ...user, name })}
                onClearHistory={() => { setHistory([]); setCurrent(null); toast('History cleared', 'info'); }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

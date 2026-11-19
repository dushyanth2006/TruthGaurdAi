import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, FileSearch, Search, Trash2 } from 'lucide-react';
import Result, { VerdictPill } from '../components/Result';
import { Button, ease, pageV, useToast } from '../components/ui';
import { timeAgo } from '../lib/format';
import type { Analysis, SavedReport } from '../lib/types';

interface Props { reports: SavedReport[]; onDelete: (id: string) => void; onOpenAnalysis: (analysisId: string) => void }

/** A saved snapshot rendered through the same Result view (download works from the snapshot alone). */
export const reportToAnalysis = (r: SavedReport): Analysis => ({
  id: r.analysisId,
  title: r.title,
  text: r.text,
  source: 'text',
  createdAt: r.createdAt,
  verdict: r.verdict,
  confidence: r.confidence,
  summary: r.explanation,
  reasons: r.reasons,
  limitations: r.limitations,
  credibilityChecklist: r.credibilityChecklist,
  evidence: r.evidence,
  earliestRelatedCoverage: r.earliestRelatedCoverage,
  suggestedSearchTerms: r.suggestedSearchTerms,
  demo: r.demo,
  newsDemo: r.newsDemo,
});

function Detail({ r, onBack, onDelete, onOpenAnalysis }: { r: SavedReport; onBack: () => void; onDelete: () => void; onOpenAnalysis: () => void }) {
  const toast = useToast();
  return (
    <motion.div variants={pageV} initial="hidden" animate="show" exit="exit" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> All saved reports</button>
        <p className="text-xs text-faint">Analysed {new Date(r.createdAt).toLocaleString()} · saved {timeAgo(r.savedAt)}</p>
      </div>
      <Result
        a={reportToAnalysis(r)}
        saved
        onSave={() => toast('This report is already in Saved Reports', 'info')}
        extraActions={
          <>
            <Button variant="ghost" onClick={onOpenAnalysis} className="h-9 py-0 text-xs"><FileSearch className="h-4 w-4" /> Open original analysis</Button>
            <Button variant="danger" onClick={onDelete} className="h-9 py-0 text-xs"><Trash2 className="h-4 w-4" /> Delete report</Button>
          </>
        }
      />
    </motion.div>
  );
}

export default function Reports({ reports, onDelete, onOpenAnalysis }: Props) {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useMemo(() => {
    const s = q.toLowerCase();
    return reports.filter((r) => [r.title, r.text, r.verdict, r.explanation, ...r.evidence.map((e) => e.publisher)].some((f) => f?.toLowerCase().includes(s)));
  }, [reports, q]);
  const opened = reports.find((r) => r.id === openId);

  return (
    <AnimatePresence mode="wait">
      {opened ? (
        <Detail key="detail" r={opened} onBack={() => setOpenId(null)} onDelete={() => { onDelete(opened.id); setOpenId(null); }} onOpenAnalysis={() => onOpenAnalysis(opened.analysisId)} />
      ) : (
        <motion.div key="list" variants={pageV} initial="hidden" animate="show" exit="exit" className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search saved reports" className="input pl-10" />
          </div>
          {!list.length && (
            <div className="panel py-16 text-center text-sm text-faint">
              {reports.length ? 'No reports match your search.' : 'No saved reports yet. Use “Save report” on any result.'}
            </div>
          )}
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {list.map((r, i) => (
                <motion.div
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.2, delay: Math.min(i, 8) * 0.03, ease } }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  className="panel group flex items-center gap-4 p-4 transition-colors hover:border-line/[0.12]"
                >
                  <button onClick={() => setOpenId(r.id)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
                    <VerdictPill v={r.verdict} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.title}</p>
                      <p className="mt-0.5 text-xs text-faint">{r.confidence}% confidence · saved {timeAgo(r.savedAt)}</p>
                    </div>
                  </button>
                  <Button variant="ghost" onClick={() => setOpenId(r.id)} className="px-3 py-1.5 text-xs">Open</Button>
                  <button onClick={() => onDelete(r.id)} aria-label="Delete report" className="rounded-lg p-2 text-faint transition-colors hover:bg-coral/10 hover:text-coral">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

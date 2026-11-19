import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FileText, ImageUp, Mic, Search, Trash2 } from 'lucide-react';
import { timeAgo } from '../lib/format';
import type { Analysis, Verdict } from '../lib/types';
import { VerdictPill } from './Result';
import { ease } from './ui';

const FILTERS: ('All' | Verdict)[] = ['All', 'Real', 'Fake', 'Unverified'];
const SRC = { text: FileText, voice: Mic, image: ImageUp };

interface Props { items: Analysis[]; onOpen: (a: Analysis) => void; onDelete: (id: string) => void }

export default function HistoryList({ items, onOpen, onDelete }: Props) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const list = useMemo(
    () => items.filter((a) => (filter === 'All' || a.verdict === filter) && a.text.toLowerCase().includes(q.toLowerCase())),
    [items, q, filter],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search analyses" className="input pl-10" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`ctl ${filter === f ? 'ctl-active' : ''}`}>
              <span className="relative">{f}</span>
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 && (
        <div className="panel py-16 text-center text-sm text-faint">{items.length ? 'No matching analyses.' : 'No analyses yet. Start one from New Analysis.'}</div>
      )}

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {list.map((a, i) => {
            const Src = SRC[a.source];
            return (
              <motion.div
                key={a.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.2, delay: Math.min(i, 8) * 0.03, ease } }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                onClick={() => onOpen(a)}
                className="panel group flex cursor-pointer items-start gap-4 p-4 transition-colors hover:border-line/[0.12]"
              >
                <VerdictPill v={a.verdict} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-faint">{a.summary}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-faint">
                  <Src className="h-3.5 w-3.5" /> {a.confidence}% · {timeAgo(a.createdAt)}
                  <button onClick={(e) => { e.stopPropagation(); onDelete(a.id); }} aria-label="Delete analysis" className="rounded-lg p-1.5 hover:bg-coral/10 hover:text-coral">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

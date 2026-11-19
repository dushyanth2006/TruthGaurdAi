import { motion } from 'framer-motion';
import { ArrowRight, Bookmark, CheckCircle2, HelpCircle, ListChecks, Plus, XCircle } from 'lucide-react';
import { VerdictPill } from '../components/Result';
import type { View } from '../components/Sidebar';
import { Button, Card, ease, itemV, listV } from '../components/ui';
import { timeAgo } from '../lib/format';
import type { Analysis, User } from '../lib/types';

interface Props { user: User; history: Analysis[]; reportCount: number; onOpen: (a: Analysis) => void; onNew: () => void; onNav: (v: View) => void }

export default function Dashboard({ user, history, reportCount, onOpen, onNew, onNav }: Props) {
  const count = (v: string) => history.filter((a) => a.verdict === v).length;
  const total = history.length;
  const stats = [
    { label: 'Total checks', n: total, Icon: ListChecks, tone: 'text-fg', bar: 'bg-fg' },
    { label: 'Likely real', n: count('Real'), Icon: CheckCircle2, tone: 'text-ok', bar: 'bg-ok' },
    { label: 'Likely fake', n: count('Fake'), Icon: XCircle, tone: 'text-coral', bar: 'bg-coral' },
    { label: 'Unverified', n: count('Unverified'), Icon: HelpCircle, tone: 'text-amber', bar: 'bg-amber' },
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">An overview of {user.name.split(' ')[0]}'s fact-checking activity.</p>
        </div>
        <Button variant="accent" onClick={onNew}><Plus className="h-4 w-4" /> New analysis</Button>
      </header>

      <motion.div variants={listV} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map(({ label, n, Icon, tone }) => (
          <Card key={label} hover className="p-5">
            <div className="flex items-center justify-between text-xs text-muted">{label}<Icon className={`h-4 w-4 ${tone}`} /></div>
            <div className={`mt-3 font-display text-5xl leading-none ${tone}`}>{n}</div>
          </Card>
        ))}
      </motion.div>

      <div className="panel p-5">
        <div className="mb-3 flex items-center justify-between text-xs text-muted">
          <span>Verdict breakdown</span>
          <button onClick={() => onNav('saved')} className="flex items-center gap-1.5 hover:text-fg"><Bookmark className="h-3.5 w-3.5" /> {reportCount} saved reports</button>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-line/[0.05]">
          {total > 0 && stats.slice(1).map(({ label, n, bar }) => (
            <motion.div key={label} className={bar} initial={{ width: 0 }} animate={{ width: `${(n / total) * 100}%` }} transition={{ duration: 0.5, ease }} />
          ))}
        </div>
        {total === 0 && <p className="mt-3 text-xs text-faint">No data yet — run your first analysis.</p>}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label">Recent analyses</h2>
          {total > 5 && <button onClick={() => onNav('history')} className="flex items-center gap-1 text-xs text-muted hover:text-fg">View all <ArrowRight className="h-3.5 w-3.5" /></button>}
        </div>
        <motion.div variants={listV} initial="hidden" animate="show" className="panel divide-y divide-line/[0.05] overflow-hidden">
          {history.slice(0, 5).map((a) => (
            <motion.button key={a.id} variants={itemV} onClick={() => onOpen(a)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-line/[0.03]">
              <VerdictPill v={a.verdict} />
              <span className="min-w-0 flex-1 truncate text-sm">{a.title}</span>
              <span className="shrink-0 text-xs text-faint">{timeAgo(a.createdAt)}</span>
            </motion.button>
          ))}
          {!total && <p className="px-5 py-10 text-center text-sm text-faint">Nothing here yet.</p>}
        </motion.div>
      </div>
    </div>
  );
}

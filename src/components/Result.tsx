import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle, Bookmark, BookmarkCheck, CheckCircle2, Clock, ExternalLink, FileDown, HelpCircle, Info,
  Loader2, MinusCircle, Newspaper, Scale, Search, ShieldCheck, XCircle,
} from 'lucide-react';
import type { Analysis, CheckState, EvidenceStatus, Verdict } from '../lib/types';
import { DemoBadge, ease, itemV, listV, useToast } from './ui';

export const VERDICT: Record<Verdict, { color: string; pill: string; Icon: typeof CheckCircle2; hex: string; label: string }> = {
  Real: { color: 'text-ok', pill: 'cat-green', Icon: CheckCircle2, hex: '#059669', label: 'Likely real' },
  Fake: { color: 'text-coral', pill: 'cat-red', Icon: XCircle, hex: '#DC4A3D', label: 'Likely fake' },
  Unverified: { color: 'text-amber', pill: 'cat-amber', Icon: HelpCircle, hex: '#D97706', label: 'Unverified' },
};

export function VerdictPill({ v }: { v: Verdict }) {
  const { pill, Icon } = VERDICT[v];
  return <span className={`cat gap-1 px-2.5 text-[11px] ${pill}`}><Icon className="h-3 w-3" /> {v}</span>;
}

export function Ring({ value, hex }: { value: number; hex: string }) {
  const r = 44, c = 2 * Math.PI * r;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} stroke="rgba(16,42,67,.08)" strokeWidth="5" fill="none" />
        <motion.circle cx="50" cy="50" r={r} stroke={hex} strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - value / 100) }} transition={{ duration: 0.7, ease, delay: 0.1 }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-display text-3xl leading-none">{Math.round(value)}<span className="text-lg text-muted">%</span></div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.14em] text-faint">confidence</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- small helpers ---------- */
export const fmtDate = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 'Date unknown' : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const shortUrl = (u: string) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname : ''); } catch { return u; } };

const CHECK: Record<CheckState, { Icon: typeof CheckCircle2; tone: string; label: string }> = {
  pass: { Icon: CheckCircle2, tone: 'text-ok', label: 'OK' },
  warn: { Icon: AlertTriangle, tone: 'text-amber', label: 'Warning' },
  fail: { Icon: XCircle, tone: 'text-coral', label: 'Issue' },
  na: { Icon: MinusCircle, tone: 'text-faint', label: 'N/A' },
};
const STATUS: Record<EvidenceStatus, { cls: string; label: string }> = {
  SUPPORTS: { cls: 'cat-green', label: 'Supports' },
  CONTRADICTS: { cls: 'cat-red', label: 'Contradicts' },
  CONTEXT: { cls: 'cat-info', label: 'Context' },
};
const IMPACT = {
  negative: { Icon: AlertTriangle, tone: 'text-coral bg-coral/[0.07]' },
  positive: { Icon: CheckCircle2, tone: 'text-ok bg-ok/[0.08]' },
  neutral: { Icon: Info, tone: 'text-accent bg-accent/[0.08]' },
};

function Section({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <motion.section variants={itemV} className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-fg">{icon}{title}</h4>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      {children}
    </motion.section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <div className="flex items-start gap-2 rounded-2xl border border-dashed border-line/15 bg-white/40 p-4 text-sm text-muted">
    <Info className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
    <p>{children}</p>
  </div>
);

interface Props { a: Analysis; saved: boolean; onSave: () => void; extraActions?: ReactNode }

export default function Result({ a, saved, onSave, extraActions }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const v = VERDICT[a.verdict];

  async function download() {
    setBusy(true);
    try {
      const { downloadReportPdf } = await import('../lib/pdf');
      await downloadReportPdf(a);
      toast('PDF report downloaded');
    } catch {
      toast('Could not create the PDF. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const evidenceEmpty = a.newsDemo
    ? 'Demo Mode: NewsAPI is not configured, so no live sources were checked. Add NEWS_API_KEY to the server’s .env file to see real evidence.'
    : a.newsError
      ? 'NewsAPI could not be reached, so no sources are shown. Try again later.'
      : 'No sufficiently relevant matching coverage found.';

  return (
    <motion.article id="result" variants={listV} initial="hidden" animate="show" exit={{ opacity: 0, transition: { duration: 0.15 } }} className="panel scroll-mt-20 space-y-8 p-5 sm:p-7">
      {/* ---- Verdict ---- */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }} className="space-y-4">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <Ring value={a.confidence} hex={v.hex} />
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.08 }}>
                <v.Icon className={`h-6 w-6 ${v.color}`} />
              </motion.span>
              <h3 className={`font-display text-3xl ${v.color}`}>{v.label}</h3>
              {a.demo ? <DemoBadge label="Demo AI" /> : <span className="chip border-line/10 text-muted">Groq AI</span>}
              {a.newsDemo ? <DemoBadge label="Demo News" /> : <span className="chip border-line/10 text-muted">NewsAPI</span>}
            </div>
            <p className="line-clamp-2 font-display text-base italic text-muted">“{a.text}”</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line/[0.06] pt-4">
          <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} onClick={onSave} aria-pressed={saved}
            className={`ctl h-9 py-0 ${saved ? 'ctl-active' : ''}`}>
            {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />} {saved ? 'Saved' : 'Save report'}
          </motion.button>
          <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} onClick={download} disabled={busy} className="ctl h-9 py-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Download report
          </motion.button>
          {extraActions}
        </div>
      </motion.div>

      {/* ---- 1. Why this verdict? ---- */}
      <Section icon={<Scale className="h-4 w-4 text-accent" />} title="Why this verdict?">
        <p className="text-[15px] leading-relaxed text-fg">{a.summary}</p>
        <div className="grid gap-3 md:grid-cols-2">
          {a.reasons.map((r, i) => {
            const im = IMPACT[r.impact ?? 'neutral'];
            return (
              <div key={i} className="flex gap-3 rounded-2xl border border-white/70 bg-white/50 p-4">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${im.tone}`}><im.Icon className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">{r.title}</p>
                  <p className="mt-1 text-sm leading-snug text-muted">{r.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
        {a.limitations.length > 0 && (
          <div className="rounded-2xl border border-amber/20 bg-amber/[0.05] p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber"><AlertTriangle className="h-4 w-4" /> Limitations & uncertainty</p>
            <ul className="space-y-1.5 text-sm text-muted">
              {a.limitations.map((l, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-faint" />{l}</li>)}
            </ul>
          </div>
        )}
      </Section>

      {/* ---- 2. Credibility checklist ---- */}
      <Section icon={<ShieldCheck className="h-4 w-4 text-accent" />} title="Credibility checklist" hint="Rule-based checks on the text">
        <ul className="divide-y divide-line/[0.06] overflow-hidden rounded-2xl border border-white/70 bg-white/50">
          {a.credibilityChecklist.map((c) => {
            const s = CHECK[c.state];
            return (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                <s.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${s.tone}`} aria-label={s.label} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{c.label}</p>
                  <p className="text-xs text-muted">{c.detail}</p>
                </div>
                <span className={`shrink-0 text-[11px] font-semibold ${s.tone}`}>{s.label}</span>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* ---- 3. Evidence & Sources (NewsAPI only) ---- */}
      <Section icon={<Newspaper className="h-4 w-4 text-accent" />} title="Evidence & Sources" hint="Relevant NewsAPI articles only, verified by the server">
        {a.evidence.length === 0 ? <Empty>{evidenceEmpty}</Empty> : (
          <div className="space-y-2">
            {a.evidence.map((e) => (
              <a key={e.url} href={e.url} target="_blank" rel="noopener noreferrer"
                className="group block rounded-2xl border border-white/70 bg-white/50 p-4 transition-colors hover:bg-white/80">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold leading-snug text-fg group-hover:underline group-hover:decoration-line/20">{e.title}</p>
                  <span className={`cat ${STATUS[e.status].cls}`}>{STATUS[e.status].label}</span>
                </div>
                <p className="mt-1.5 text-xs text-muted">{e.publisher} · {fmtDate(e.publishedAt)}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-accent"><ExternalLink className="h-3 w-3 shrink-0" /><span className="truncate">{shortUrl(e.url)}</span></p>
              </a>
            ))}
          </div>
        )}
      </Section>

      {/* ---- 4. Earliest related coverage ---- */}
      <Section icon={<Clock className="h-4 w-4 text-accent" />} title="Earliest Related Coverage">
        {a.earliestRelatedCoverage ? (
          <a href={a.earliestRelatedCoverage.url} target="_blank" rel="noopener noreferrer" className="group block rounded-2xl border border-white/70 bg-white/50 p-4 transition-colors hover:bg-white/80">
            <p className="text-xs font-semibold text-accent">{a.earliestRelatedCoverage.note}</p>
            <p className="mt-1 text-sm font-semibold text-fg group-hover:underline group-hover:decoration-line/20">{a.earliestRelatedCoverage.title}</p>
            <p className="mt-1.5 text-xs text-muted">{a.earliestRelatedCoverage.publisher} · {fmtDate(a.earliestRelatedCoverage.publishedAt)}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-accent"><ExternalLink className="h-3 w-3 shrink-0" /><span className="truncate">{shortUrl(a.earliestRelatedCoverage.url)}</span></p>
            <p className="mt-2 text-[11px] text-faint">This is the earliest matching article NewsAPI returned — not necessarily the original source.</p>
          </a>
        ) : <Empty>{a.newsDemo || a.newsError ? evidenceEmpty : 'No sufficiently relevant matching coverage found, so the earliest coverage can’t be determined.'}</Empty>}
      </Section>

      {a.suggestedSearchTerms.length > 0 && (
        <Section icon={<Search className="h-4 w-4 text-accent" />} title="Check it yourself">
          <div className="flex flex-wrap gap-2">
            {a.suggestedSearchTerms.map((t) => (
              <a key={t} href={`https://news.google.com/search?q=${encodeURIComponent(t)}`} target="_blank" rel="noopener noreferrer" className="ctl rounded-full">{t}</a>
            ))}
          </div>
        </Section>
      )}

      <motion.p variants={itemV} className="text-xs text-faint">AI analysis can be wrong. Verify important claims with trusted sources.</motion.p>
    </motion.article>
  );
}

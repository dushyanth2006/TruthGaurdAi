import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, History, LayoutGrid, LogOut, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, X } from 'lucide-react';
import { isToday } from '../lib/format';
import type { Analysis, User } from '../lib/types';
import { ease, Logo } from './ui';

export type View = 'analyze' | 'dashboard' | 'history' | 'saved' | 'settings';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutGrid },
  { id: 'history', label: 'Analysis History', Icon: History },
  { id: 'saved', label: 'Saved Reports', Icon: Bookmark },
] as const;

const DOT = { Real: 'bg-ok', Fake: 'bg-coral', Unverified: 'bg-amber' };

interface Props {
  user: User;
  view: View;
  history: Analysis[];
  activeId?: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onNav: (v: View) => void;
  onNew: () => void;
  onOpen: (a: Analysis) => void;
  onLogout: () => void;
}

function SidebarContent({ compact, mobile, ...p }: Props & { compact: boolean; mobile?: boolean }) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const s = q.toLowerCase();
    const list = p.history.filter((a) => a.title.toLowerCase().includes(s) || a.text.toLowerCase().includes(s));
    return [
      { label: 'Today', items: list.filter((a) => isToday(a.createdAt)) },
      { label: 'Earlier', items: list.filter((a) => !isToday(a.createdAt)) },
    ].filter((g) => g.items.length);
  }, [p.history, q]);

  const row = (active: boolean) =>
    `relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${compact ? 'justify-center' : ''} ${active ? 'font-medium text-accent' : 'text-muted hover:bg-line/[0.04] hover:text-fg'}`;
  const pill = (
    <motion.span layoutId={mobile ? 'nav-m' : 'nav-d'} transition={{ duration: 0.2, ease }} className="absolute inset-0 rounded-lg bg-accent-soft" />
  );
  const initials = p.user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className={`flex items-center ${compact ? 'flex-col gap-3' : 'justify-between'} px-1 pt-1`}>
        <Logo small={compact} />
        <button
          onClick={mobile ? p.onCloseMobile : p.onToggleCollapse}
          title={mobile ? 'Close menu' : compact ? 'Expand sidebar' : 'Collapse sidebar'}
          className="rounded-lg p-2 text-faint transition-colors hover:bg-line/[0.06] hover:text-fg"
        >
          {mobile ? <X className="h-4 w-4" /> : compact ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className="space-y-0.5">
        <button onClick={p.onNew} title="New Analysis" className={row(p.view === 'analyze')}>
          {p.view === 'analyze' && pill}
          <span className="relative grid h-5 w-5 shrink-0 place-items-center rounded-md bg-accent text-white"><Plus className="h-3.5 w-3.5" /></span>
          {!compact && <span className="relative whitespace-nowrap font-medium">New Analysis</span>}
        </button>
        {NAV.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => p.onNav(id)} title={label} className={row(p.view === id)}>
            {p.view === id && pill}
            <Icon className="relative h-4 w-4 shrink-0" />
            {!compact && <span className="relative whitespace-nowrap">{label}</span>}
          </button>
        ))}
      </nav>

      {!compact ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search analyses" className="input py-2 pl-8 text-xs" />
          </div>
          <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
            {!groups.length && <p className="px-2 py-3 text-xs text-faint">{q ? 'No matching analyses.' : 'Your analyses will appear here.'}</p>}
            {groups.map((g) => (
              <div key={g.label}>
                <div className="label mb-1 px-2">{g.label}</div>
                {g.items.slice(0, 30).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => p.onOpen(a)}
                    title={a.title}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${p.activeId === a.id && p.view === 'analyze' ? 'bg-line/[0.05] text-fg' : 'text-muted hover:bg-line/[0.04] hover:text-fg'}`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[a.verdict]}`} />
                    <span className="truncate">{a.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="space-y-1 border-t border-line/[0.06] pt-3">
        <button onClick={() => p.onNav('settings')} title="Settings" className={row(p.view === 'settings')}>
          {p.view === 'settings' && pill}
          <Settings className="relative h-4 w-4 shrink-0" />
          {!compact && <span className="relative whitespace-nowrap">Settings</span>}
        </button>
        <div className={`flex items-center gap-3 px-2 py-1 ${compact ? 'justify-center' : ''}`} title={p.user.email}>
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{initials}</div>
          {!compact && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium">{p.user.name}</div>
              <div className="truncate text-[11px] text-faint">{p.user.email}</div>
            </div>
          )}
        </div>
        <button onClick={p.onLogout} title="Logout" className={`${row(false)} hover:!text-coral`}>
          <LogOut className="h-4 w-4 shrink-0" /> {!compact && 'Logout'}
        </button>
      </div>
    </div>
  );
}

export default function Sidebar(p: Props) {
  return (
    <>
      {/* Desktop: width animates; the main column is a flex sibling, so it re-centres itself */}
      <motion.aside
        initial={false}
        animate={{ width: p.collapsed ? 72 : 272 }}
        transition={{ duration: 0.22, ease }}
        className="sticky top-0 hidden h-screen shrink-0 overflow-hidden border-r glass-bar lg:block"
      >
        <SidebarContent {...p} compact={p.collapsed} />
      </motion.aside>

      {/* Mobile/tablet: slide-in drawer */}
      <AnimatePresence>
        {p.mobileOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={p.onCloseMobile} className="fixed inset-0 z-40 bg-slate-900/20 lg:hidden" />
            <motion.aside
              initial={{ x: -290 }}
              animate={{ x: 0 }}
              exit={{ x: -290 }}
              transition={{ duration: 0.24, ease }}
              className="fixed inset-y-0 left-0 z-50 w-[272px] border-r glass-bar bg-line/80 lg:hidden"
            >
              <SidebarContent {...p} compact={false} mobile />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

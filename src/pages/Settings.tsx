import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Cpu, Newspaper, Sparkles, Trash2, User as UserIcon } from 'lucide-react';
import { Button, Card, Field, listV, useToast } from '../components/ui';
import { fetchHealth } from '../lib/api';
import type { Settings as S, User } from '../lib/types';

interface Props {
  user: User;
  settings: S;
  historyCount: number;
  onRename: (name: string) => void;
  onSettings: (s: S) => void;
  onClearHistory: () => void;
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} role="switch" aria-checked={on} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-line/10'}`}>
      <motion.span layout transition={{ duration: 0.18 }} className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow ${on ? 'right-0.5' : 'left-0.5'}`} />
    </button>
  );
}

export default function Settings({ user, settings, historyCount, onRename, onSettings, onClearHistory }: Props) {
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [health, setHealth] = useState<{ ai: boolean; news: boolean } | null | undefined>();
  useEffect(() => { fetchHealth().then(setHealth); }, []);

  const status = (on?: boolean) =>
    health === undefined ? <span className="text-xs text-faint">Checking…</span>
      : on ? <span className="chip border-accent/25 bg-accent/[0.08] text-accent">Connected</span>
        : <span className="chip border-amber/25 bg-amber/[0.08] text-amber">Demo Mode</span>;

  return (
    <motion.div variants={listV} initial="hidden" animate="show" className="grid gap-4">
      <Card className="p-5">
        <h3 className="mb-4 flex items-center gap-2 font-medium"><UserIcon className="h-4 w-4 text-muted" /> Profile</h3>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1"><Field label="Display name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <Button variant="ghost" onClick={() => { if (name.trim().length < 2) return toast('Name is too short', 'error'); onRename(name.trim()); toast('Profile updated'); }}>Save</Button>
        </div>
        <p className="mt-3 text-xs text-faint">{user.email} · {user.provider === 'local' ? 'Local account' : `${user.provider} demo profile`} · stored only in this browser</p>
      </Card>

      <Card className="p-5">
        <h3 className="mb-4 flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4 text-muted" /> Appearance</h3>
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-sm">Reduce motion</p><p className="text-xs text-faint">Turns off animations (your system setting is also respected).</p></div>
          <Toggle on={settings.reduceMotion} onChange={() => onSettings({ ...settings, reduceMotion: !settings.reduceMotion })} />
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="mb-4 font-medium">Services</h3>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-3"><Cpu className="h-4 w-4 text-muted" /> Groq AI analysis <span className="ml-auto">{status(health?.ai)}</span></div>
          <div className="flex items-center gap-3"><Newspaper className="h-4 w-4 text-muted" /> NewsAPI world news <span className="ml-auto">{status(health?.news)}</span></div>
        </div>
        <p className="mt-3 text-xs text-faint">API keys are configured in the server's <code>.env</code> file and never reach the browser.</p>
      </Card>

      <Card className="p-5">
        <h3 className="mb-2 flex items-center gap-2 font-medium"><Trash2 className="h-4 w-4 text-coral" /> Data</h3>
        <p className="mb-4 text-sm text-muted">{historyCount} analyses stored in this browser's LocalStorage.</p>
        <Button variant="danger" disabled={!historyCount} onClick={() => { if (confirm('Delete all analyses? This cannot be undone.')) onClearHistory(); }}>Clear history</Button>
      </Card>
    </motion.div>
  );
}

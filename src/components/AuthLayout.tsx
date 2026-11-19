import type { ReactNode } from 'react';
import { BookOpenCheck, Newspaper, ShieldCheck } from 'lucide-react';
import { Logo } from './ui';

const features = [
  { Icon: BookOpenCheck, text: 'Weighs claims against live news coverage' },
  { Icon: Newspaper, text: 'Explains the signals behind every verdict' },
  { Icon: ShieldCheck, text: 'Private — history stays on your device' },
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between border-r border-line/[0.06] p-12 lg:flex">
        <Logo />
        <div className="max-w-md space-y-8">
          <p className="label">An evidence-first news verifier</p>
          <h1 className="font-display text-6xl leading-[1.02] tracking-tight">
            Read the news.<br /><span className="italic text-muted">Question the rest.</span>
          </h1>
          <ul className="space-y-3 text-sm text-muted">
            {features.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-accent" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-faint">© 2026 TruthGuard · College project</p>
      </aside>

      <main className="flex items-center justify-center px-4 py-10">
        <div className="panel w-full max-w-md p-8 sm:p-10">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h2 className="font-display text-4xl tracking-tight">{title}</h2>
          <p className="mb-8 mt-1 text-sm text-muted">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  );
}

export function SocialButtons({ onPick }: { onPick: (p: 'google' | 'facebook') => void }) {
  const btn = 'flex items-center justify-center gap-2 rounded-xl border border-line/[0.09] py-2.5 text-sm transition-colors hover:bg-line/[0.05]';
  return (
    <>
      <div className="my-6 flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-line/[0.07]" /> or <span className="h-px flex-1 bg-line/[0.07]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => onPick('google')} className={btn}>
          <svg className="h-4 w-4" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Google
        </button>
        <button type="button" onClick={() => onPick('facebook')} className={btn}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#1877F2">
            <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.62 23.1 24 18.1 24 12.07z" />
          </svg>
          Facebook
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-faint">Demo only — creates a local profile, no real sign-in.</p>
    </>
  );
}

import { createContext, useCallback, useContext, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { Bookmark, CheckCircle2, Info, Loader2, Newspaper, ShieldCheck, XCircle } from 'lucide-react';

/* ---------- Motion presets (quick & restrained) ---------- */
export const ease = [0.22, 1, 0.36, 1] as const;
export const listV: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
export const itemV: Variants = { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: 0.22, ease } } };
export const pageV: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/* ---------- Button ---------- */
type Variant = 'primary' | 'ghost' | 'danger' | 'accent';
const variants: Record<Variant, string> = {
  primary: 'bg-[#2563EB] text-white shadow-md shadow-blue-600/25 hover:bg-[#1D4ED8] disabled:bg-[#3366D6] [&_svg]:text-white',
  accent: 'bg-[#2563EB] text-white shadow-md shadow-blue-600/25 hover:bg-[#1D4ED8] disabled:bg-[#3366D6] [&_svg]:text-white',
  ghost: 'border border-line/[0.1] bg-white/60 text-fg hover:bg-white/90 disabled:opacity-60',
  danger: 'border border-coral/30 bg-coral/10 text-coral hover:bg-coral/15 disabled:opacity-60',
};

export function Button({ variant = 'primary', loading, className = '', children, disabled, ...p }: HTMLMotionProps<'button'> & { variant?: Variant; loading?: boolean }) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.15 }}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...p}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children as ReactNode}
    </motion.button>
  );
}

/* ---------- Card with subtle hover lift ---------- */
export function Card({ hover, className = '', children, ...p }: HTMLMotionProps<'div'> & { hover?: boolean }) {
  return (
    <motion.div variants={itemV} whileHover={hover ? { y: -2, transition: { duration: 0.18 } } : undefined} className={`panel ${className}`} {...p}>
      {children as ReactNode}
    </motion.div>
  );
}

export const Skeleton = ({ className = '' }: { className?: string }) => <div className={`skeleton rounded-lg ${className}`} />;

/* ---------- Form field ---------- */
export function Field({ label, error, icon, right, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; icon?: ReactNode; right?: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint">{icon}</span>}
        <input {...p} className={`input ${icon ? 'pl-10' : ''} ${right ? 'pr-11' : ''} ${error ? '!border-coral/60' : ''}`} />
        {right && <span className="absolute right-2 top-1/2 -translate-y-1/2">{right}</span>}
      </div>
      <AnimatePresence>
        {error && (
          <motion.span initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="block text-xs text-coral">
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </label>
  );
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent text-white shadow-md shadow-blue-600/25">
        <ShieldCheck className="h-4 w-4" />
      </div>
      {!small && (
        <div className="whitespace-nowrap leading-none">
          <div className="font-display text-xl tracking-tight">TruthGuard</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-faint">News verifier</div>
        </div>
      )}
    </div>
  );
}

export const DemoBadge = ({ label = 'Demo Mode' }: { label?: string }) => (
  <span className="badge-demo">{label}</span>
);

/* ---------- News thumbnail with graceful fallback ---------- */
export function Thumb({ src, className = '' }: { src?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed)
    return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={`shrink-0 rounded-lg object-cover grayscale-[20%] ${className}`} />;
  return (
    <div className={`grid shrink-0 place-items-center rounded-lg bg-accent-soft/70 text-accent ${className}`}>
      <Newspaper className="h-4 w-4 text-faint" />
    </div>
  );
}

/* ---------- Toasts ---------- */
type ToastKind = 'success' | 'error' | 'info' | 'saved';
interface Toast { id: number; kind: ToastKind; msg: string }
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

const toastIcons = {
  success: <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />,
  saved: <Bookmark className="h-4 w-4 shrink-0 fill-accent text-accent" />,
  error: <XCircle className="h-4 w-4 shrink-0 text-coral" />,
  info: <Info className="h-4 w-4 shrink-0 text-muted" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col items-center gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
              transition={{ duration: 0.22, ease }}
              className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-white/70 bg-white/80 px-4 py-2.5 text-sm text-fg shadow-xl shadow-slate-900/10 backdrop-blur-xl"
            >
              {toastIcons[t.kind]} {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

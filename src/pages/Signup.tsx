import { useState, type FormEvent } from 'react';
import { Lock, Mail, User as UserIcon } from 'lucide-react';
import { AuthLayout, SocialButtons } from '../components/AuthLayout';
import { Button, Field, useToast } from '../components/ui';
import { hashPassword, store } from '../lib/storage';
import type { User } from '../lib/types';
import { EMAIL_RE, PasswordToggle } from './Login';

export function strength(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  if (pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw)) return 3; // Strong
  if (pw.length >= 6 && /\d/.test(pw)) return 2; // Medium
  return 1; // Weak
}
const LEVELS = [
  { label: '', color: 'bg-line/10', text: '' },
  { label: 'Weak', color: 'bg-coral', text: 'text-coral' },
  { label: 'Medium', color: 'bg-amber', text: 'text-amber' },
  { label: 'Strong', color: 'bg-ok', text: 'text-ok' },
];

interface Props { onAuth: (u: User) => void; onSocial: (p: 'google' | 'facebook') => void; goLogin: () => void }

export default function Signup({ onAuth, onSocial, goLogin }: Props) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const s = strength(f.password);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (f.name.trim().length < 2) errs.name = 'Enter your full name';
    if (!EMAIL_RE.test(f.email)) errs.email = 'Enter a valid email address';
    else if (store.findUser(f.email)) errs.email = 'An account with this email already exists';
    if (f.password.length < 6) errs.password = 'Use at least 6 characters';
    if (f.confirm !== f.password) errs.confirm = 'Passwords do not match';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true);
    const user: User = { name: f.name.trim(), email: f.email.trim(), provider: 'local', passHash: await hashPassword(f.password) };
    store.saveUser(user);
    setLoading(false);
    toast('Account created — welcome to TruthGuard!');
    onAuth(user);
  }

  return (
    <AuthLayout title="Create your account" subtitle="Start detecting misinformation in seconds.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" placeholder="Ada Lovelace" icon={<UserIcon className="h-4 w-4" />} value={f.name} onChange={set('name')} error={errors.name} autoComplete="name" />
        <Field label="Email" type="email" placeholder="you@college.edu" icon={<Mail className="h-4 w-4" />} value={f.email} onChange={set('email')} error={errors.email} autoComplete="email" />
        <div className="space-y-2">
          <Field
            label="Password" type={show ? 'text' : 'password'} placeholder="At least 6 characters" icon={<Lock className="h-4 w-4" />}
            value={f.password} onChange={set('password')} error={errors.password} autoComplete="new-password"
            right={<PasswordToggle show={show} onToggle={() => setShow(!show)} />}
          />
          {f.password && (
            <div className="flex items-center gap-3">
              <div className="flex flex-1 gap-1.5">
                {[1, 2, 3].map((i) => (
                  <span key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i <= s ? LEVELS[s].color : 'bg-line/10'}`} />
                ))}
              </div>
              <span className={`w-14 text-right text-xs font-semibold ${LEVELS[s].text}`}>{LEVELS[s].label}</span>
            </div>
          )}
        </div>
        <Field label="Confirm password" type={show ? 'text' : 'password'} placeholder="Repeat password" icon={<Lock className="h-4 w-4" />} value={f.confirm} onChange={set('confirm')} error={errors.confirm} autoComplete="new-password" />
        <Button type="submit" loading={loading} className="w-full">Create account</Button>
      </form>
      <SocialButtons onPick={onSocial} />
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account? <button onClick={goLogin} className="font-medium text-accent hover:brightness-110">Log in</button>
      </p>
    </AuthLayout>
  );
}

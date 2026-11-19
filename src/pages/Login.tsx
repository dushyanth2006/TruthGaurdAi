import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { AuthLayout, SocialButtons } from '../components/AuthLayout';
import { Button, Field, useToast } from '../components/ui';
import { hashPassword, store } from '../lib/storage';
import type { User } from '../lib/types';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PasswordToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-label={show ? 'Hide password' : 'Show password'} className="rounded-lg p-1.5 text-muted hover:bg-line/[0.06] hover:text-fg">
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

interface Props { onAuth: (u: User) => void; onSocial: (p: 'google' | 'facebook') => void; goSignup: () => void }

export default function Login({ onAuth, onSocial, goSignup }: Props) {
  const toast = useToast();
  const [email, setEmail] = useState(store.remembered());
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(store.remembered()));
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!EMAIL_RE.test(email)) errs.email = 'Enter a valid email address';
    if (!password) errs.password = 'Password is required';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true);
    // Checked entirely in the browser — the password never leaves this device.
    const user = store.findUser(email);
    const ok = user?.passHash && user.passHash === (await hashPassword(password));
    setLoading(false);
    if (!user) return setErrors({ email: 'No account found — please sign up first' });
    if (!ok) return setErrors({ password: 'Incorrect password' });

    store.setRemembered(remember ? email : '');
    toast(`Welcome back, ${user.name.split(' ')[0]}!`);
    onAuth(user);
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to continue verifying the news.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" type="email" placeholder="you@college.edu" icon={<Mail className="h-4 w-4" />} value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoComplete="email" />
        <Field
          label="Password" type={show ? 'text' : 'password'} placeholder="••••••••" icon={<Lock className="h-4 w-4" />}
          value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} autoComplete="current-password"
          right={<PasswordToggle show={show} onToggle={() => setShow(!show)} />}
        />
        <div className="flex items-center justify-between text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-muted">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded accent-[#2563EB]" />
            Remember me
          </label>
          <button type="button" onClick={() => toast('Password reset is not available in the local demo.', 'info')} className="text-accent hover:brightness-110">
            Forgot password?
          </button>
        </div>
        <Button type="submit" loading={loading} className="w-full">Log in</Button>
      </form>
      <SocialButtons onPick={onSocial} />
      <p className="mt-6 text-center text-sm text-muted">
        New here? <button onClick={goSignup} className="font-medium text-accent hover:brightness-110">Create an account</button>
      </p>
    </AuthLayout>
  );
}

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { pageV, ToastProvider, useToast } from './components/ui';
import WebThreads from './components/WebThreads';
import { store } from './lib/storage';
import type { Settings, User } from './lib/types';
import AppShell from './pages/AppShell';
import Login from './pages/Login';
import Signup from './pages/Signup';

function Shell({ settings, setSettings }: { settings: Settings; setSettings: (s: Settings) => void }) {
  const toast = useToast();
  const [user, setUser] = useState<User | null>(store.session());
  const [page, setPage] = useState<'login' | 'signup'>(store.users().length ? 'login' : 'signup');

  const login = (u: User) => {
    store.setSession(u);
    setUser({ ...u, passHash: undefined });
  };

  // Demo-only social sign-in: creates a local profile, nothing leaves the browser.
  const social = (p: 'google' | 'facebook') => {
    const email = `demo.${p}@truthguard.local`;
    const u: User = store.findUser(email) ?? { name: p === 'google' ? 'Google Demo User' : 'Facebook Demo User', email, provider: p };
    store.saveUser(u);
    login(u);
    toast(`Signed in with ${p === 'google' ? 'Google' : 'Facebook'} (demo profile)`);
  };

  const updateUser = (u: User) => {
    const stored = store.findUser(u.email);
    store.saveUser({ ...stored, ...u, passHash: stored?.passHash });
    login(u);
  };

  const logout = () => {
    store.setSession(null);
    setUser(null);
    setPage('login');
    toast('You have been logged out', 'info');
  };

  const key = user ? 'app' : page;
  return (
    <AnimatePresence mode="wait">
      <motion.div key={key} variants={pageV} initial="hidden" animate="show" exit="exit">
        {user ? (
          <AppShell user={user} settings={settings} onSettings={setSettings} onUser={updateUser} onLogout={logout} />
        ) : page === 'login' ? (
          <Login onAuth={login} onSocial={social} goSignup={() => setPage('signup')} />
        ) : (
          <Signup onAuth={login} onSocial={social} goLogin={() => setPage('login')} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  const [settings, setSettingsState] = useState<Settings>(store.settings());
  const setSettings = (s: Settings) => {
    store.setSettings(s);
    setSettingsState(s);
  };
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion);
  }, [settings.reduceMotion]);

  // Pause the WebGL threads when the app toggle OR the OS "reduce motion" setting is on.
  const [systemReduce, setSystemReduce] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setSystemReduce(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const reduceMotion = settings.reduceMotion || systemReduce;

  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? 'always' : 'user'}>
      {/* Fixed background layer: gradient + WebThreads canvas. Never receives pointer events or affects layout. */}
      <div className="app-bg" aria-hidden="true">
        <WebThreads
          colors={['#8EC5FF', '#B8D8FF', '#CFC8FF']}
          coreColor="#FFFFFF"
          backgroundColor="transparent"
          lightMode={true}
          threadCount={7}
          speed={0.07}
          frequency={3.2}
          spread={0.16}
          taper={0.65}
          position={0.48}
          pinch={0.56}
          nodes={1}
          angle={-6}
          glow={0.015}
          falloff={0.8}
          thickness={0.75}
          brightness={0.42}
          opacity={0.32}
          depth={0.18}
          pulses={0}
          shimmer={true}
          fade={0.22}
          grain={0.015}
          intro={true}
          mouseInteraction={false}
          pulseOnClick={false}
          paused={reduceMotion}
        />
      </div>
      {/* All app content sits above the background */}
      <div className="relative z-[1]">
        <ToastProvider>
          <Shell settings={settings} setSettings={setSettings} />
        </ToastProvider>
      </div>
    </MotionConfig>
  );
}

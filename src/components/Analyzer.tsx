import { useEffect, useRef, useState, type DragEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, FileText, ImageUp, Loader2, Mic, MicOff, ScanSearch, Sparkles } from 'lucide-react';
import { analyzeText, ValidationError } from '../lib/api';
import { makeTitle } from '../lib/format';
import type { Analysis, InputSource } from '../lib/types';
import { Button, ease, Skeleton, useToast } from './ui';

const TABS: { id: InputSource; label: string; Icon: typeof FileText }[] = [
  { id: 'text', label: 'Text', Icon: FileText },
  { id: 'voice', label: 'Voice', Icon: Mic },
  { id: 'image', label: 'Image', Icon: ImageUp },
];
const STEPS = ['Cleaning & validating input', 'Extracting claim keywords', 'Fetching related news (NewsAPI)', 'Analyzing with Groq AI', 'Building verdict'];
const SAMPLES = [
  "SHOCKING!!! Scientists don't want you to know this miracle fruit cures diabetes in 3 days. Share before it gets deleted!",
  'According to an official statement published by the World Health Organization, measles cases rose last year, the data shows.',
  'A new law will make it illegal to use mobile phones while walking in all major cities starting next month.',
];
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRec: any = typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export default function Analyzer({ onResult }: { onResult: (a: Analysis) => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<InputSource>('text');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState(-1);
  const [listening, setListening] = useState(false);
  const [ocr, setOcr] = useState<{ progress: number; status: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const busy = step >= 0 || Boolean(ocr);

  useEffect(() => () => recRef.current?.stop(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  /* ----- Voice (Web Speech API) ----- */
  function toggleVoice() {
    if (listening) return recRef.current?.stop();
    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    const base = text.trim() ? `${text.trim()} ` : '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let s = '';
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
      setText(base + s);
      setError('');
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => toast(e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Voice input stopped (${e.error}).`, 'error');
    rec.onend = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  }

  /* ----- Image OCR (Tesseract.js, runs in the browser) ----- */
  async function runOcr(file?: File) {
    if (!file) return;
    if (!IMG_TYPES.includes(file.type)) return toast('Please choose a JPG, PNG or WEBP image.', 'error');
    if (file.size > 10 * 1024 * 1024) return toast('Image is too large (max 10 MB).', 'error');
    setPreview(URL.createObjectURL(file));
    setOcr({ progress: 0, status: 'loading OCR engine' });
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, {
        logger: (m: { status: string; progress: number }) => setOcr({ status: m.status, progress: m.progress }),
      });
      const { data } = await worker.recognize(file);
      await worker.terminate();
      const extracted = data.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (extracted.length < 5) toast('No readable text found in this image.', 'info');
      else {
        setText(extracted);
        setError('');
        toast('Text extracted — review and edit it before analyzing.');
      }
    } catch {
      toast('Could not read the image. Check your connection (OCR language data downloads on first use).', 'error');
    } finally {
      setOcr(null);
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    runOcr(e.dataTransfer.files[0]);
  };

  /* ----- Analyze ----- */
  async function analyze() {
    const t = text.trim();
    if (t.length < 15) return setError('Please enter at least 15 characters.');
    if (t.split(/\s+/).length < 4) return setError('Please enter a full sentence or claim (at least 4 words).');
    if (t.length > 5000) return setError('Text is too long (max 5000 characters).');
    recRef.current?.stop();
    setError('');
    const request = analyzeText(t).catch((e) => e as Error);
    for (let i = 0; i < STEPS.length; i++) {
      setStep(i);
      await wait(420);
    }
    const r = await request;
    setStep(-1);
    if (r instanceof Error) {
      if (r instanceof ValidationError) setError(r.message);
      else toast('Analysis failed. Please try again.', 'error');
      return;
    }
    onResult({ ...r, id: crypto.randomUUID(), title: makeTitle(t), text: t, source: tab, createdAt: Date.now() });
    toast(r.demo ? 'Analysis complete (Demo Mode)' : 'Analysis complete');
  }

  return (
    <div id="analyzer" className="space-y-4">
      <div className="panel p-5 sm:p-6">
        {/* Header row: title block left, tabs right, top edges aligned; stacks on small screens */}
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <h2 className="flex h-8 items-center gap-2 font-display text-2xl leading-8"><Sparkles className="h-4 w-4 shrink-0 text-accent" /> Analyze a claim</h2>
            <p className="mt-1 text-sm text-muted">Paste text, speak it, or upload a screenshot.</p>
          </div>
          <div className="flex h-8 shrink-0 items-center gap-2" role="tablist">
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} disabled={busy} onClick={() => setTab(id)} role="tab" aria-selected={tab === id} className={`ctl h-8 py-0 ${tab === id ? 'ctl-active' : ''}`}>
                <Icon className="h-3.5 w-3.5" /> <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            {tab === 'voice' && (
              <div className="mb-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-line/10 bg-line/[0.02] p-5 text-center">
                {SpeechRec ? (
                  <>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={toggleVoice}
                      disabled={step >= 0}
                      className={`relative grid h-16 w-16 place-items-center rounded-full text-fg shadow-lg ${listening ? 'bg-coral shadow-slate-900/10' : 'bg-accent text-white shadow-slate-900/10'}`}
                    >
                      {listening && <span className="absolute inset-0 animate-ping rounded-full bg-coral/30" />}
                      {listening ? <MicOff className="relative h-6 w-6" /> : <Mic className="h-6 w-6" />}
                    </motion.button>
                    <p className="text-sm text-muted">{listening ? 'Listening… speak your claim, then tap to stop.' : 'Tap the mic and read the claim aloud.'}</p>
                  </>
                ) : (
                  <p className="text-sm text-amber">Voice input isn't supported in this browser. Try Chrome or Edge, or type the claim in the box below.</p>
                )}
              </div>
            )}

            {tab === 'image' && (
              <label
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
                className={`mb-4 flex cursor-pointer items-center gap-4 rounded-xl border border-dashed p-4 transition-colors ${drag ? 'border-accent/50 bg-accent/5' : 'border-line/10 bg-line/[0.02] hover:border-line/20'}`}
              >
                <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="hidden" disabled={busy} onChange={(e) => { runOcr(e.target.files?.[0]); e.target.value = ''; }} />
                {preview ? <img src={preview} alt="Uploaded" className="h-16 w-16 rounded-lg object-cover ring-1 ring-line/10" /> : <div className="grid h-16 w-16 place-items-center rounded-lg bg-line/5"><ImageUp className="h-6 w-6 text-muted" /></div>}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Drop a screenshot or click to upload</p>
                  <p className="text-xs text-faint">JPG, PNG or WEBP · text is extracted in your browser</p>
                  {ocr && (
                    <div className="mt-2">
                      <div className="mb-1 flex justify-between text-[11px] capitalize text-muted">
                        <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />{ocr.status}</span>
                        <span>{Math.round(ocr.progress * 100)}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-line/5">
                        <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${ocr.progress * 100}%` }} transition={{ duration: 0.2 }} />
                      </div>
                    </div>
                  )}
                </div>
              </label>
            )}
          </motion.div>
        </AnimatePresence>

        {tab !== 'text' && <p className="mb-1.5 text-xs font-medium text-muted">{tab === 'image' ? 'Extracted text — edit before analysis' : 'Transcript — edit before analysis'}</p>}
        {/* Textarea + counter share one grid cell, so the counter sits on the textarea's bottom-right edge */}
        <div className="grid">
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setError(''); }}
            disabled={step >= 0}
            rows={tab === 'text' ? 6 : 4}
            aria-describedby="char-count"
            placeholder={tab === 'text' ? 'Paste a headline, claim, or article text…' : 'Your text will appear here…'}
            className={`input resize-none pb-8 leading-relaxed [grid-area:1/1] ${error ? '!border-coral/60' : ''}`}
          />
          <span id="char-count" className="pointer-events-none m-2 self-end justify-self-end rounded-md bg-white/70 px-2 py-0.5 text-xs tabular-nums text-faint [grid-area:1/1]">
            {text.length}/5000
          </span>
        </div>
        <AnimatePresence>
          {error && <motion.p initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 text-xs text-coral">{error}</motion.p>}
        </AnimatePresence>

        {/* Action row: button and chips vertically centred, equal 8px gaps */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={analyze} loading={step >= 0} disabled={Boolean(ocr)} className="h-10 w-full px-6 py-0 sm:w-auto">
            {step < 0 && <ScanSearch className="h-4 w-4" />} {step >= 0 ? 'Analyzing…' : 'Analyze now'}
          </Button>
          {tab === 'text' &&
            SAMPLES.map((s, i) => (
              <motion.button key={i} whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} disabled={busy} onClick={() => { setText(s); setError(''); }}
                className="ctl h-8 rounded-full py-0">
                Sample {i + 1}
              </motion.button>
            ))}
        </div>
      </div>

      <AnimatePresence>
        {step >= 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.22 }} className="panel space-y-4 p-6">
            <div className="space-y-2.5">
              {STEPS.map((s, i) => (
                <div key={s} className={`flex items-center gap-3 text-sm transition-opacity duration-200 ${i > step ? 'opacity-35' : ''}`}>
                  <span className={`grid h-6 w-6 place-items-center rounded-full transition-colors ${i < step ? 'bg-accent/15 text-accent' : i === step ? 'bg-line/10 text-fg' : 'bg-line/5'}`}>
                    {i < step ? <Check className="h-3.5 w-3.5" /> : i === step ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-faint" />}
                  </span>
                  {s}
                </div>
              ))}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line/5">
              <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} transition={{ duration: 0.3, ease }} />
            </div>
            <div className="flex gap-4 pt-1">
              <Skeleton className="h-24 w-24 rounded-full" />
              <div className="flex-1 space-y-2.5 pt-2">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

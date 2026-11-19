# TruthGuard AI — Fake News Detector

A college-project dashboard: paste, speak, or upload a screenshot of a claim and get a **Real / Fake / Unverified** verdict with confidence, an explainable **“Why this verdict?”** section, a rule-based **credibility checklist**, **Evidence & Sources** from NewsAPI, the **earliest related coverage**, and limitations. Results can be kept as **Saved Reports** (LocalStorage) or downloaded as a **PDF** generated in the browser. A floating **Top 5 World News** panel shows live headlines.

**Stack:** React + Vite + TypeScript + Tailwind CSS + Framer Motion + Lucide · Node + Express (API proxy only) · Tesseract.js (in-browser OCR) · Web Speech API · LocalStorage.

## Run locally

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
# optional: add GROQ_API_KEY and NEWS_API_KEY to .env
npm run dev
```

Open http://localhost:5173. The API runs on http://localhost:3001 (Vite proxies `/api`).
`npm run build` type-checks and builds the frontend into `dist/`.

## How analysis works

1. Browser sends only the claim text to `POST /api/analyze` (passwords never leave the browser).
2. Express cleans and validates the text, runs free **rule-based checks** (author, date, publisher, links, cited sources, clickbait wording, headline/article mismatch) and extracts keywords.
3. NewsAPI is searched with those keywords; only articles that genuinely match the claim are kept and numbered `a1…a6`.
4. The claim + those numbered articles go to Groq (`llama-3.3-70b-versatile`), which returns JSON with a verdict, reasons, limitations and evidence **statuses by article id only**.
5. The response (`verdict: REAL | FAKE | UNVERIFIED`, `confidence`, `summary`, `reasons`, `limitations`, `credibilityChecklist`, `evidence`, `earliestRelatedCoverage`) is shown and can be saved.

### Source safety

Groq never supplies citations. Every evidence card (title, publisher, date, URL) is built by the server from the NewsAPI response and then validated against it; unknown article ids, altered titles and any URLs the model writes in its text are dropped. “Earliest related coverage” is simply the oldest matching NewsAPI result — not a claim about the original source. Without a NewsAPI key, the evidence sections show a clear empty state instead of placeholder links.

`GET /api/news` returns the top 10 headlines (cached 10 minutes).

## Demo mode

Each key is optional. If `GROQ_API_KEY` or `NEWS_API_KEY` is missing or a request fails, the app uses a rule-based verdict and sample world news. These are always labelled **Demo AI / Demo News / Demo Mode**, so the project works during a presentation.

## Notes

- Accounts are **local demo profiles** in LocalStorage; passwords are SHA-256 hashed in the browser and never sent anywhere.
- Google / Facebook buttons are **demo only** — no real OAuth.
- Voice input needs a browser with the Web Speech API (Chrome or Edge).
- Image OCR runs in the browser; Tesseract downloads its English language data from a CDN the first time, so the first scan needs internet.
- API keys stay in the server's `.env` and are never sent to the frontend.

import { jsPDF } from 'jspdf';
import type { Analysis } from './types';

const NAVY: [number, number, number] = [16, 42, 67];
const BODY: [number, number, number] = [54, 80, 109];
const META: [number, number, number] = [100, 116, 139];
const BLUE: [number, number, number] = [37, 99, 235];
const STATE_COLOR = { pass: [4, 120, 87], warn: [161, 98, 7], fail: [180, 35, 24], na: [100, 116, 139] } as const;
const STATE_LABEL = { pass: 'OK', warn: 'WARNING', fail: 'ISSUE', na: 'N/A' } as const;
const STATUS_LABEL = { SUPPORTS: 'Supports', CONTRADICTS: 'Contradicts', CONTEXT: 'Context' } as const;

const fmt = (iso: string | number) => {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  return Number.isNaN(t) ? 'Date unknown' : new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
// Standard PDF fonts only cover Latin-1; replace anything else so text never renders as garbage.
const safe = (s: string) => String(s ?? '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[—–]/g, '-').replace(/…/g, '...').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');

/** Builds a clean, printable A4 report from an existing analysis (no server involved). */
export function buildReportPdf(a: Analysis): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const width = W - M * 2;
  let y = M;

  const ensure = (h: number) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const write = (s: string, o: { size?: number; bold?: boolean; color?: readonly number[]; indent?: number; after?: number } = {}) => {
    const { size = 10, bold = false, color = BODY, indent = 0, after = 4 } = o;
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(color[0], color[1], color[2]);
    for (const line of doc.splitTextToSize(safe(s), width - indent) as string[]) {
      ensure(size * 1.4);
      doc.text(line, M + indent, y);
      y += size * 1.4;
    }
    y += after;
  };
  const heading = (s: string) => {
    ensure(72); // keep a heading together with at least its first couple of lines
    y += 10;
    write(s, { size: 13, bold: true, color: NAVY, after: 2 });
    doc.setDrawColor(219, 234, 254).setLineWidth(1).line(M, y, W - M, y);
    y += 12;
  };
  const link = (url: string, indent = 0) => {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...BLUE);
    for (const line of doc.splitTextToSize(safe(url), width - indent) as string[]) {
      ensure(13);
      doc.textWithLink(line, M + indent, y, { url });
      y += 13;
    }
    y += 4;
  };

  // Title block
  write('TruthGuard - Fact-check report', { size: 20, bold: true, color: NAVY, after: 2 });
  write(`Generated ${fmt(Date.now())} · Analysis run ${fmt(a.createdAt)}`, { size: 9, color: META, after: 10 });
  write(`Verdict: ${a.verdict.toUpperCase()}   ·   Confidence: ${Math.round(a.confidence)}%`, { size: 14, bold: true, color: a.verdict === 'Fake' ? STATE_COLOR.fail : a.verdict === 'Real' ? STATE_COLOR.pass : STATE_COLOR.warn, after: 2 });
  write(`Analysis: ${a.demo ? 'Demo (rule-based)' : 'Groq AI'}   ·   Evidence: ${a.newsDemo ? 'Demo mode (no NewsAPI key)' : 'NewsAPI'}`, { size: 9, color: META });

  heading('Claim analysed');
  write(a.text, { size: 10, color: NAVY });

  heading('Why this verdict?');
  write(a.summary);
  a.reasons.forEach((r, i) => {
    write(`${i + 1}. ${r.title}`, { bold: true, color: NAVY, after: 0 });
    write(r.detail, { indent: 14 });
  });

  heading('Credibility checklist');
  for (const c of a.credibilityChecklist) {
    write(`[${STATE_LABEL[c.state]}]  ${c.label}`, { bold: true, color: STATE_COLOR[c.state], after: 0 });
    write(c.detail, { indent: 14, size: 9 });
  }

  heading('Evidence & sources (NewsAPI)');
  if (!a.evidence.length) write(a.newsDemo ? 'No live sources: NewsAPI is not configured (Demo Mode).' : 'No sufficiently relevant matching coverage found.', { color: META });
  a.evidence.forEach((e, i) => {
    write(`${i + 1}. ${e.title}`, { bold: true, color: NAVY, after: 0 });
    write(`${e.publisher} · ${fmt(e.publishedAt)} · ${STATUS_LABEL[e.status]}`, { indent: 14, size: 9, color: META, after: 0 });
    link(e.url, 14);
  });

  heading('Earliest related coverage');
  const ec = a.earliestRelatedCoverage;
  if (!ec) write(a.newsDemo ? 'No live sources: NewsAPI is not configured (Demo Mode).' : 'No sufficiently relevant matching coverage found.', { color: META });
  else {
    write(ec.title, { bold: true, color: NAVY, after: 0 });
    write(`${ec.publisher} · ${fmt(ec.publishedAt)}`, { size: 9, color: META, after: 0 });
    link(ec.url);
    write('Earliest related coverage found - not necessarily the original source.', { size: 9, color: META });
  }

  heading('Limitations');
  if (!a.limitations.length) write('None noted.', { color: META });
  a.limitations.forEach((l) => write(`- ${l}`));

  y += 8;
  write('AI analysis can be wrong. Verify important claims with trusted sources. Generated locally in the browser by TruthGuard (college project).', { size: 8, color: META });

  // Page numbers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p).setFont('helvetica', 'normal').setFontSize(8).setTextColor(...META);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 24, { align: 'right' });
  }
  return doc;
}

export function reportFileName(a: Analysis) {
  const slug = a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'claim';
  const d = new Date(a.createdAt); // local date, not UTC
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `truthguard-report-${slug}-${ymd}.pdf`;
}

export async function downloadReportPdf(a: Analysis) {
  buildReportPdf(a).save(reportFileName(a));
}

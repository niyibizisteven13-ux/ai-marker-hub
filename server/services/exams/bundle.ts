import { createHash } from 'node:crypto';
import JSZip from 'jszip';

/** Packages the examination results into one ZIP with a manifest of content hashes. */

export interface BundleFile { path: string; data: Buffer; kind: 'report' | 'workbook' | 'summary' | 'candidate_pdf' | 'candidate_report' }

/** Safe file-name part from a candidate id: letters, digits, dot, dash and underscore only. */
export function safeName(s: string): string {
  return s.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(0, 60) || 'candidate';
}

export async function buildBundle(files: BundleFile[], meta: { examId: string; title: string; resultRevision: number; runId: string; schemeVersion: number; generatedAt: string; candidates: Array<{ candidateId: string; submissionId: string; sourceSha256: string; pdf: string | null; report: string | null }> }): Promise<{ zip: Buffer; manifest: unknown }> {
  const root = 'examination-results';
  const zip = new JSZip();
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  for (const f of files) {
    if (f.path.includes('..') || f.path.startsWith('/')) throw new Error('unsafe bundle path');
    zip.file(`${root}/${f.path}`, f.data, { date: new Date(meta.generatedAt) });
  }
  const manifest = {
    format: 'bwenge-exam-results/1',
    examId: meta.examId, title: meta.title, resultRevision: meta.resultRevision, markingRunId: meta.runId, schemeVersion: meta.schemeVersion, generatedAt: meta.generatedAt,
    files: files.map((f) => ({ path: f.path, kind: f.kind, bytes: f.data.length, sha256: sha(f.data) })),
    candidates: meta.candidates,
    note: 'Marks are AI-proposed unless a candidate or question is marked user_confirmed. Compare resultRevision with the latest export to detect stale copies.',
  };
  zip.file(`${root}/manifest.json`, JSON.stringify(manifest, null, 2), { date: new Date(meta.generatedAt) });
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { zip: buf, manifest };
}

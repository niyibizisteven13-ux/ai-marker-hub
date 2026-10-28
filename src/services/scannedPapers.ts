import { jsPDF } from 'jspdf';
import { authFetch } from '../utils/authFetch';
import type { MarkingLimits } from '../../shared/markingLimits';
import type { PageItem } from '../components/DocumentScanner';

/** Keep scanner identity, not the editable display name: two students can have the same name. */
export function groupScanPages(pages: PageItem[]): Map<string, PageItem[]> {
  const groups = new Map<string, PageItem[]>();
  pages.forEach((p, i) => {
    const id = p.candidateId || p.studentName || `paper-${i}`;
    groups.set(id, [...(groups.get(id) || []), p]);
  });
  return groups;
}

/** Embed the original JPEGs, in order, without re-encoding them. Bound physical page size for OCR rendering. */
export async function scanPaper(pages: PageItem[]): Promise<Blob> {
  if (!pages.length) throw new Error('A student paper needs at least one scanned page.');
  const pdf = new jsPDF({ unit: 'pt' });
  for (let i = 0; i < pages.length; i++) {
    const props = pdf.getImageProperties(pages[i].sourceDataUrl || pages[i].dataUrl);
    const scale = 842 / Math.max(props.width, props.height);
    const width = props.width * scale, height = props.height * scale;
    if (i === 0) pdf.deletePage(1);
    pdf.addPage([width, height], width > height ? 'landscape' : 'portrait');
    pdf.addImage(pages[i].sourceDataUrl || pages[i].dataUrl, 'JPEG', 0, 0, width, height);
  }
  return pdf.output('blob');
}


/** Finish durable upload before the scanner discards its recoverable local draft. */
export async function registerScannedPapers(pages: PageItem[]) {
  const request = async (path: string, init?: RequestInit) => {
    const response = await authFetch(`/api/exams${path}`, init);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save scanned papers.');
    return data;
  };
  const limits: MarkingLimits = await request('/limits');
  const groups = groupScanPages(pages);
  if (!pages.length || groups.size > limits.maxCandidates || pages.length > limits.maxBatchPages)
    throw new Error('This scan exceeds the batch limits. Split it into smaller assessments.');
  const form = new FormData(); const mapping: object[] = [];
  let index = 0, bytes = 0;
  for (const paper of groups.values()) {
    if (paper.length > limits.maxPagesPerPaper) throw new Error(`A paper can contain at most ${limits.maxPagesPerPaper} pages.`);
    const pdf = await scanPaper(paper); bytes += pdf.size;
    if (pdf.size > limits.maxFileBytes || bytes > limits.maxUploadBytes) throw new Error('The scanned files are too large. Send a smaller batch.');
    const candidateId = `SCN-${String(++index).padStart(3, '0')}`, name = `${candidateId}.pdf`;
    form.append('scripts', pdf, name); mapping.push({ fileName: name, candidateId, candidateName: paper[0].studentName || candidateId });
  }
  form.append('mapping', JSON.stringify(mapping));
  const exam = await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Scanned assessment' }) });
  const saved = await request(`/${exam.examId}/submissions`, { method: 'POST', body: form });
  if (saved.rejected?.length) throw new Error('Some scanned papers could not be saved. Check for duplicate or unsupported pages. Your scan draft is retained.');
  return { examId: exam.examId as string, firstSubmissionId: saved.accepted[0]?.id as string | undefined, limits };
}

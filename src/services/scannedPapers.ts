import { jsPDF } from 'jspdf';
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
    const props = pdf.getImageProperties(pages[i].dataUrl);
    const scale = 842 / Math.max(props.width, props.height);
    const width = props.width * scale, height = props.height * scale;
    if (i === 0) pdf.deletePage(1);
    pdf.addPage([width, height], width > height ? 'landscape' : 'portrait');
    pdf.addImage(pages[i].dataUrl, 'JPEG', 0, 0, width, height);
  }
  return pdf.output('blob');
}

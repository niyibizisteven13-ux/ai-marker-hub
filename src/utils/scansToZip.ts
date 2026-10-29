import JSZip from 'jszip';

/**
 * Camera scans → one ZIP for the Mark page: a folder per student, pages in order. The server turns each folder
 * into one script (one PDF per student), so a student's pages are never marked as separate students. The 1800 px page
 * goes in, not the 4000 px original: the model reads images at about 1568 px, and a class stays a few MB per student.
 * Everything sits under one wrapping folder, which the server strips, so a single student is still one folder.
 */
export async function scansToZip(pages: Array<{ dataUrl: string; candidateId?: string; studentName?: string }>): Promise<File> {
  const zip = new JSZip();
  const folders = new Map<string, string>();
  const used = new Set<string>();
  const count = new Map<string, number>();
  for (const p of pages) {
    const key = p.candidateId || p.studentName || 'student';
    let folder = folders.get(key);
    if (!folder) {
      const base = (p.studentName || `Student ${folders.size + 1}`).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || `Student ${folders.size + 1}`;
      folder = base;
      for (let n = 2; used.has(folder.toLowerCase()); n++) folder = `${base} (${n})`;
      used.add(folder.toLowerCase());
      folders.set(key, folder);
    }
    const n = (count.get(folder) ?? 0) + 1;
    count.set(folder, n);
    const [, mime = 'image/jpeg', b64 = ''] = /^data:([^;]+);base64,(.*)$/.exec(p.dataUrl) ?? [];
    zip.file(`scans/${folder}/page-${String(n).padStart(2, '0')}.${mime.includes('png') ? 'png' : 'jpg'}`, b64, { base64: true });
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h');
  return new File([blob], `Camera scans ${stamp}.zip`, { type: 'application/zip' });
}

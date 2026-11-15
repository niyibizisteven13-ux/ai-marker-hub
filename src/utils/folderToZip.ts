import JSZip from 'jszip';
import { SKIP_DIRS } from '../../shared/handInTypes';

/**
 * A folder a student picked (the browser gives every file inside, with its path) → one ZIP file to hand in.
 * Libraries, version-control data and build output are left out (the same folders the server ignores), so a
 * project folder stays small. Throws a plain message when nothing is left or the ZIP would be too big.
 */
export async function folderToZip(list: FileList | File[], maxBytes: number): Promise<{ file: File; included: number; skipped: number }> {
  const all = [...list] as Array<File & { webkitRelativePath?: string }>;
  if (!all.length) throw new Error('That folder is empty.');
  const root = (all[0].webkitRelativePath ?? '').split('/')[0] || 'folder';
  const zip = new JSZip();
  let included = 0, skipped = 0, bytes = 0;
  for (const f of all) {
    const rel = f.webkitRelativePath || f.name;
    if (SKIP_DIRS.test(rel) || /(^|\/)\./.test(rel)) { skipped++; continue; }
    bytes += f.size;
    if (bytes > maxBytes * 4) throw new Error(`This folder is too large (over ${Math.round((maxBytes * 4) / 1048576)} MB before zipping). Remove videos, libraries and build output, then try again.`);
    zip.file(rel, f); included++;
  }
  if (!included) throw new Error('Nothing in that folder can be handed in (libraries and hidden files are left out).');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (blob.size > maxBytes) throw new Error(`The zipped folder is ${(blob.size / 1048576).toFixed(1)} MB; the limit is ${Math.round(maxBytes / 1048576)} MB. Remove large files and try again.`);
  return { file: new File([blob], `${root.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60)}.zip`, { type: 'application/zip' }), included, skipped };
}

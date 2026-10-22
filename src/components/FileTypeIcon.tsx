import React from 'react';
import { FileArchive, FileCode2, FileImage, FileSpreadsheet, FileText, FileType2, Presentation, Braces, File as FileIcon, TriangleAlert, type LucideIcon } from 'lucide-react';

/**
 * One modern line icon per file type, on a soft tinted tile. Used wherever a file appears (composer
 * attachments, chat file chips, downloads) instead of emoji, so icons look the same on every device.
 */

export type FileKind = 'image' | 'pdf' | 'word' | 'sheet' | 'slides' | 'code' | 'data' | 'archive' | 'doc';

const KINDS: Record<FileKind, { icon: LucideIcon; label: string; tone: string }> = {
  image: { icon: FileImage, label: 'Image', tone: 'bg-sky-500/12 text-sky-400 ring-sky-400/20' },
  pdf: { icon: FileType2, label: 'PDF', tone: 'bg-rose-500/12 text-rose-400 ring-rose-400/20' },
  word: { icon: FileText, label: 'Word', tone: 'bg-blue-500/12 text-blue-400 ring-blue-400/20' },
  sheet: { icon: FileSpreadsheet, label: 'Spreadsheet', tone: 'bg-emerald-500/12 text-emerald-400 ring-emerald-400/20' },
  slides: { icon: Presentation, label: 'Presentation', tone: 'bg-orange-500/12 text-orange-400 ring-orange-400/20' },
  code: { icon: FileCode2, label: 'Code', tone: 'bg-violet-500/12 text-violet-400 ring-violet-400/20' },
  data: { icon: Braces, label: 'Data', tone: 'bg-amber-500/12 text-amber-400 ring-amber-400/20' },
  archive: { icon: FileArchive, label: 'Archive', tone: 'bg-stone-400/12 text-stone-300 ring-stone-300/20' },
  doc: { icon: FileIcon, label: 'Document', tone: 'bg-white/[0.06] text-[#C2C0B6] ring-white/10' },
};

export function fileKind(fileName: string, mimeType?: string): FileKind {
  const lower = (fileName || '').toLowerCase();
  const ext = lower.split('.').pop() || '';
  if (mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)$/.test(lower)) return 'image';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext) || mimeType?.includes('word')) return 'word';
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods'].includes(ext) || mimeType?.includes('excel') || mimeType?.includes('spreadsheet')) return 'sheet';
  if (['ppt', 'pptx', 'odp'].includes(ext) || mimeType?.includes('presentation')) return 'slides';
  if (/\.(js|ts|tsx|jsx|py|java|kt|cpp|c|h|cs|rs|go|rb|php|swift|sql|html|css|scss|sh|bash|ipynb)$/.test(lower)) return 'code';
  if (['json', 'yaml', 'yml', 'xml', 'toml', 'ini'].includes(ext)) return 'data';
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archive';
  return 'doc';
}

export const fileKindLabel = (kind: FileKind) => KINDS[kind].label;

export function FileTypeIcon({ name, mimeType, kind, size = 'md', failed = false }: { name?: string; mimeType?: string; kind?: FileKind; size?: 'sm' | 'md'; failed?: boolean }) {
  const k = kind ?? fileKind(name ?? '', mimeType);
  const def = failed ? { icon: TriangleAlert, tone: 'bg-rose-500/12 text-rose-400 ring-rose-400/20' } : KINDS[k];
  const Icon = def.icon;
  const box = size === 'sm' ? 'h-6 w-6 rounded-md' : 'h-8 w-8 rounded-lg';
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center ring-1 ring-inset ${box} ${def.tone}`}>
      <Icon size={size === 'sm' ? 13 : 16} strokeWidth={1.9} />
    </span>
  );
}

import React, { useEffect, useState } from 'react';
import { authFetch } from '../utils/authFetch';

export default function ScanPageThumbnail({ examId, submissionId, page, active, onClick }: {
  examId: string; submissionId: string; page: number; active: boolean; onClick: () => void;
}) {
  const [source, setSource] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let url = '';
    void (async () => {
      const response = await authFetch(`/api/exams/${examId}/submissions/${submissionId}/pages/${page}?thumbnail=1`, { signal: controller.signal });
      if (!response.ok) return;
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setSource(url);
    })().catch(() => undefined);
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [examId, submissionId, page]);
  return <button aria-label={`Open scanned page ${page}`} aria-current={active ? 'page' : undefined} onClick={onClick}
    className={`scan-thumbnail relative h-20 w-14 shrink-0 overflow-hidden rounded border-2 bg-white ${active ? 'border-[var(--brand)]' : 'border-[#E8E4DC]'}`}>
    {source && <img src={source} alt="" className="h-full w-full object-contain" />}
    <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{page}</span>
  </button>;
}

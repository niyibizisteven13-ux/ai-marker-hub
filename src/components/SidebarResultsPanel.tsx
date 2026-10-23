import React, { useMemo, useState } from 'react';
import { Download, Search, ChevronRight, FileSpreadsheet, X } from 'lucide-react';

export interface StudentResult {
  id: string;
  name: string;
  score: number;
  maxScore: number;
  status: 'Passed' | 'Needs Review' | 'Failed';
  flaggedReason?: string;
}

interface SidebarResultsPanelProps {
  batchTitle: string;
  excelDownloadUrl?: string | null;
  isGenerating: boolean;
  results: StudentResult[];
  onClose: () => void;
  onGenerateExcel: () => void;
}

export const SidebarResultsPanel: React.FC<SidebarResultsPanelProps> = ({
  batchTitle,
  excelDownloadUrl,
  isGenerating,
  results,
  onClose,
  onGenerateExcel,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filteredResults = useMemo(() => {
    return results.filter((res) => {
      const matchesSearch =
        res.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        res.id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        filterStatus === 'all' ||
        res.status.toLowerCase() === filterStatus.toLowerCase();
      return matchesSearch && matchesStatus;
    });
  }, [results, searchQuery, filterStatus]);

  const classAverage = useMemo(() => {
    if (results.length === 0) return '0.0';
    const average =
      results.reduce((acc, curr) => acc + (curr.score / Math.max(curr.maxScore, 1)) * 100, 0) /
      results.length;
    return average.toFixed(1);
  }, [results]);

  return (
    <aside className="w-full h-full bg-[#171717] flex flex-col text-neutral-100">
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#D97757]/15 text-[#E8A08A] flex items-center justify-center">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-semibold text-neutral-100">{batchTitle}</h3>
            <p className="text-[10px] text-neutral-400">
              {results.length ? `${results.length} script${results.length === 1 ? '' : 's'} · class average ${classAverage}%` : 'No marked scripts yet'}
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-white/10 text-neutral-400 hover:text-white transition"
          title="Close results panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {results.length > 0 && <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-neutral-100">Excel gradebook</p>
          <p className="text-[11px] text-neutral-400">Summary sheet and marks per question</p>
        </div>

        {excelDownloadUrl ? (
          <a
            href={excelDownloadUrl}
            download={`Bwenge_Gradebook_${batchTitle.replace(/\s+/g, '_')}.xlsx`}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 bg-[#D97757] text-white hover:bg-[#c66849] transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Excel</span>
          </a>
        ) : (
          <button
            onClick={onGenerateExcel}
            disabled={isGenerating}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition ${
              isGenerating
                ? 'bg-white/10 text-neutral-400 cursor-wait'
                : 'bg-white/10 text-neutral-200 hover:bg-white/15'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isGenerating ? 'Generating…' : 'Create Excel'}</span>
          </button>
        )}
      </div>}

      <div className="p-3 border-b border-white/5 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-neutral-500" />
          <input
            type="text"
            placeholder="Search student or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#0F0F0F] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-[#D97757]/60"
          />
        </div>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-[#0F0F0F] border border-white/10 text-xs text-neutral-300 rounded-xl px-2.5 py-1.5 focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="passed">Passed</option>
          <option value="needs review">Needs Review</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {results.length === 0 && (
          <div className="mx-auto mt-10 max-w-xs text-center">
            <p className="text-sm font-semibold text-neutral-100">Nothing marked yet</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-400">Send the students' scripts in the chat and say "mark these". The marked PDFs and the results appear here and on the <a href="/exams" className="text-[#E8A08A] underline">results page</a>.</p>
          </div>
        )}
        {results.length > 0 && filteredResults.length === 0 && <p className="mt-6 text-center text-xs text-neutral-500">No student matches the search.</p>}
        {filteredResults.map((item) => (
          <div
            key={item.id}
            className="bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/15 rounded-2xl p-3 flex items-center justify-between transition group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-2 h-8 rounded-full ${
                  item.status === 'Passed' ? 'bg-emerald-500' : item.status === 'Needs Review' ? 'bg-amber-500' : 'bg-red-500'
                }`}
              />
              <div>
                <p className="text-xs font-semibold text-neutral-200 group-hover:text-white transition">{item.name}</p>
                <p className="text-[10px] font-mono text-neutral-500">ID: {item.id}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs font-bold text-neutral-100">
                  {item.score} <span className="text-neutral-500 font-normal">/ {item.maxScore}</span>
                </p>
                <p
                  className={`text-[10px] font-medium ${
                    item.status === 'Passed' ? 'text-emerald-400' : item.status === 'Needs Review' ? 'text-amber-400' : 'text-red-400'
                  }`}
                >
                  {item.status}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-neutral-300 transition" />
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};

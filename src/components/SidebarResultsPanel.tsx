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
    <aside className="w-full h-full bg-[#181a20] border-l border-white/10 shadow-2xl z-10 flex flex-col text-neutral-100">
      <div className="p-4 border-b border-white/10 flex items-center justify-between bg-[#1e2025]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-semibold text-neutral-100">{batchTitle}</h3>
            <p className="text-[10px] text-neutral-400">
              {results.length} Sheets Processed • Class Avg: {classAverage}%
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

      <div className="p-4 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-amber-300">Excel Gradebook Ready</p>
          <p className="text-[11px] text-amber-200/70">Includes summary tab & itemized rubrics</p>
        </div>

        {excelDownloadUrl ? (
          <a
            href={excelDownloadUrl}
            download={`Bwenge_Gradebook_${batchTitle.replace(/\s+/g, '_')}.xlsx`}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 bg-amber-500 text-black hover:bg-amber-400 shadow-md shadow-amber-500/20 transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export .XLSX</span>
          </a>
        ) : (
          <button
            onClick={onGenerateExcel}
            disabled={isGenerating}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition ${
              isGenerating
                ? 'bg-white/10 text-neutral-400 cursor-wait'
                : 'bg-white/5 text-neutral-500 hover:bg-white/10 hover:text-neutral-100'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isGenerating ? 'Generating...' : 'Create .XLSX'}</span>
          </button>
        )}
      </div>

      <div className="p-3 border-b border-white/5 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-neutral-500" />
          <input
            type="text"
            placeholder="Search student or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#121316] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-[#121316] border border-white/10 text-xs text-neutral-300 rounded-xl px-2.5 py-1.5 focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="passed">Passed</option>
          <option value="needs review">Needs Review</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredResults.map((item) => (
          <div
            key={item.id}
            className="bg-[#1e2025] hover:bg-[#252830] border border-white/5 hover:border-white/15 rounded-2xl p-3 flex items-center justify-between transition group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-2 h-8 rounded-full ${
                  item.status === 'Passed' ? 'bg-emerald-500' : item.status === 'Needs Review' ? 'bg-amber-500' : 'bg-red-500'
                }`}
              />
              <div>
                <p className="text-xs font-semibold text-neutral-200 group-hover:text-amber-400 transition">{item.name}</p>
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

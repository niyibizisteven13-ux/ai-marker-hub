import React from 'react';
import { StudentScript } from '../types';

interface ResultsViewProps {
  studentScripts: StudentScript[];
}

function downloadBlob(filename: string, content: string, type = 'text/csv') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function scriptsToCsv(scripts: StudentScript[]) {
  const headers = ['Student Name', 'Student ID', 'Status', 'Score', 'Max Marks', 'Percentage', 'Flags'];
  const rows = scripts.map((s) => [
    s.studentName || '',
    s.studentId || '',
    s.status || '',
    s.totalAwardedMarks != null ? String(s.totalAwardedMarks) : '',
    s.maxTotalMarks != null ? String(s.maxTotalMarks) : '',
    s.percentage != null ? String(s.percentage) : '',
    (s.flags || []).join('; '),
  ]);

  return [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

export const ResultsView: React.FC<ResultsViewProps> = ({ studentScripts }) => {
  const handleExportCSV = () => {
    const csv = scriptsToCsv(studentScripts);
    downloadBlob('marker-results.csv', csv, 'text/csv');
  };

  const handleExportJSON = () => {
    downloadBlob('marker-results.json', JSON.stringify(studentScripts, null, 2), 'application/json');
  };

  const handleCopyClipboard = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(studentScripts, null, 2));
      alert('Results copied to clipboard');
    } catch (e) {
      alert('Failed to copy to clipboard');
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Results Export</h2>
        <div className="flex items-center gap-2">
          <button onClick={handleExportCSV} className="px-3 py-1 rounded bg-[#D97757] text-white">Export CSV</button>
          <button onClick={handleExportJSON} className="px-3 py-1 rounded bg-[#444] text-white">Export JSON</button>
          <button onClick={handleCopyClipboard} className="px-3 py-1 rounded bg-[#222] text-white">Copy JSON</button>
        </div>
      </div>

      <div className="overflow-auto rounded border border-[#E8E4DC] dark:border-[#2D2D32] p-2 bg-white dark:bg-[#1C1C20]">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[#666] dark:text-[#AAA]">
              <th className="p-2">Student</th>
              <th className="p-2">ID</th>
              <th className="p-2">Status</th>
              <th className="p-2">Score</th>
              <th className="p-2">Max</th>
              <th className="p-2">%</th>
              <th className="p-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {studentScripts.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-xs text-[#777]">No results available</td>
              </tr>
            )}
            {studentScripts.map((s) => (
              <tr key={s.id} className="border-t border-[#F0EFEA] dark:border-[#262626]">
                <td className="p-2">{s.studentName}</td>
                <td className="p-2">{s.studentId}</td>
                <td className="p-2">{s.status}</td>
                <td className="p-2">{s.totalAwardedMarks ?? ''}</td>
                <td className="p-2">{s.maxTotalMarks ?? ''}</td>
                <td className="p-2">{s.percentage ?? ''}</td>
                <td className="p-2">{(s.flags || []).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

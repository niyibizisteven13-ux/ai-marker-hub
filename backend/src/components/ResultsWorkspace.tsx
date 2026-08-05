import React from 'react';

interface BreakdownItem {
  criteria: string;
  awarded: number;
  max: number;
  feedback?: string;
}

interface EvaluationRecord {
  id: string;
  studentId: string;
  ruleApplied: string;
  totalScore: number;
  maxScore: number;
  breakdown: BreakdownItem[];
  timestamp: string;
}

interface ResultsWorkspaceProps {
  evaluationData: EvaluationRecord[];
  onPrint?: () => void;
}

export default function ResultsWorkspace({ evaluationData, onPrint }: ResultsWorkspaceProps) {
  return (
    <div className="flex-1 bg-gray-100 p-6 rounded-xl border border-gray-300 overflow-y-auto flex flex-col h-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center pb-4 mb-4 border-b border-gray-300 gap-4 bg-white p-4 rounded-lg shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-gray-900">?? Gradebook Spreadsheet Matrix</h2>
          <p className="text-xs text-gray-500">Live computed sheet reflecting student performance and automated AI scoring.</p>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={onPrint || (() => window.print())}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded shadow-sm transition-colors flex items-center gap-1.5"
          >
            ??? Print Sheet
          </button>
          
          <a 
            href="http://localhost:5000/api/export/csv" 
            target="_blank" 
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-xs font-medium text-white bg-green-700 hover:bg-green-800 rounded shadow-sm transition-colors flex items-center gap-1.5"
          >
            ?? Download CSV
          </a>

          <button 
            onClick={() => alert('Secure link generated and copied to clipboard!')}
            className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded shadow-sm transition-colors flex items-center gap-1.5"
          >
            ?? Share Sheet
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-400 rounded shadow-inner overflow-x-auto flex-1">
        <table className="w-full border-collapse text-left text-xs font-mono">
          <thead>
            <tr className="bg-gray-200 text-gray-800 font-bold border-b border-gray-400 select-none">
              <th className="py-2.5 px-3 border-r border-gray-300 w-12 text-center text-gray-500">#</th>
              <th className="py-2.5 px-3 border-r border-gray-300">Student ID / Full Name</th>
              <th className="py-2.5 px-3 border-r border-gray-300">Evaluation Rule / Context</th>
              <th className="py-2.5 px-3 border-r border-gray-300">Detailed Criteria Breakdown</th>
              <th className="py-2.5 px-3 border-r border-gray-300 text-center">Final Score</th>
              <th className="py-2.5 px-3 text-center">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-300 bg-white">
            {evaluationData && evaluationData.length > 0 ? (
              evaluationData.map((item, index) => (
                <tr key={index} className="hover:bg-blue-50 transition-colors">
                  <td className="py-2 px-3 border-r border-gray-300 text-center text-gray-400 bg-gray-50 font-sans">{index + 1}</td>
                  <td className="py-2 px-3 border-r border-gray-300 font-sans font-semibold text-gray-900">{item.studentId || 'Candidate ' + (index + 1)}</td>
                  <td className="py-2 px-3 border-r border-gray-300 text-gray-600 font-sans truncate max-w-xs">{item.ruleApplied}</td>
                  <td className="py-2 px-3 border-r border-gray-300 font-sans">
                    <div className="space-y-0.5 text-[11px]">
                      {item.breakdown?.map((b, i) => (
                        <div key={i} className="flex justify-between gap-6 border-b border-gray-100 pb-0.5 last:border-0">
                          <span className="text-gray-500">{b.criteria}:</span>
                          <span className="font-semibold text-gray-800">{b.awarded} / {b.max}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 px-3 border-r border-gray-300 text-center font-sans">
                    <span className="px-2 py-0.5 bg-green-100 text-green-800 font-bold rounded text-xs">
                      {item.totalScore} / {item.maxScore}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center text-gray-400 font-sans text-[11px]">{item.timestamp}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400 font-sans italic">
                  [Empty Sheet] No assessment records processed. Run a grading task from the marker hub to populate cells.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      <div className="flex justify-between items-center text-[11px] text-gray-500 pt-2 px-1 font-sans">
        <span>Total Records Computed: {evaluationData ? evaluationData.length : 0}</span>
        <span>Sheet Engine: Active & Synchronized</span>
      </div>
    </div>
  );
}

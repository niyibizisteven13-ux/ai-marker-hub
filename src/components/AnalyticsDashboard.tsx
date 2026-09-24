import React from 'react';

interface Chart {
  type: 'bar' | 'pie' | 'line';
  title: string;
  labels: string[];
  data: number[];
}

interface AnalyticsData {
  summary: string;
  charts: Chart[];
  anomalies: string[];
}

export default function AnalyticsDashboard({ data }: { data: string }) {
  const parsedData: AnalyticsData = JSON.parse(data);

  return (
    <div className="space-y-8 p-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-slate-100">Agentic Analytics Report</h2>
        <p className="text-sm text-slate-400 leading-relaxed">{parsedData.summary}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {parsedData.charts.map((chart, idx) => (
          <div key={idx} className="rounded-3xl border border-slate-800 bg-[#0D111A] p-6 space-y-4 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">{chart.title}</h3>

            <div className="space-y-3">
              {chart.labels.map((label, lIdx) => {
                const value = chart.data[lIdx];
                const max = Math.max(...chart.data);
                const percent = (value / max) * 100;

                return (
                  <div key={lIdx} className="space-y-1">
                    <div className="flex justify-between text-[11px] font-medium text-slate-300">
                      <span>{label}</span>
                      <span className="text-orange-400">{value}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-orange-600 to-orange-400 rounded-full transition-all duration-1000"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {parsedData.anomalies.length > 0 && (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-6 space-y-3">
          <h3 className="text-sm font-bold text-amber-400">Outlier Detection & Observations</h3>
          <ul className="list-disc list-inside space-y-1">
            {parsedData.anomalies.map((a, i) => (
              <li key={i} className="text-xs text-amber-200/70 italic">"{a}"</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

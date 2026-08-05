import React, { useState } from 'react';
import { ExamPaper, StudentScript } from '../types';
import { Bot, Sparkles, Loader2, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw, ShieldAlert } from 'lucide-react';

interface Step4AIMarksProps {
  examPaper: ExamPaper;
  studentScripts: StudentScript[];
  setStudentScripts: React.Dispatch<React.SetStateAction<StudentScript[]>>;
  onProceed: () => void;
}

export const Step4AIMarks: React.FC<Step4AIMarksProps> = ({
  examPaper,
  studentScripts,
  setStudentScripts,
  onProceed,
}) => {
  const [isMarking, setIsMarking] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pendingScripts = studentScripts.filter((s) => s.status === 'pending');
  const markedScripts = studentScripts.filter((s) => s.status === 'marked' || s.status === 'approved');

  const handleStartBatchMarking = async () => {
    setIsMarking(true);
    setErrorMsg(null);
    setLogs(['🤖 Initializing Bwenge AI marking workflow...']);

    for (let i = 0; i < studentScripts.length; i++) {
      const script = studentScripts[i];
      if (script.status === 'marked' || script.status === 'approved') continue;

      setCurrentIndex(i + 1);
      setLogs((prev) => [
        `🔍 Evaluating script ${i + 1}/${studentScripts.length}: ${script.studentName}...`,
        ...prev,
      ]);

      try {
        const res = await fetch('/api/mark-script', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            examPaper,
            studentScript: script,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Failed to mark ${script.studentName}'s script.`);
        }

        const markedResult: StudentScript = data.markedScript;

        // Log criteria summary & flags
        const flagInfo = markedResult.flags && markedResult.flags.length > 0
          ? `🚩 Flag raised: [${markedResult.flags.join(', ')}]`
          : '✅ Score verified against criteria';

        setLogs((prev) => [
          `✨ Finished ${script.studentName}: Awarded ${markedResult.totalAwardedMarks}/${markedResult.maxTotalMarks} (${markedResult.percentage}%) • ${flagInfo}`,
          ...prev,
        ]);

        // Update state
        setStudentScripts((prev) =>
          prev.map((s) => (s.id === script.id ? markedResult : s))
        );
      } catch (err: any) {
        console.error(err);
        setLogs((prev) => [
          `❌ Error marking ${script.studentName}: ${err.message}`,
          ...prev,
        ]);
        setErrorMsg(`Failed marking one or more scripts: ${err.message}`);
      }
    }

    setIsMarking(false);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      {/* Top Banner */}
      <div className="bg-[#0A1128] border border-white/10 text-white rounded-sm p-6 sm:p-8 shadow-2xl relative overflow-hidden blueprint-grid">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-xs bg-cyan-500/10 text-[#4CC9F0] text-xs font-mono font-bold mb-3 border border-[#4CC9F0]/30 uppercase tracking-widest">
            <Bot className="w-3 h-3 text-[#4CC9F0]" />
            <span>STEP 04 // AI MARKING ENGINE</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight uppercase font-sans">
            AI AUTO-SCORING & <span className="text-[#4CC9F0]">EVIDENCE EVALUATION</span>
          </h1>
          <p className="mt-2 text-white/70 text-sm sm:text-base leading-relaxed">
            Bwenge AI evaluates every student answer against the rubric criteria, awards partial points, generates constructive feedback, and flags anomalies for human review.
          </p>
        </div>
      </div>

      {/* Control Card */}
      <div className="bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 rounded-sm p-6 sm:p-8 shadow-xl space-y-6 marker-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="label-tag">AUTOMATED QUEUE</span>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white uppercase tracking-tight flex items-center space-x-2 mt-0.5">
              <Sparkles className="w-5 h-5 text-[#4CC9F0]" />
              <span>Batch Marking Queue</span>
            </h2>
            <p className="text-xs font-mono text-slate-500 dark:text-white/60 mt-1">
              {markedScripts.length} of {studentScripts.length} scripts marked • {pendingScripts.length} pending
            </p>
          </div>

          <button
            onClick={handleStartBatchMarking}
            disabled={isMarking || studentScripts.length === 0}
            className={`px-8 py-3 bg-[#4CC9F0] text-[#0A1128] font-extrabold text-xs uppercase tracking-widest shadow-[0_0_15px_rgba(76,201,240,0.4)] flex items-center justify-center space-x-2 transition-all ${
              isMarking
                ? 'opacity-70 cursor-wait'
                : 'hover:bg-[#3db8dd]'
            }`}
          >
            {isMarking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Marking Script {currentIndex} of {studentScripts.length}...</span>
              </>
            ) : markedScripts.length > 0 ? (
              <>
                <RefreshCw className="w-4 h-4" />
                <span>RE-MARK ALL SCRIPTS WITH AI</span>
              </>
            ) : (
              <>
                <Bot className="w-4 h-4" />
                <span>START AI BATCH MARKING ({studentScripts.length} SCRIPTS)</span>
              </>
            )}
          </button>
        </div>

        {errorMsg && (
          <div className="p-4 rounded-xs bg-rose-500/10 border border-rose-500/30 text-rose-300 font-mono text-xs">
            {errorMsg}
          </div>
        )}

        {/* Live Execution Logs Feed */}
        <div className="bg-slate-950 text-white/90 rounded-xs p-5 font-mono text-xs space-y-2 border border-white/10 max-h-60 overflow-y-auto shadow-inner">
          <div className="flex items-center justify-between text-[#4CC9F0] pb-2 border-b border-white/10 text-[10px] uppercase tracking-widest font-bold">
            <span>AI LIVE EXECUTION FEED</span>
            <span>BWENGE AI REVIEW ENGINE</span>
          </div>
          {logs.length === 0 ? (
            <p className="text-slate-500 italic py-2">Click "START AI BATCH MARKING" to launch real-time evaluation...</p>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className="leading-relaxed">
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Marked Scripts Status Overview */}
      {markedScripts.length > 0 && (
        <div className="bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 rounded-sm p-6 shadow-xl space-y-4">
          <span className="label-tag">EVALUATION SUMMARY</span>
          <h3 className="font-extrabold text-base text-slate-900 dark:text-white uppercase tracking-tight flex items-center space-x-2 mt-0.5">
            <CheckCircle2 className="w-5 h-5 text-[#4CC9F0]" />
            <span>Marked Scripts Summary</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {studentScripts.map((s) => {
              const isDone = s.status === 'marked' || s.status === 'approved';
              const hasFlags = s.flags && s.flags.length > 0;

              return (
                <div
                  key={s.id}
                  className={`p-4 rounded-xs border transition-all ${
                    isDone
                      ? hasFlags
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                        : 'border-[#4CC9F0]/40 bg-cyan-500/10 text-white'
                      : 'border-white/10 bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-center justify-between font-mono">
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white font-sans uppercase">
                      {s.studentName}
                    </h4>
                    {isDone ? (
                      <span className="font-extrabold text-[#4CC9F0] text-sm">
                        {s.totalAwardedMarks}/{s.maxTotalMarks} ({s.percentage}%)
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Pending</span>
                    )}
                  </div>

                  {hasFlags && (
                    <div className="mt-2.5 flex items-center space-x-1 text-xs font-mono font-bold text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-xs border border-amber-500/30 w-fit uppercase">
                      <ShieldAlert className="w-3.5 h-3.5 mr-1" />
                      <span>Flag: {s.flags?.join(', ')}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Proceed CTA */}
      <div className="flex justify-end pt-4">
        <button
          onClick={onProceed}
          disabled={markedScripts.length === 0}
          className={`px-8 py-3 bg-[#4CC9F0] text-[#0A1128] font-extrabold text-xs uppercase tracking-widest transition-all ${
            markedScripts.length === 0
              ? 'opacity-40 cursor-not-allowed bg-slate-700 text-slate-400'
              : 'hover:bg-[#3db8dd] shadow-[0_0_15px_rgba(76,201,240,0.4)]'
          } flex items-center space-x-2`}
        >
          <span>PROCEED TO STEP 5 (TEACHER REVIEW)</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

};

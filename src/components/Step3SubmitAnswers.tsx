import React, { useState } from 'react';
import { ExamPaper, StudentScript } from '../types';
import { SAMPLE_STUDENT_SCRIPTS } from '../data/sampleExams';
import { Inbox, Upload, Plus, Trash2, ArrowRight, UserCheck, Eye, FileText, CheckCircle2 } from 'lucide-react';

interface Step3SubmitAnswersProps {
  examPaper: ExamPaper;
  studentScripts: StudentScript[];
  setStudentScripts: React.Dispatch<React.SetStateAction<StudentScript[]>>;
  onProceed: () => void;
}

export const Step3SubmitAnswers: React.FC<Step3SubmitAnswersProps> = ({
  examPaper,
  studentScripts,
  setStudentScripts,
  onProceed,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentId, setNewStudentId] = useState('');
  const [newAnswers, setNewAnswers] = useState<{ [qId: string]: string }>({});
  const [selectedScriptForView, setSelectedScriptForView] = useState<StudentScript | null>(null);

  const handleLoadSampleClass = () => {
    // Append sample scripts to existing ones instead of replacing them
    setStudentScripts((prev) => {
      const existingIds = new Set(prev.map((s) => s.id));
      const newScripts = SAMPLE_STUDENT_SCRIPTS.filter((s) => !existingIds.has(s.id));
      return [...prev, ...newScripts];
    });
  };

  const handleAddCustomScript = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudentName) return;

    const answersArray = examPaper.questions.map((q) => ({
      questionId: q.id,
      questionNumber: q.number,
      answerText: newAnswers[q.id] || '[No Answer Provided]',
    }));

    const newScript: StudentScript = {
      id: `script-${Date.now()}`,
      studentName: newStudentName,
      studentId: newStudentId || `ST-${Math.floor(1000 + Math.random() * 9000)}`,
      submittedAt: new Date().toISOString(),
      status: 'pending',
      answers: answersArray,
    };

    setStudentScripts([...studentScripts, newScript]);
    setShowAddModal(false);
    setNewStudentName('');
    setNewStudentId('');
    setNewAnswers({});
  };

  const handleDeleteScript = (id: string) => {
    setStudentScripts(studentScripts.filter((s) => s.id !== id));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files) as File[];
    fileList.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const studentName = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

        const answersArray = examPaper.questions.map((q) => ({
          questionId: q.id,
          questionNumber: q.number,
          answerText: text.slice(0, 1000) || 'Uploaded script content...',
        }));

        const newScript: StudentScript = {
          id: `script-upload-${Date.now()}-${index}`,
          studentName,
          studentId: `UP-${1000 + index}`,
          submittedAt: new Date().toISOString(),
          status: 'pending',
          rawText: text,
          fileName: file.name,
          answers: answersArray,
        };

        setStudentScripts((prev) => [...prev, newScript]);
      };
      reader.readAsText(file);
    });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      {/* Top Banner */}
      <div className="bg-[#0A1128] border border-white/10 text-white rounded-sm p-6 sm:p-8 shadow-2xl relative overflow-hidden blueprint-grid">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-xs bg-cyan-500/10 text-[#4CC9F0] text-xs font-mono font-bold mb-3 border border-[#4CC9F0]/30 uppercase tracking-widest">
            <Inbox className="w-3 h-3 text-[#4CC9F0]" />
            <span>STEP 03 // STUDENT SUBMISSIONS</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight uppercase font-sans">
            SUBMIT STUDENT <span className="text-[#4CC9F0]">ANSWER SCRIPTS</span>
          </h1>
          <p className="mt-2 text-white/70 text-sm sm:text-base leading-relaxed">
            Bulk upload PDF/photo/typed scripts, load pre-built demo class scripts, or manually input individual student answers for batch AI marking.
          </p>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Load Sample Demo Scripts Button */}
        <button
          onClick={handleLoadSampleClass}
          className="p-5 rounded-sm bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 hover:border-[#4CC9F0] text-left transition-all group marker-card"
        >
          <div className="flex items-center justify-between mb-2">
            <UserCheck className="w-6 h-6 text-[#4CC9F0]" />
            <span className="text-[10px] font-bold font-mono bg-cyan-500/10 text-[#4CC9F0] px-2 py-0.5 rounded-xs border border-[#4CC9F0]/30 uppercase tracking-widest">
              INSTANT DEMO
            </span>
          </div>
          <h3 className="font-extrabold text-sm text-slate-900 dark:text-white uppercase tracking-tight group-hover:text-[#4CC9F0]">
            Load Sample Class (5 Scripts)
          </h3>
          <p className="text-xs text-slate-500 dark:text-white/60 mt-1 font-mono">
            Includes high score, partial answers, off-topic & plagiarism flag samples.
          </p>
        </button>

        {/* Upload Files Box */}
        <div className="p-5 rounded-sm border-2 border-dashed border-slate-300 dark:border-white/20 hover:border-[#4CC9F0] text-left transition-all relative cursor-pointer flex flex-col justify-between bg-white dark:bg-[#0A1128]/50">
          <input
            type="file"
            multiple
            accept="*/*"
            onChange={handleFileUpload}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
          <div className="flex items-center justify-between mb-2">
            <Upload className="w-6 h-6 text-[#4CC9F0]" />
            <span className="text-[10px] font-bold font-mono text-slate-400 dark:text-white/40 uppercase">DRAG & DROP</span>
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-slate-900 dark:text-white uppercase tracking-tight">
              Bulk Upload Scripts
            </h3>
            <p className="text-xs text-slate-500 dark:text-white/60 mt-1 font-mono">
              Upload multiple student script files (.txt, .pdf, .doc)
            </p>
          </div>
        </div>

        {/* Manual Script Entry Button */}
        <button
          onClick={() => setShowAddModal(true)}
          className="p-5 rounded-sm bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 hover:border-[#4CC9F0] text-left transition-all flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between mb-2">
            <Plus className="w-6 h-6 text-[#4CC9F0]" />
            <span className="text-[10px] font-bold font-mono text-slate-400 dark:text-white/40 uppercase">MANUAL</span>
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-slate-900 dark:text-white uppercase tracking-tight group-hover:text-[#4CC9F0]">
              Type Student Answers
            </h3>
            <p className="text-xs text-slate-500 dark:text-white/60 mt-1 font-mono">
              Add individual student response manually
            </p>
          </div>
        </button>
      </div>

      {/* Scripts Submissions List Table */}
      <div className="bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 rounded-sm p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-white/10">
          <div>
            <span className="label-tag">STUDENT ROSTER</span>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white uppercase tracking-tight mt-0.5">
              Submitted Student Scripts ({studentScripts.length})
            </h2>
            <p className="text-xs font-mono text-slate-500 dark:text-white/60">
              Target Exam: <span className="font-bold text-[#4CC9F0]">{examPaper.title}</span>
            </p>
          </div>

          {studentScripts.length > 0 && (
            <button
              onClick={() => setStudentScripts([])}
              className="text-xs font-mono font-bold text-rose-400 hover:text-rose-300 uppercase tracking-widest"
            >
              Clear All Scripts
            </button>
          )}
        </div>

        {studentScripts.length === 0 ? (
          <div className="p-12 text-center text-slate-400 dark:text-white/40 space-y-3 font-mono">
            <Inbox className="w-12 h-12 mx-auto text-[#4CC9F0]/40" />
            <p className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-white/80">No student scripts submitted yet.</p>
            <p className="text-xs">Click <span className="font-bold text-[#4CC9F0]">Load Sample Class</span> above to test with pre-built student scripts instantly!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-[#4CC9F0]">
                  <th className="py-3 px-4">STUDENT NAME</th>
                  <th className="py-3 px-4">STUDENT ID</th>
                  <th className="py-3 px-4">ANSWERS</th>
                  <th className="py-3 px-4">STATUS</th>
                  <th className="py-3 px-4 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                {studentScripts.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-4 font-bold font-sans text-slate-900 dark:text-white text-sm">
                      {s.studentName}
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 dark:text-white/60">
                      {s.studentId}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 dark:text-white/70">
                      {s.answers.length} answers provided
                    </td>
                    <td className="py-3.5 px-4">
                      {s.status === 'marked' || s.status === 'approved' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-xs text-[10px] font-bold bg-cyan-500/10 text-[#4CC9F0] border border-[#4CC9F0]/30 uppercase tracking-wider">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Marked ({s.percentage}%)
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-xs text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30 uppercase tracking-wider">
                          Ready for AI Marking
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        onClick={() => setSelectedScriptForView(s)}
                        className="p-1.5 rounded-xs text-slate-500 hover:text-[#4CC9F0] hover:bg-cyan-500/10"
                        title="Preview Answers"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteScript(s.id)}
                        className="p-1.5 rounded-xs text-slate-400 hover:text-rose-500 hover:bg-rose-500/10"
                        title="Delete Script"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal for manual entry */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-[#0A1128]/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0A1128] rounded-sm max-w-2xl w-full p-6 space-y-6 shadow-2xl border border-white/20 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-extrabold text-white uppercase tracking-tight font-sans">
              Add Student Script Response
            </h3>
            <form onSubmit={handleAddCustomScript} className="space-y-4 font-mono text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold uppercase text-white/70 mb-1">Student Full Name</label>
                  <input
                    type="text"
                    required
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                    placeholder="e.g. Jordan Smith"
                    className="w-full px-3 py-2 rounded-xs border border-white/10 bg-slate-950 text-white font-sans"
                  />
                </div>
                <div>
                  <label className="block font-bold uppercase text-white/70 mb-1">Student ID / Roll No</label>
                  <input
                    type="text"
                    value={newStudentId}
                    onChange={(e) => setNewStudentId(e.target.value)}
                    placeholder="e.g. ST-2026-099"
                    className="w-full px-3 py-2 rounded-xs border border-white/10 bg-slate-950 text-white"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <h4 className="font-bold text-sm text-white uppercase">Student Answers per Question</h4>
                {examPaper.questions.map((q) => (
                  <div key={q.id} className="space-y-1">
                    <label className="block font-bold text-[#4CC9F0]">
                      {q.number}: {q.questionText} ({q.maxMarks} marks)
                    </label>
                    <textarea
                      rows={2}
                      value={newAnswers[q.id] || ''}
                      onChange={(e) => setNewAnswers({ ...newAnswers, [q.id]: e.target.value })}
                      placeholder="Type student's answer text..."
                      className="w-full px-3 py-2 rounded-xs border border-white/10 bg-slate-950 text-white font-sans"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xs border border-white/20 text-white text-xs font-bold uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 rounded-xs bg-[#4CC9F0] text-[#0A1128] font-extrabold text-xs uppercase tracking-wider"
                >
                  Save Script
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Script View Modal */}
      {selectedScriptForView && (
        <div className="fixed inset-0 z-50 bg-[#0A1128]/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0A1128] rounded-sm max-w-2xl w-full p-6 space-y-4 shadow-2xl border border-white/20 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <h3 className="font-extrabold text-lg text-white font-sans uppercase">
                  {selectedScriptForView.studentName} ({selectedScriptForView.studentId})
                </h3>
                <p className="text-xs font-mono text-white/50">
                  Submitted: {new Date(selectedScriptForView.submittedAt).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setSelectedScriptForView(null)}
                className="px-3 py-1 rounded-xs bg-white/10 text-white text-xs font-mono font-bold uppercase"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 font-mono">
              {selectedScriptForView.answers.map((a) => (
                <div key={a.questionId} className="p-4 rounded-xs bg-white/[0.02] border border-white/10 space-y-1">
                  <span className="font-bold text-xs text-[#4CC9F0]">{a.questionNumber}</span>
                  <p className="text-sm font-sans text-white/90 whitespace-pre-wrap">
                    {a.answerText}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Proceed CTA */}
      <div className="flex justify-end pt-4">
        <button
          onClick={onProceed}
          disabled={studentScripts.length === 0}
          className={`px-8 py-3 bg-[#4CC9F0] text-[#0A1128] font-extrabold text-xs uppercase tracking-widest transition-all ${
            studentScripts.length === 0
              ? 'opacity-40 cursor-not-allowed bg-slate-700 text-slate-400'
              : 'hover:bg-[#3db8dd] shadow-[0_0_15px_rgba(76,201,240,0.4)]'
          } flex items-center space-x-2`}
        >
          <span>PROCEED TO STEP 4 (AI AUTO-MARKING)</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

};

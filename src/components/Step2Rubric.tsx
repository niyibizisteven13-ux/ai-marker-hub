import React, { useState, useRef } from 'react';
import { ExamPaper, QuestionRubric, RubricCriterion } from '../types';
import { FileText, Sparkles, Plus, Trash2, CheckCircle2, ArrowRight, AlertTriangle, RefreshCw, UploadCloud } from 'lucide-react';

interface Step2RubricProps {
  examPaper: ExamPaper;
  setExamPaper: (updated: ExamPaper) => void;
  onProceed: () => void;
}

export const Step2Rubric: React.FC<Step2RubricProps> = ({
  examPaper,
  setExamPaper,
  onProceed,
}) => {
  const [loadingQuestionId, setLoadingQuestionId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleUpdateCriterion = (
    questionId: string,
    criterionId: string,
    field: keyof RubricCriterion,
    value: any
  ) => {
    const updatedRubrics = examPaper.rubrics.map((r) => {
      if (r.questionId === questionId) {
        const updatedCriteria = r.criteria.map((c) => {
          if (c.id === criterionId) {
            return { ...c, [field]: value };
          }
          return c;
        });
        return { ...r, criteria: updatedCriteria };
      }
      return r;
    });

    setExamPaper({ ...examPaper, rubrics: updatedRubrics });
  };

  const handleAddCriterion = (questionId: string) => {
    const updatedRubrics = examPaper.rubrics.map((r) => {
      if (r.questionId === questionId) {
        const newC: RubricCriterion = {
          id: `${questionId}-c-${Date.now()}`,
          criterion: 'New evaluation criterion',
          marksAvailable: 2,
          description: 'Detailed criteria specification',
        };
        return { ...r, criteria: [...r.criteria, newC] };
      }
      return r;
    });

    setExamPaper({ ...examPaper, rubrics: updatedRubrics });
  };

  const handleRemoveCriterion = (questionId: string, criterionId: string) => {
    const updatedRubrics = examPaper.rubrics.map((r) => {
      if (r.questionId === questionId) {
        return {
          ...r,
          criteria: r.criteria.filter((c) => c.id !== criterionId),
        };
      }
      return r;
    });

    setExamPaper({ ...examPaper, rubrics: updatedRubrics });
  };

  const handleAIRefineRubric = async (questionId: string) => {
    const question = examPaper.questions.find((q) => q.id === questionId);
    if (!question) return;

    setLoadingQuestionId(questionId);
    try {
      const res = await fetch('/api/generate-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionText: question.questionText,
          maxMarks: question.maxMarks,
          modelAnswer: question.modelAnswer,
        }),
      });

      const data = await res.json();
      if (data.success && Array.isArray(data.criteria)) {
        const updatedRubrics = examPaper.rubrics.map((r) => {
          if (r.questionId === questionId) {
            return { ...r, criteria: data.criteria };
          }
          return r;
        });
        setExamPaper({ ...examPaper, rubrics: updatedRubrics });
      } else {
        console.warn('AI rubric generation returned invalid criteria:', data);
      }
    } catch (err) {
      console.error('Failed to refine rubric:', err);
      setImportError('Unable to refine rubric with AI. Please try again or edit manually.');
    } finally {
      setLoadingQuestionId(null);
    }
  };

  const normalizeRubricCriteria = (criteria: any[]): RubricCriterion[] => {
    return criteria
      .filter(Boolean)
      .map((item, idx) => ({
        id: String(item.id || item.criterion?.slice(0, 24) || `import-${Date.now()}-${idx}`),
        criterion: String(item.criterion || item.description || item.title || item.text || `Imported criterion ${idx + 1}`),
        marksAvailable: Number(item.marksAvailable ?? item.marks ?? item.value ?? 1),
        description: String(item.description ?? item.details ?? ''),
      }))
      .map((item) => ({
        ...item,
        marksAvailable: Number.isFinite(item.marksAvailable) ? item.marksAvailable : 1,
      }));
  };

  const parseImportedRubricText = (text: string): QuestionRubric[] => {
    const trimmed = text.trim();
    let parsed: any = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }

    if (parsed) {
      if (Array.isArray(parsed)) {
        return [
          {
            questionId: examPaper.questions[0]?.id,
            questionNumber: examPaper.questions[0]?.number,
            maxMarks: examPaper.questions[0]?.maxMarks || 0,
            criteria: normalizeRubricCriteria(parsed),
          },
        ];
      }

      if (Array.isArray(parsed.rubrics)) {
        return parsed.rubrics.map((rubric: any) => ({
          questionId: rubric.questionId || examPaper.questions[0]?.id,
          questionNumber: rubric.questionNumber || examPaper.questions[0]?.number,
          maxMarks: Number(rubric.maxMarks ?? examPaper.questions.find((q) => q.id === rubric.questionId)?.maxMarks ?? examPaper.questions[0]?.maxMarks ?? 0),
          criteria: normalizeRubricCriteria(rubric.criteria ?? rubric.items ?? []),
        }));
      }

      if (Array.isArray(parsed.criteria)) {
        return [
          {
            questionId: examPaper.questions[0]?.id,
            questionNumber: examPaper.questions[0]?.number,
            maxMarks: examPaper.questions[0]?.maxMarks || 0,
            criteria: normalizeRubricCriteria(parsed.criteria),
          },
        ];
      }
    }

    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !/^#{1,3}/.test(line));

    const criteria = lines.map((line, idx) => {
      const markMatch = line.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:marks?|m)\b/i);
      const marks = markMatch ? Number(markMatch[1]) : 1;
      const criterion = line.replace(/^[\-\*\d\.\)\s]*/g, '').replace(/\(?[0-9]+(?:\.[0-9]+)?\s*(?:marks?|m)\)?/i, '').trim();
      return {
        id: `import-${Date.now()}-${idx}`,
        criterion: criterion || line,
        marksAvailable: marks || 1,
        description: '',
      };
    });

    return [
      {
        questionId: examPaper.questions[0]?.id,
        questionNumber: examPaper.questions[0]?.number,
        maxMarks: examPaper.questions[0]?.maxMarks || 0,
        criteria,
      },
    ];
  };

  const handleImportRubricFile = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const importedRubrics = parseImportedRubricText(text);
      if (!importedRubrics.length || importedRubrics.every((r) => !r.criteria.length)) {
        throw new Error('No rubric criteria were detected in the file.');
      }

      const updatedRubrics = examPaper.questions.map((question) => {
        const importedForQuestion = importedRubrics.find((r) => r.questionId === question.id || r.questionNumber === question.number);
        if (importedForQuestion) {
          return {
            questionId: question.id,
            questionNumber: question.number,
            maxMarks: question.maxMarks,
            criteria: importedForQuestion.criteria,
          };
        }

        const existing = examPaper.rubrics.find((r) => r.questionId === question.id);
        return existing || {
          questionId: question.id,
          questionNumber: question.number,
          maxMarks: question.maxMarks,
          criteria: [],
        };
      });

      setExamPaper({ ...examPaper, rubrics: updatedRubrics });
    } catch (error: any) {
      console.error('Rubric import failed:', error);
      setImportError(error?.message || 'Could not import rubric file.');
    }
  };

  const handleRubricFileClick = () => {
    importInputRef.current?.click();
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      {/* Top Banner */}
      <div className="bg-[#0A1128] border border-white/10 text-white rounded-sm p-6 sm:p-8 shadow-2xl relative overflow-hidden blueprint-grid">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-xs bg-cyan-500/10 text-[#4CC9F0] text-xs font-mono font-bold mb-3 border border-[#4CC9F0]/30 uppercase tracking-widest">
            <FileText className="w-3 h-3 text-[#4CC9F0]" />
            <span>STEP 02 // RUBRIC CONFIGURATION</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight uppercase font-sans">
            REVIEW & EDIT <span className="text-[#4CC9F0]">MARKING RUBRIC</span>
          </h1>
          <p className="mt-2 text-white/70 text-sm sm:text-base leading-relaxed">
            AI draft rubric criteria per question. Teachers can edit point allocations, modify criteria, or refine with 1 tap before grading student submissions.
          </p>

          <div className="mt-4 flex flex-wrap gap-3 items-center">
            <button
              type="button"
              onClick={handleRubricFileClick}
              className="inline-flex items-center gap-2 rounded-xs bg-white/10 border border-white/20 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white transition hover:bg-white/15"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Import Rubric File</span>
            </button>

            <span className="text-[11px] text-white/60">
              Upload JSON or text rubric outlines to populate one or more question rubrics.
            </span>
          </div>

          {importError ? (
            <div className="mt-3 rounded-xs bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-[11px] text-rose-600">
              {importError}
            </div>
          ) : null}
        </div>
      </div>

      <input
        type="file"
        ref={importInputRef}
        accept=".json,.txt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportRubricFile(file);
          if (e.target) e.target.value = '';
        }}
      />

      {/* Rubrics Per Question */}
      <div className="space-y-6">
        {examPaper.questions.map((question) => {
          const rubric = examPaper.rubrics.find((r) => r.questionId === question.id) || {
            questionId: question.id,
            questionNumber: question.number,
            maxMarks: question.maxMarks,
            criteria: [],
          };

          const criteriaSum = rubric.criteria.reduce(
            (sum, c) => sum + (Number(c.marksAvailable) || 0),
            0
          );

          const isMatching = criteriaSum === question.maxMarks;

          return (
            <div
              key={question.id}
              className="bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 rounded-sm p-6 shadow-xl space-y-4 marker-card"
            >
              {/* Question Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-white/10">
                <div className="flex items-start space-x-3">
                  <span className="px-2.5 py-1 rounded-xs bg-cyan-500/10 border border-[#4CC9F0]/30 text-[#4CC9F0] font-mono font-extrabold text-sm">
                    {question.number}
                  </span>
                  <div>
                    <h3 className="font-extrabold text-base text-slate-900 dark:text-white uppercase tracking-tight">
                      {question.questionText}
                    </h3>
                    <p className="text-xs font-mono text-slate-500 dark:text-white/60 mt-0.5">
                      Max Marks: <span className="font-bold text-[#4CC9F0]">{question.maxMarks}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  {/* Validation Badge */}
                  <div
                    className={`px-3 py-1 rounded-xs text-xs font-mono font-bold flex items-center space-x-1 border ${
                      isMatching
                        ? 'bg-cyan-500/10 text-[#4CC9F0] border-[#4CC9F0]/30'
                        : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                    }`}
                  >
                    {isMatching ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        <span>Sum: {criteriaSum}/{question.maxMarks} Marks</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                        <span>Mismatch: {criteriaSum} vs {question.maxMarks} Max</span>
                      </>
                    )}
                  </div>

                  {/* AI Refine Button */}
                  <button
                    onClick={() => handleAIRefineRubric(question.id)}
                    disabled={loadingQuestionId === question.id}
                    className="px-3 py-1.5 rounded-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-[#4CC9F0] text-xs font-mono font-bold flex items-center space-x-1.5 border border-[#4CC9F0]/30"
                  >
                    {loadingQuestionId === question.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-[#4CC9F0]" />
                    )}
                    <span>AI REFINE</span>
                  </button>
                </div>
              </div>

              {/* Criteria Table */}
              <div className="space-y-2">
                <div className="grid grid-cols-12 text-[10px] font-bold uppercase tracking-widest text-[#4CC9F0] font-mono px-3 py-1">
                  <div className="col-span-7">CRITERION DESCRIPTION</div>
                  <div className="col-span-3 text-center">MARKS AVAILABLE</div>
                  <div className="col-span-2 text-right">ACTION</div>
                </div>

                {rubric.criteria.map((c) => (
                  <div
                    key={c.id}
                    className="grid grid-cols-12 items-center gap-2 p-3 rounded-xs bg-slate-50/70 dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/10 text-sm"
                  >
                    <div className="col-span-7">
                      <input
                        type="text"
                        value={c.criterion}
                        onChange={(e) =>
                          handleUpdateCriterion(question.id, c.id, 'criterion', e.target.value)
                        }
                        className="w-full px-3 py-1.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-xs font-sans focus:border-[#4CC9F0] outline-none"
                      />
                    </div>

                    <div className="col-span-3 flex justify-center">
                      <input
                        type="number"
                        min="0"
                        max={question.maxMarks}
                        step="0.5"
                        value={c.marksAvailable}
                        onChange={(e) =>
                          handleUpdateCriterion(
                            question.id,
                            c.id,
                            'marksAvailable',
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="w-20 px-2 py-1 text-center font-bold font-mono rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-[#4CC9F0] text-xs focus:border-[#4CC9F0] outline-none"
                      />
                    </div>

                    <div className="col-span-2 flex justify-end">
                      <button
                        onClick={() => handleRemoveCriterion(question.id, c.id)}
                        className="p-1.5 rounded-xs text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                        title="Delete Criterion"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add Criterion Button */}
              <button
                onClick={() => handleAddCriterion(question.id)}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xs text-xs font-mono font-bold text-[#4CC9F0] hover:bg-cyan-500/10 transition-colors border border-dashed border-[#4CC9F0]/30"
              >
                <Plus className="w-4 h-4" />
                <span>ADD CRITERION LINE</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Confirm & Proceed */}
      <div className="flex justify-end pt-4">
        <button
          onClick={onProceed}
          className="px-8 py-3 bg-[#4CC9F0] text-[#0A1128] font-extrabold text-xs uppercase tracking-widest hover:bg-[#3db8dd] transition-all shadow-[0_0_15px_rgba(76,201,240,0.4)] flex items-center space-x-2"
        >
          <span>APPROVE RUBRIC & PROCEED TO STEP 3</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

};

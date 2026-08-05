import React, { useState } from 'react';
import { ExamPaper, ExamGeneratorRequest, Question } from '../types';
import { SAMPLE_EXAMS } from '../data/sampleExams';
import { Sparkles, Upload, FileText, Check, ArrowRight, Loader2, BookOpen, Clock, Award, Plus, Trash2 } from 'lucide-react';

interface Step1CreateUploadProps {
  examPaper: ExamPaper | null;
  setExamPaper: (exam: ExamPaper) => void;
  onProceed: () => void;
}

export const Step1CreateUpload: React.FC<Step1CreateUploadProps> = ({
  examPaper,
  setExamPaper,
  onProceed,
}) => {
  const [mode, setMode] = useState<'sample' | 'ai' | 'upload' | 'manual'>('sample');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // AI Form State
  const [aiForm, setAiForm] = useState<ExamGeneratorRequest>({
    subject: 'Biology',
    topic: 'Cellular Respiration & ATP Synthesis',
    gradeLevel: 'High School AP / Grade 11',
    difficulty: 'Intermediate',
    questionTypes: ['short_answer', 'calculation', 'essay'],
    totalMarks: 30,
    durationMinutes: 45,
    additionalInstructions: 'Include a mix of recall and conceptual application.',
  });

  // Manual Form State
  const [manualTitle, setManualTitle] = useState('Custom Quiz');
  const [manualSubject, setManualSubject] = useState('Mathematics');
  const [manualTopic, setManualTopic] = useState('Algebra & Functions');
  const [manualQuestions, setManualQuestions] = useState<Question[]>([
    {
      id: 'q1',
      number: 'Q1',
      questionText: 'Solve for x: 3x + 12 = 45',
      maxMarks: 5,
      questionType: 'short_answer',
      modelAnswer: '3x = 33 => x = 11',
    },
    {
      id: 'q2',
      number: 'Q2',
      questionText: 'Explain the difference between a function and a relation with examples.',
      maxMarks: 10,
      questionType: 'essay',
      modelAnswer: 'A function maps each input to exactly one output (passes vertical line test). A relation can map an input to multiple outputs.',
    },
  ]);

  const handleGenerateAI = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/generate-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiForm),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate exam.');
      }

      setExamPaper(data.examPaper);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Error communicating with AI Exam Generator.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveManual = () => {
    const totalM = manualQuestions.reduce((sum, q) => sum + (Number(q.maxMarks) || 0), 0);
    const newExam: ExamPaper = {
      id: 'exam-manual-' + Date.now(),
      title: manualTitle,
      subject: manualSubject,
      topic: manualTopic,
      gradeLevel: 'Standard',
      difficulty: 'Intermediate',
      totalMarks: totalM,
      durationMinutes: 30,
      createdAt: new Date().toISOString(),
      questions: manualQuestions,
      rubrics: manualQuestions.map((q) => ({
        questionId: q.id,
        questionNumber: q.number,
        maxMarks: q.maxMarks,
        criteria: [
          {
            id: `${q.id}-c1`,
            criterion: `Correct logic and answer for ${q.number}`,
            marksAvailable: q.maxMarks,
            description: 'Full credit awarded for complete answer matching model key.',
          },
        ],
      })),
    };
    setExamPaper(newExam);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const parsedQuestions: Question[] = [
        {
          id: 'q1',
          number: 'Q1',
          questionText: content.slice(0, 300) || 'Uploaded question 1 content...',
          maxMarks: 10,
          questionType: 'short_answer',
          modelAnswer: 'Key concepts from uploaded script file.',
        },
      ];

      const uploadedExam: ExamPaper = {
        id: 'exam-upload-' + Date.now(),
        title: file.name.replace(/\.[^/.]+$/, ''),
        subject: 'Uploaded Paper',
        topic: 'Custom',
        gradeLevel: 'Custom',
        difficulty: 'Intermediate',
        totalMarks: 10,
        durationMinutes: 30,
        createdAt: new Date().toISOString(),
        questions: parsedQuestions,
        rubrics: [
          {
            questionId: 'q1',
            questionNumber: 'Q1',
            maxMarks: 10,
            criteria: [
              { id: 'u1', criterion: 'Accurate key points addressed', marksAvailable: 10 },
            ],
          },
        ],
      };
      setExamPaper(uploadedExam);
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      {/* Top Banner */}
      <div className="bg-[#0A1128] border border-white/10 text-white rounded-sm p-6 sm:p-8 shadow-2xl relative overflow-hidden blueprint-grid">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-xs bg-cyan-500/10 text-[#4CC9F0] text-xs font-mono font-bold mb-3 border border-[#4CC9F0]/30 uppercase tracking-widest">
            <Sparkles className="w-3 h-3 text-[#4CC9F0]" />
            <span>STEP 01 // EXAM PAPER SETUP</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight uppercase font-sans">
            CREATE OR UPLOAD <span className="text-[#4CC9F0]">EXAM PAPER</span>
          </h1>
          <p className="mt-2 text-white/70 text-sm sm:text-base leading-relaxed">
            Auto-generate a curriculum-aligned exam paper with AI, select a pre-loaded exemplar exam, or upload your own paper and marking key.
          </p>
        </div>
      </div>

      {/* Mode Selector Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          onClick={() => setMode('sample')}
          className={`p-4 rounded-sm text-left border transition-all duration-200 flex flex-col justify-between ${
            mode === 'sample'
              ? 'border-[#4CC9F0] bg-cyan-500/10 text-white shadow-[0_0_15px_rgba(76,201,240,0.2)]'
              : 'border-slate-200 dark:border-white/10 bg-white dark:bg-[#0A1128]/80 hover:bg-slate-50 dark:hover:bg-white/5'
          }`}
        >
          <BookOpen className={`w-6 h-6 mb-2 ${mode === 'sample' ? 'text-[#4CC9F0]' : 'text-slate-400 dark:text-white/40'}`} />
          <div>
            <span className="label-tag block mb-0.5">EXEMPLAR</span>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-tight">Sample Exams</h3>
            <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">Pre-built Physics & CS papers</p>
          </div>
        </button>

        <button
          onClick={() => setMode('ai')}
          className={`p-4 rounded-sm text-left border transition-all duration-200 flex flex-col justify-between ${
            mode === 'ai'
              ? 'border-[#4CC9F0] bg-cyan-500/10 text-white shadow-[0_0_15px_rgba(76,201,240,0.2)]'
              : 'border-slate-200 dark:border-white/10 bg-white dark:bg-[#0A1128]/80 hover:bg-slate-50 dark:hover:bg-white/5'
          }`}
        >
          <Sparkles className={`w-6 h-6 mb-2 ${mode === 'ai' ? 'text-[#4CC9F0]' : 'text-slate-400 dark:text-white/40'}`} />
          <div>
            <span className="label-tag block mb-0.5">GENERATOR</span>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-tight">AI Exam Generator</h3>
            <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">Type topic → AI drafts paper</p>
          </div>
        </button>

        <button
          onClick={() => setMode('upload')}
          className={`p-4 rounded-sm text-left border transition-all duration-200 flex flex-col justify-between ${
            mode === 'upload'
              ? 'border-[#4CC9F0] bg-cyan-500/10 text-white shadow-[0_0_15px_rgba(76,201,240,0.2)]'
              : 'border-slate-200 dark:border-white/10 bg-white dark:bg-[#0A1128]/80 hover:bg-slate-50 dark:hover:bg-white/5'
          }`}
        >
          <Upload className={`w-6 h-6 mb-2 ${mode === 'upload' ? 'text-[#4CC9F0]' : 'text-slate-400 dark:text-white/40'}`} />
          <div>
            <span className="label-tag block mb-0.5">FILE IMPORT</span>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-tight">Upload File</h3>
            <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">PDF, TXT or doc script</p>
          </div>
        </button>

        <button
          onClick={() => setMode('manual')}
          className={`p-4 rounded-sm text-left border transition-all duration-200 flex flex-col justify-between ${
            mode === 'manual'
              ? 'border-[#4CC9F0] bg-cyan-500/10 text-white shadow-[0_0_15px_rgba(76,201,240,0.2)]'
              : 'border-slate-200 dark:border-white/10 bg-white dark:bg-[#0A1128]/80 hover:bg-slate-50 dark:hover:bg-white/5'
          }`}
        >
          <FileText className={`w-6 h-6 mb-2 ${mode === 'manual' ? 'text-[#4CC9F0]' : 'text-slate-400 dark:text-white/40'}`} />
          <div>
            <span className="label-tag block mb-0.5">DIRECT ENTRY</span>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-tight">Manual Input</h3>
            <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">Type questions manually</p>
          </div>
        </button>
      </div>

      {/* Main Mode Body */}
      <div className="bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 rounded-sm p-6 sm:p-8 backdrop-blur-md shadow-xl">
        
        {/* MODE: SAMPLE EXAMS */}
        {mode === 'sample' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <span className="label-tag">CATALOG SELECTOR</span>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center space-x-2 mt-1 uppercase tracking-tight">
                  <BookOpen className="w-5 h-5 text-[#4CC9F0]" />
                  <span>Select Pre-Loaded Exemplar Exam</span>
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {SAMPLE_EXAMS.map((sample) => {
                const isSelected = examPaper?.id === sample.id;
                return (
                  <div
                    key={sample.id}
                    onClick={() => setExamPaper(sample)}
                    className={`cursor-pointer p-5 border transition-all duration-200 flex flex-col justify-between rounded-sm ${
                      isSelected
                        ? 'marker-card bg-cyan-500/10 border-slate-200 dark:border-white/20 shadow-[0_0_15px_rgba(76,201,240,0.15)]'
                        : 'border-slate-200 dark:border-white/10 hover:border-[#4CC9F0]/50 bg-slate-50/50 dark:bg-white/[0.02]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-[#4CC9F0] uppercase tracking-widest bg-cyan-500/10 px-2.5 py-1 border border-[#4CC9F0]/30 font-mono">
                          {sample.subject}
                        </span>
                        {isSelected && (
                          <span className="flex items-center text-xs font-bold text-[#4CC9F0] font-mono">
                            <Check className="w-4 h-4 mr-1" /> ACTIVE
                          </span>
                        )}
                      </div>
                      <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                        {sample.title}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-white/60 mt-1 font-mono">
                        {sample.topic} • {sample.gradeLevel}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-between text-xs text-slate-600 dark:text-white/70 font-mono">
                      <span className="flex items-center text-[#4CC9F0]">
                        <Award className="w-3.5 h-3.5 mr-1" />
                        {sample.totalMarks} Marks
                      </span>
                      <span className="flex items-center">
                        <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
                        {sample.durationMinutes} mins
                      </span>
                      <span>{sample.questions.length} Questions</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* MODE: AI GENERATOR */}
        {mode === 'ai' && (
          <form onSubmit={handleGenerateAI} className="space-y-6">
            <div>
              <span className="label-tag">AI CORE GENERATOR</span>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center space-x-2 mt-1 uppercase tracking-tight">
                <Sparkles className="w-5 h-5 text-[#4CC9F0]" />
                <span>Generate Exam Paper & Rubric with AI</span>
              </h2>
            </div>

            {errorMsg && (
              <div className="p-4 rounded-xs bg-rose-500/10 border border-rose-500/30 text-rose-300 font-mono text-xs">
                {errorMsg}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-white/70 mb-1 font-mono">
                  Subject / Discipline
                </label>
                <input
                  type="text"
                  required
                  value={aiForm.subject}
                  onChange={(e) => setAiForm({ ...aiForm, subject: e.target.value })}
                  placeholder="e.g. Organic Chemistry, Microeconomics, World History"
                  className="w-full px-3.5 py-2.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:border-[#4CC9F0] outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-white/70 mb-1 font-mono">
                  Syllabus Topic(s)
                </label>
                <input
                  type="text"
                  required
                  value={aiForm.topic}
                  onChange={(e) => setAiForm({ ...aiForm, topic: e.target.value })}
                  placeholder="e.g. Reaction Mechanisms, Supply & Demand Curves"
                  className="w-full px-3.5 py-2.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:border-[#4CC9F0] outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-white/70 mb-1 font-mono">
                  Grade / Academic Level
                </label>
                <input
                  type="text"
                  value={aiForm.gradeLevel}
                  onChange={(e) => setAiForm({ ...aiForm, gradeLevel: e.target.value })}
                  placeholder="e.g. Grade 11 AP, University Undergraduate Year 2"
                  className="w-full px-3.5 py-2.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:border-[#4CC9F0] outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-white/70 mb-1 font-mono">
                  Difficulty Level
                </label>
                <select
                  value={aiForm.difficulty}
                  onChange={(e) => setAiForm({ ...aiForm, difficulty: e.target.value as any })}
                  className="w-full px-3.5 py-2.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:border-[#4CC9F0] outline-none font-mono"
                >
                  <option value="Beginner">Beginner / Foundation</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                  <option value="IB/AP Standard">IB / AP Standard</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-white/70 mb-1 font-mono">
                  Total Marks
                </label>
                <input
                  type="number"
                  min="5"
                  max="100"
                  value={aiForm.totalMarks}
                  onChange={(e) => setAiForm({ ...aiForm, totalMarks: parseInt(e.target.value) || 30 })}
                  className="w-full px-3.5 py-2.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:border-[#4CC9F0] outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-white/70 mb-1 font-mono">
                  Duration (Minutes)
                </label>
                <input
                  type="number"
                  min="10"
                  max="180"
                  value={aiForm.durationMinutes}
                  onChange={(e) => setAiForm({ ...aiForm, durationMinutes: parseInt(e.target.value) || 45 })}
                  className="w-full px-3.5 py-2.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:border-[#4CC9F0] outline-none font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-white/70 mb-1 font-mono">
                Additional Focus / Instructions
              </label>
              <textarea
                rows={2}
                value={aiForm.additionalInstructions}
                onChange={(e) => setAiForm({ ...aiForm, additionalInstructions: e.target.value })}
                placeholder="e.g. Include 1 multi-step calculation question and 1 essay question..."
                className="w-full px-3.5 py-2.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:border-[#4CC9F0] outline-none font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={isGenerating}
              className="w-full sm:w-auto px-8 py-3 bg-[#4CC9F0] text-[#0A1128] font-extrabold text-xs uppercase tracking-widest hover:bg-[#3db8dd] transition-colors shadow-[0_0_15px_rgba(76,201,240,0.4)] flex items-center justify-center space-x-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generating Exam & Rubric with AI...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Exam & Rubric Paper</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* MODE: UPLOAD FILE */}
        {mode === 'upload' && (
          <div className="space-y-6">
            <div>
              <span className="label-tag font-mono">FILE SYSTEM</span>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center space-x-2 mt-1 uppercase tracking-tight">
                <Upload className="w-5 h-5 text-[#4CC9F0]" />
                <span>Upload Question Paper or Answer Scheme</span>
              </h2>
            </div>

            <div className="border-2 border-dashed border-slate-300 dark:border-white/20 rounded-xs p-10 text-center hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer relative">
              <input
                type="file"
                accept="*/*"
                onChange={handleFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <Upload className="w-10 h-10 mx-auto text-[#4CC9F0] mb-3" />
              <p className="font-bold text-slate-900 dark:text-white text-sm uppercase tracking-wide">
                Drag and drop your exam paper file here, or browse
              </p>
              <p className="text-xs text-slate-500 dark:text-white/50 mt-1 font-mono">
                Supports TXT, PDF, DOCX, Markdown or JSON format
              </p>
            </div>
          </div>
        )}

        {/* MODE: MANUAL INPUT */}
        {mode === 'manual' && (
          <div className="space-y-6">
            <div>
              <span className="label-tag font-mono">EDITOR</span>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center space-x-2 mt-1 uppercase tracking-tight">
                <FileText className="w-5 h-5 text-[#4CC9F0]" />
                <span>Create Custom Exam Paper</span>
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-white/70 mb-1 font-mono">Title</label>
                <input
                  type="text"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-white/70 mb-1 font-mono">Subject</label>
                <input
                  type="text"
                  value={manualSubject}
                  onChange={(e) => setManualSubject(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-white/70 mb-1 font-mono">Topic</label>
                <input
                  type="text"
                  value={manualTopic}
                  onChange={(e) => setManualTopic(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm font-mono"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wider font-mono">Questions List</h3>
                <button
                  onClick={() => {
                    const qNum = `Q${manualQuestions.length + 1}`;
                    setManualQuestions([
                      ...manualQuestions,
                      {
                        id: `q${Date.now()}`,
                        number: qNum,
                        questionText: 'New question description...',
                        maxMarks: 5,
                        questionType: 'short_answer',
                        modelAnswer: 'Expected model answer key...',
                      },
                    ]);
                  }}
                  className="px-3 py-1.5 rounded-xs bg-cyan-500/10 text-[#4CC9F0] border border-[#4CC9F0]/30 text-xs font-mono font-bold flex items-center space-x-1"
                >
                  <Plus className="w-3.5 h-3.5" /> <span>Add Question</span>
                </button>
              </div>

              {manualQuestions.map((q, idx) => (
                <div key={q.id} className="p-4 rounded-xs border border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02] space-y-3 marker-card">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-[#4CC9F0] font-mono">{q.number}</span>
                    <button
                      onClick={() => setManualQuestions(manualQuestions.filter((_, i) => i !== idx))}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-slate-500 uppercase">Question Text</label>
                    <textarea
                      rows={2}
                      value={q.questionText}
                      onChange={(e) => {
                        const updated = [...manualQuestions];
                        updated[idx].questionText = e.target.value;
                        setManualQuestions(updated);
                      }}
                      className="w-full px-3 py-2 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-sm font-sans"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-mono text-slate-500 uppercase">Max Marks</label>
                      <input
                        type="number"
                        value={q.maxMarks}
                        onChange={(e) => {
                          const updated = [...manualQuestions];
                          updated[idx].maxMarks = parseInt(e.target.value) || 0;
                          setManualQuestions(updated);
                        }}
                        className="w-full px-3 py-1.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-mono text-slate-500 uppercase">Model Answer Key</label>
                      <input
                        type="text"
                        value={q.modelAnswer || ''}
                        onChange={(e) => {
                          const updated = [...manualQuestions];
                          updated[idx].modelAnswer = e.target.value;
                          setManualQuestions(updated);
                        }}
                        className="w-full px-3 py-1.5 rounded-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 text-sm font-sans"
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={handleSaveManual}
                className="px-6 py-2.5 bg-[#4CC9F0] text-[#0A1128] font-extrabold text-xs uppercase tracking-widest"
              >
                Save Custom Exam
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ACTIVE EXAM PREVIEW PANEL */}
      {examPaper && (
        <div className="bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 rounded-sm p-6 sm:p-8 shadow-xl space-y-6 marker-card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-white/10">
            <div>
              <div className="flex items-center space-x-2 mb-1">
                <span className="px-2.5 py-0.5 rounded-xs bg-cyan-500/10 border border-[#4CC9F0]/30 text-[#4CC9F0] text-xs font-mono font-bold uppercase tracking-wider">
                  ACTIVE PAPER
                </span>
                <span className="text-xs font-mono text-slate-500 dark:text-white/50">{examPaper.subject}</span>
              </div>
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-white uppercase tracking-tight">
                {examPaper.title}
              </h2>
              <p className="text-xs font-mono text-slate-500 dark:text-white/60 mt-0.5">
                Topic: {examPaper.topic} • Grade: {examPaper.gradeLevel}
              </p>
            </div>

            <div className="flex items-center space-x-4 text-sm font-mono text-slate-700 dark:text-white">
              <div className="bg-slate-100 dark:bg-white/[0.03] px-3.5 py-2 border border-slate-200 dark:border-white/10 rounded-xs">
                <span className="text-[10px] text-slate-500 dark:text-white/40 block uppercase">Total Marks</span>
                <span className="text-[#4CC9F0] font-bold">{examPaper.totalMarks} Marks</span>
              </div>
              <div className="bg-slate-100 dark:bg-white/[0.03] px-3.5 py-2 border border-slate-200 dark:border-white/10 rounded-xs">
                <span className="text-[10px] text-slate-500 dark:text-white/40 block uppercase">Questions</span>
                <span>{examPaper.questions.length} Items</span>
              </div>
            </div>
          </div>

          {/* Question List Preview */}
          <div className="space-y-4">
            <span className="label-tag">PAPER STRUCTURE</span>
            <div className="space-y-3">
              {examPaper.questions.map((q) => (
                <div key={q.id} className="p-4 rounded-xs border border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02]">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="inline-block px-2 py-0.5 rounded-xs bg-cyan-500/10 text-[#4CC9F0] font-mono font-bold text-xs mr-2">
                        {q.number}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white text-sm">
                        {q.questionText}
                      </span>
                    </div>
                    <span className="px-2.5 py-1 rounded-xs bg-cyan-500/10 text-[#4CC9F0] font-mono font-bold text-xs whitespace-nowrap ml-3 border border-[#4CC9F0]/20">
                      [{q.maxMarks} Marks]
                    </span>
                  </div>
                  {q.modelAnswer && (
                    <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-white/10 text-xs text-slate-600 dark:text-white/70 font-mono">
                      <span className="font-bold text-[#4CC9F0]">MODEL ANSWER: </span>
                      {q.modelAnswer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Proceed Button */}
          <div className="pt-4 flex justify-end">
            <button
              onClick={onProceed}
              className="px-8 py-3 bg-[#4CC9F0] text-[#0A1128] font-extrabold text-xs uppercase tracking-widest hover:bg-[#3db8dd] transition-all shadow-[0_0_15px_rgba(76,201,240,0.4)] flex items-center space-x-2"
            >
              <span>PROCEED TO STEP 2: EDIT RUBRIC</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

};

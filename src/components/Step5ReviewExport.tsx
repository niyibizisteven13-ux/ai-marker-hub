import React, { useState } from 'react';
import { ExamPaper, StudentScript, QuestionMarkResult, ClassAnalytics, FlagType } from '../types';
import { jsPDF } from 'jspdf';
import confetti from 'canvas-confetti';
import { CheckSquare, ShieldAlert, CheckCircle2, Download, BarChart3, Edit3, ArrowUpRight, Award, FileSpreadsheet, Sparkles, Filter, ChevronRight, User } from 'lucide-react';

interface Step5ReviewExportProps {
  examPaper: ExamPaper;
  studentScripts: StudentScript[];
  setStudentScripts: React.Dispatch<React.SetStateAction<StudentScript[]>>;
}

export const Step5ReviewExport: React.FC<Step5ReviewExportProps> = ({
  examPaper,
  studentScripts,
  setStudentScripts,
}) => {
  const [activeTab, setActiveTab] = useState<'review' | 'analytics'>('review');
  const [selectedScriptId, setSelectedScriptId] = useState<string>(
    studentScripts[0]?.id || ''
  );
  const [filterFlag, setFilterFlag] = useState<string>('all');

  const selectedScript = studentScripts.find((s) => s.id === selectedScriptId) || studentScripts[0];

  // 1. Calculate Class Analytics
  const computeAnalytics = (): ClassAnalytics => {
    const marked = studentScripts.filter((s) => s.status === 'marked' || s.status === 'approved');
    if (marked.length === 0) {
      return {
        totalStudents: 0,
        averageScore: 0,
        highestScore: 0,
        lowestScore: 0,
        passRate: 0,
        flaggedCount: 0,
        approvedCount: 0,
        questionAverages: [],
        commonMisconceptions: [],
      };
    }

    const scores = marked.map((s) => s.percentage || 0);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const highestScore = Math.max(...scores);
    const lowestScore = Math.min(...scores);
    const passCount = scores.filter((score) => score >= 50).length;
    const passRate = Math.round((passCount / scores.length) * 100);
    const flaggedCount = marked.filter((s) => s.flags && s.flags.length > 0).length;
    const approvedCount = marked.filter((s) => s.teacherApproved).length;

    // Per question averages
    const questionAverages = examPaper.questions.map((q) => {
      let sum = 0;
      let count = 0;
      marked.forEach((s) => {
        const qRes = s.results?.find((r) => r.questionId === q.id || r.questionNumber === q.number);
        if (qRes) {
          sum += qRes.awardedMarks;
          count++;
        }
      });
      const avg = count > 0 ? sum / count : 0;
      return {
        questionNumber: q.number,
        avgScore: Math.round(avg * 10) / 10,
        maxScore: q.maxMarks,
        percentage: q.maxMarks > 0 ? Math.round((avg / q.maxMarks) * 100) : 0,
      };
    });

    const commonMisconceptions = [
      'Confusing rate of change of momentum with total velocity change in Q1.',
      'Forgetting to account for combined total mass after inelastic impact in Q2.',
      'Unit conversion errors when calculating Kinetic Energy in Joules.',
    ];

    return {
      totalStudents: marked.length,
      averageScore: avgScore,
      highestScore,
      lowestScore,
      passRate,
      flaggedCount,
      approvedCount,
      questionAverages,
      commonMisconceptions,
    };
  };

  const analytics = computeAnalytics();

  // 2. Score Override Handler
  const handleScoreOverride = (
    questionNumber: string,
    newMarks: number,
    criterionIndex?: number,
    newCriterionMarks?: number
  ) => {
    if (!selectedScript || !selectedScript.results) return;

    const updatedResults = selectedScript.results.map((r) => {
      if (r.questionNumber === questionNumber) {
        let updatedCriteria = [...r.criteriaBreakdown];
        if (criterionIndex !== undefined && newCriterionMarks !== undefined) {
          updatedCriteria[criterionIndex] = {
            ...updatedCriteria[criterionIndex],
            marksAwarded: newCriterionMarks,
            reason: updatedCriteria[criterionIndex].reason + ' (Teacher override)',
          };
          // Recalculate total awarded for question
          const newSum = updatedCriteria.reduce((sum, c) => sum + c.marksAwarded, 0);
          return {
            ...r,
            awardedMarks: Math.min(r.maxMarks, Math.max(0, newSum)),
            criteriaBreakdown: updatedCriteria,
          };
        }
        return {
          ...r,
          awardedMarks: Math.min(r.maxMarks, Math.max(0, newMarks)),
        };
      }
      return r;
    });

    // Recalculate script total
    const totalAwarded = updatedResults.reduce((sum, r) => sum + r.awardedMarks, 0);
    const maxTotal = updatedResults.reduce((sum, r) => sum + r.maxMarks, 0);
    const percentage = maxTotal > 0 ? Math.round((totalAwarded / maxTotal) * 100) : 0;

    const updatedScript: StudentScript = {
      ...selectedScript,
      results: updatedResults,
      totalAwardedMarks: Math.round(totalAwarded * 10) / 10,
      maxTotalMarks: maxTotal,
      percentage,
    };

    setStudentScripts((prev) =>
      prev.map((s) => (s.id === selectedScript.id ? updatedScript : s))
    );
  };

  // 3. Approve Single Script
  const handleApproveScript = (scriptId: string) => {
    setStudentScripts((prev) =>
      prev.map((s) =>
        s.id === scriptId
          ? {
              ...s,
              status: 'approved',
              teacherApproved: true,
              teacherApprovalTime: new Date().toISOString(),
            }
          : s
      )
    );

    // Fire celebratory confetti!
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.7 },
    });
  };

  // 4. Approve All
  const handleApproveAll = () => {
    setStudentScripts((prev) =>
      prev.map((s) => ({
        ...s,
        status: 'approved',
        teacherApproved: true,
        teacherApprovalTime: new Date().toISOString(),
      }))
    );

    confetti({
      particleCount: 100,
      spread: 80,
      origin: { y: 0.6 },
    });
  };

  // 5. Export Gradebook CSV
  const handleExportCSV = (type: 'standard' | 'google_classroom' | 'canvas' | 'moodle') => {
    let csvContent = '';

    if (type === 'google_classroom') {
      csvContent = 'Student Name,Student ID,Total Grade,Max Points,Percentage,Status\n';
      studentScripts.forEach((s) => {
        csvContent += `"${s.studentName}","${s.studentId}",${s.totalAwardedMarks || 0},${s.maxTotalMarks || 0},${s.percentage || 0}%,${s.teacherApproved ? 'Graded' : 'Draft'}\n`;
      });
    } else if (type === 'canvas') {
      csvContent = 'Student,ID,SIS User ID,SIS Login ID,Section,Assignment Score,Unposted Final Score\n';
      studentScripts.forEach((s) => {
        csvContent += `"${s.studentName}","${s.studentId}","${s.studentId}","${s.studentName.toLowerCase().replace(/\s+/g, '')}","Section 1",${s.totalAwardedMarks || 0},${s.totalAwardedMarks || 0}\n`;
      });
    } else {
      // Standard CSV
      const qHeaders = examPaper.questions.map((q) => `${q.number} (${q.maxMarks}m)`).join(',');
      csvContent = `Student Name,Student ID,Total Marks,Max Marks,Percentage,Flags,Approved,${qHeaders}\n`;

      studentScripts.forEach((s) => {
        const qScores = examPaper.questions.map((q) => {
          const res = s.results?.find((r) => r.questionId === q.id || r.questionNumber === q.number);
          return res ? res.awardedMarks : 0;
        }).join(',');

        const flagsStr = (s.flags || []).join(';');
        csvContent += `"${s.studentName}","${s.studentId}",${s.totalAwardedMarks || 0},${s.maxTotalMarks || 0},${s.percentage || 0}%,"${flagsStr}",${s.teacherApproved ? 'YES' : 'NO'},${qScores}\n`;
      });
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${examPaper.title.replace(/\s+/g, '_')}_Gradebook_${type}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 6. Export PDF Report Card using jsPDF
  const handleExportPDF = () => {
    if (!selectedScript) return;

    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text('Bwenge AI • Official Exam Report Card', 14, 20);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Exam: ${examPaper.title}`, 14, 30);
    doc.text(`Subject: ${examPaper.subject} | Topic: ${examPaper.topic}`, 14, 37);

    doc.setFont('helvetica', 'bold');
    doc.text(`Student: ${selectedScript.studentName} (${selectedScript.studentId})`, 14, 48);
    doc.text(`Score: ${selectedScript.totalAwardedMarks} / ${selectedScript.maxTotalMarks} (${selectedScript.percentage}%)`, 14, 55);

    doc.line(14, 60, 196, 60);

    let yPos = 70;
    doc.setFontSize(11);

    (selectedScript.results || []).forEach((r) => {
      if (yPos > 260) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFont('helvetica', 'bold');
      doc.text(`${r.questionNumber}: Awarded ${r.awardedMarks}/${r.maxMarks} Marks`, 14, yPos);
      yPos += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      r.criteriaBreakdown.forEach((c) => {
        doc.text(`• ${c.criterion}: [${c.marksAwarded}/${c.marksAvailable}m] ${c.reason}`, 18, yPos);
        yPos += 5;
      });

      doc.setFont('helvetica', 'italic');
      doc.text(`Feedback: "${r.feedbackToStudent}"`, 18, yPos);
      yPos += 10;
      doc.setFontSize(11);
    });

    doc.save(`${selectedScript.studentName.replace(/\s+/g, '_')}_ReportCard.pdf`);
  };

  // Filter scripts
  const filteredScripts = studentScripts.filter((s) => {
    if (filterFlag === 'flagged') return s.flags && s.flags.length > 0;
    if (filterFlag === 'approved') return s.teacherApproved;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-16">
      {/* Top Banner */}
      <div className="bg-[#0A1128] border border-white/10 text-white rounded-sm p-6 sm:p-8 shadow-2xl relative overflow-hidden blueprint-grid">
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-xs bg-cyan-500/10 text-[#4CC9F0] text-xs font-mono font-bold mb-3 border border-[#4CC9F0]/30 uppercase tracking-widest">
            <CheckSquare className="w-3 h-3 text-[#4CC9F0]" />
            <span>STEP 05 // TEACHER APPROVAL & EXPORT SUITE</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight uppercase font-sans">
            REVIEW, OVERRIDE & <span className="text-[#4CC9F0]">EXPORT GRADES</span>
          </h1>
          <p className="mt-2 text-white/70 text-sm sm:text-base leading-relaxed">
            Every AI-generated score is a draft recommendation until approved by a teacher. Adjust individual criteria points, view class analytics, and export to PDF or LMS formats.
          </p>
        </div>
      </div>

      {/* Trust & Safety Alert Box */}
      <div className="p-4 rounded-xs bg-amber-500/10 border border-amber-500/30 text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 font-mono text-xs">
        <div className="flex items-center space-x-3">
          <ShieldAlert className="w-6 h-6 text-amber-400 shrink-0" />
          <div>
            <span className="font-bold uppercase tracking-wider">Human-in-the-Loop Audit Trail: </span>
            <span>Teachers hold final grading authority. Click <span className="font-bold text-amber-300">APPROVE</span> on scripts to verify marks for official gradebooks.</span>
          </div>
        </div>

        <button
          onClick={handleApproveAll}
          className="px-4 py-2 rounded-xs bg-amber-500 hover:bg-amber-600 text-[#0A1128] font-extrabold text-xs whitespace-nowrap shadow-sm shrink-0 flex items-center space-x-1 uppercase tracking-wider"
        >
          <CheckCircle2 className="w-4 h-4 mr-1" />
          <span>Approve All Scripts ({studentScripts.length})</span>
        </button>
      </div>

      {/* Main Tabs (Review vs Analytics) */}
      <div className="flex items-center space-x-4 border-b border-slate-200 dark:border-white/10 pb-2 font-mono text-xs uppercase tracking-wider">
        <button
          onClick={() => setActiveTab('review')}
          className={`pb-2 px-4 font-bold border-b-2 transition-all flex items-center space-x-2 ${
            activeTab === 'review'
              ? 'border-[#4CC9F0] text-[#4CC9F0]'
              : 'border-transparent text-slate-500 dark:text-white/50 hover:text-white'
          }`}
        >
          <CheckSquare className="w-4 h-4" />
          <span>Script Review & Override</span>
        </button>

        <button
          onClick={() => setActiveTab('analytics')}
          className={`pb-2 px-4 font-bold border-b-2 transition-all flex items-center space-x-2 ${
            activeTab === 'analytics'
              ? 'border-[#4CC9F0] text-[#4CC9F0]'
              : 'border-transparent text-slate-500 dark:text-white/50 hover:text-white'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Class Analytics & Insights</span>
        </button>
      </div>

      {/* TAB 1: SCRIPT-BY-SCRIPT REVIEW */}
      {activeTab === 'review' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Sidebar: Student List Selector */}
          <div className="lg:col-span-4 bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 rounded-sm p-4 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-white/10 font-mono">
              <h3 className="font-bold text-xs text-slate-900 dark:text-white uppercase tracking-wider flex items-center space-x-1.5">
                <User className="w-4 h-4 text-[#4CC9F0]" />
                <span>ROSTER ({filteredScripts.length})</span>
              </h3>

              {/* Filter dropdown */}
              <select
                value={filterFlag}
                onChange={(e) => setFilterFlag(e.target.value)}
                className="text-[10px] font-bold px-2 py-1 rounded-xs border border-white/10 bg-slate-950 text-white uppercase font-mono"
              >
                <option value="all">ALL SCRIPTS</option>
                <option value="flagged">FLAGGED ONLY 🚩</option>
                <option value="approved">APPROVED ONLY ✅</option>
              </select>
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {filteredScripts.map((s) => {
                const isSelected = s.id === selectedScript?.id;
                const hasFlags = s.flags && s.flags.length > 0;

                return (
                  <div
                    key={s.id}
                    onClick={() => setSelectedScriptId(s.id)}
                    className={`p-3.5 rounded-xs cursor-pointer border transition-all duration-150 flex items-center justify-between font-mono ${
                      isSelected
                        ? 'border-[#4CC9F0] bg-cyan-500/10 text-white shadow-[0_0_10px_rgba(76,201,240,0.2)]'
                        : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/[0.02]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-white font-sans">
                          {s.studentName}
                        </span>
                        {s.teacherApproved && (
                          <CheckCircle2 className="w-4 h-4 text-[#4CC9F0] shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">{s.studentId}</p>

                      {hasFlags && (
                        <div className="mt-1.5 inline-flex items-center px-2 py-0.5 rounded-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold text-[10px]">
                          🚩 {s.flags?.join(', ')}
                        </div>
                      )}
                    </div>

                    <div className="text-right">
                      <span className="font-extrabold text-sm text-[#4CC9F0] block">
                        {s.totalAwardedMarks || 0}/{s.maxTotalMarks || 0}
                      </span>
                      <span className="text-[10px] font-bold text-slate-500 dark:text-white/50">
                        {s.percentage || 0}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Main Area: Detailed Rubric & Overrides for Selected Script */}
          {selectedScript ? (
            <div className="lg:col-span-8 bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 rounded-sm p-6 shadow-xl space-y-6">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-white/10">
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="font-extrabold text-xl text-slate-900 dark:text-white uppercase font-sans">
                      {selectedScript.studentName}
                    </span>
                    <span className="text-xs font-mono text-slate-500 dark:text-white/60">({selectedScript.studentId})</span>
                    {selectedScript.teacherApproved ? (
                      <span className="px-2.5 py-0.5 rounded-xs bg-cyan-500/10 text-[#4CC9F0] border border-[#4CC9F0]/30 text-xs font-mono font-bold flex items-center uppercase">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approved
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-xs bg-amber-500/10 text-amber-300 border border-amber-500/30 text-xs font-mono font-bold uppercase">
                        Draft AI Grade
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-mono text-slate-500 dark:text-white/60">
                    Exam: {examPaper.title}
                  </p>
                </div>

                <div className="flex items-center space-x-3">
                  <div className="text-right px-4 py-2 rounded-xs bg-cyan-500/10 border border-[#4CC9F0]/30 font-mono">
                    <span className="text-[9px] uppercase font-bold text-[#4CC9F0] block">Total Score</span>
                    <span className="text-xl font-extrabold text-slate-900 dark:text-white">
                      {selectedScript.totalAwardedMarks} / {selectedScript.maxTotalMarks} ({selectedScript.percentage}%)
                    </span>
                  </div>

                  {!selectedScript.teacherApproved && (
                    <button
                      onClick={() => handleApproveScript(selectedScript.id)}
                      className="px-5 py-2.5 rounded-xs bg-[#4CC9F0] hover:bg-[#3db8dd] text-[#0A1128] font-extrabold text-xs uppercase tracking-wider shadow-[0_0_15px_rgba(76,201,240,0.4)] flex items-center space-x-1.5 transition-transform active:scale-95"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Approve Grade</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Per Question Breakdown */}
              <div className="space-y-6">
                {selectedScript.results?.map((res, qIdx) => {
                  const matchingQ = examPaper.questions.find((q) => q.id === res.questionId || q.number === res.questionNumber);
                  const matchingAns = selectedScript.answers.find((a) => a.questionId === res.questionId || a.questionNumber === res.questionNumber);

                  return (
                    <div
                      key={res.questionNumber}
                      className="p-5 rounded-xs border border-slate-200 dark:border-white/10 bg-slate-50/40 dark:bg-white/[0.02] space-y-4"
                    >
                      {/* Question Header & Mark Override Stepper */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-white/10">
                        <div>
                          <span className="px-2.5 py-1 rounded-xs bg-cyan-500/10 border border-[#4CC9F0]/30 text-[#4CC9F0] font-mono font-extrabold text-xs mr-2">
                            {res.questionNumber}
                          </span>
                          <span className="font-extrabold text-slate-900 dark:text-white text-sm font-sans uppercase">
                            {matchingQ?.questionText || res.questionNumber}
                          </span>
                        </div>

                        {/* Interactive Mark Stepper */}
                        <div className="flex items-center space-x-2 bg-white dark:bg-slate-950 px-3 py-1.5 rounded-xs border border-slate-200 dark:border-white/10 shrink-0 font-mono">
                          <span className="text-xs font-bold text-slate-500 dark:text-white/60">Marks:</span>
                          <input
                            type="number"
                            min="0"
                            max={res.maxMarks}
                            step="0.5"
                            value={res.awardedMarks}
                            onChange={(e) =>
                              handleScoreOverride(
                                res.questionNumber,
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-16 text-center font-extrabold text-[#4CC9F0] bg-slate-100 dark:bg-slate-900 rounded-xs px-2 py-1 text-xs border border-slate-300 dark:border-white/10 outline-none"
                          />
                          <span className="text-xs font-semibold text-slate-400">/ {res.maxMarks}</span>
                        </div>
                      </div>

                      {/* Student Answer Text */}
                      <div className="p-3.5 rounded-xs bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-white/10 space-y-1 font-mono">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[#4CC9F0]">
                          STUDENT ANSWER SCRIPT:
                        </span>
                        <p className="text-xs sm:text-sm font-sans font-medium text-slate-800 dark:text-white/90 whitespace-pre-wrap leading-relaxed">
                          {matchingAns?.answerText || '[No response provided]'}
                        </p>
                      </div>

                      {/* Criteria Breakdown Grid */}
                      <div className="space-y-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[#4CC9F0] font-mono">
                          RUBRIC EVIDENCE CRITERIA BREAKDOWN:
                        </span>
                        <div className="space-y-2">
                          {res.criteriaBreakdown.map((crit, cIdx) => (
                            <div
                              key={cIdx}
                              className="p-3 rounded-xs bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                            >
                              <div className="flex-1 font-sans">
                                <span className="font-bold text-slate-900 dark:text-white block">
                                  {crit.criterion}
                                </span>
                                <p className="text-slate-500 dark:text-white/60 mt-0.5 text-xs">
                                  {crit.reason}
                                </p>
                              </div>

                              <div className="flex items-center space-x-2 shrink-0 font-mono">
                                <input
                                  type="number"
                                  min="0"
                                  max={crit.marksAvailable}
                                  step="0.5"
                                  value={crit.marksAwarded}
                                  onChange={(e) =>
                                    handleScoreOverride(
                                      res.questionNumber,
                                      res.awardedMarks,
                                      cIdx,
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  className="w-14 text-center font-bold text-[#4CC9F0] bg-slate-50 dark:bg-slate-900 rounded-xs px-1.5 py-1 border border-slate-300 dark:border-white/10 outline-none"
                                />
                                <span className="text-slate-400 font-semibold">/ {crit.marksAvailable} pts</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Student Feedback */}
                      <div className="p-3 rounded-xs bg-cyan-500/10 border border-[#4CC9F0]/30 text-xs space-y-1 font-mono">
                        <span className="font-bold text-[#4CC9F0] block uppercase">
                          FEEDBACK TO STUDENT:
                        </span>
                        <p className="text-white/90 font-sans italic">
                          "{res.feedbackToStudent}"
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Action Buttons for PDF/Report Card Export */}
              <div className="pt-4 border-t border-slate-200 dark:border-white/10 flex flex-wrap gap-3 justify-between items-center font-mono text-xs">
                <button
                  onClick={handleExportPDF}
                  className="px-5 py-2.5 rounded-xs bg-white/10 hover:bg-white/20 text-white font-bold text-xs shadow-sm flex items-center space-x-2 border border-white/10 uppercase tracking-wider"
                >
                  <Download className="w-4 h-4 text-[#4CC9F0]" />
                  <span>Download Student PDF Report Card</span>
                </button>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleExportCSV('standard')}
                    className="px-4 py-2.5 rounded-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-[#4CC9F0] font-bold text-xs border border-[#4CC9F0]/30 flex items-center space-x-1.5 uppercase tracking-wider"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-[#4CC9F0]" />
                    <span>CSV Gradebook</span>
                  </button>

                  <button
                    onClick={() => handleExportCSV('google_classroom')}
                    className="px-4 py-2.5 rounded-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 font-bold text-xs border border-emerald-500/30 flex items-center space-x-1.5 uppercase tracking-wider"
                  >
                    <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                    <span>Export to Google Classroom</span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* TAB 2: CLASS ANALYTICS */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-sm bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 shadow-xl marker-card">
              <span className="text-[10px] font-bold uppercase font-mono tracking-widest text-[#4CC9F0] block">Class Average</span>
              <span className="text-3xl font-extrabold text-slate-900 dark:text-white mt-1 block font-mono">
                {analytics.averageScore}%
              </span>
              <span className="text-xs font-mono text-slate-400 dark:text-white/50 mt-1 block">Across {analytics.totalStudents} students</span>
            </div>

            <div className="p-5 rounded-sm bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 shadow-xl marker-card">
              <span className="text-[10px] font-bold uppercase font-mono tracking-widest text-[#4CC9F0] block">Pass Rate (≥50%)</span>
              <span className="text-3xl font-extrabold text-[#4CC9F0] mt-1 block font-mono">
                {analytics.passRate}%
              </span>
              <span className="text-xs font-mono text-slate-400 dark:text-white/50 mt-1 block">High performance</span>
            </div>

            <div className="p-5 rounded-sm bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 shadow-xl marker-card">
              <span className="text-[10px] font-bold uppercase font-mono tracking-widest text-[#4CC9F0] block">Highest / Lowest</span>
              <span className="text-3xl font-extrabold text-slate-900 dark:text-white mt-1 block font-mono">
                {analytics.highestScore}% / {analytics.lowestScore}%
              </span>
              <span className="text-xs font-mono text-slate-400 dark:text-white/50 mt-1 block">Grade spread</span>
            </div>

            <div className="p-5 rounded-sm bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 shadow-xl marker-card">
              <span className="text-[10px] font-bold uppercase font-mono tracking-widest text-amber-300 block">Flagged / Approved</span>
              <span className="text-3xl font-extrabold text-amber-300 mt-1 block font-mono">
                {analytics.flaggedCount} / {analytics.approvedCount}
              </span>
              <span className="text-xs font-mono text-slate-400 dark:text-white/50 mt-1 block">Teacher audit status</span>
            </div>
          </div>

          {/* Question Difficulty Breakdown */}
          <div className="bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 rounded-sm p-6 shadow-xl space-y-4">
            <span className="label-tag">DIFFICULTY METRICS</span>
            <h3 className="font-extrabold text-base text-slate-900 dark:text-white uppercase tracking-tight flex items-center space-x-2 mt-0.5">
              <BarChart3 className="w-5 h-5 text-[#4CC9F0]" />
              <span>Item Difficulty & Question Performance Breakdown</span>
            </h3>

            <div className="space-y-4 font-mono text-xs">
              {analytics.questionAverages.map((q) => (
                <div key={q.questionNumber} className="space-y-1.5">
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-slate-900 dark:text-white font-sans">{q.questionNumber}</span>
                    <span className="text-[#4CC9F0]">
                      Avg Score: {q.avgScore} / {q.maxScore} ({q.percentage}%)
                    </span>
                  </div>

                  <div className="w-full bg-slate-100 dark:bg-slate-950 rounded-xs h-3 overflow-hidden border border-white/10">
                    <div
                      className={`h-full transition-all duration-500 ${
                        q.percentage < 50
                          ? 'bg-rose-500'
                          : q.percentage < 75
                          ? 'bg-amber-400'
                          : 'bg-[#4CC9F0]'
                      }`}
                      style={{ width: `${q.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Student Misconceptions Report */}
          <div className="bg-white dark:bg-[#0A1128]/90 border border-slate-200 dark:border-white/10 rounded-sm p-6 shadow-xl space-y-4">
            <span className="label-tag">INSIGHTS</span>
            <h3 className="font-extrabold text-base text-slate-900 dark:text-white uppercase tracking-tight flex items-center space-x-2 mt-0.5">
              <Sparkles className="w-5 h-5 text-amber-300" />
              <span>Common Student Misconceptions & Curriculum Insights</span>
            </h3>

            <div className="space-y-2 font-mono text-xs">
              {analytics.commonMisconceptions.map((m, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xs bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-start space-x-2.5"
                >
                  <span className="font-bold text-amber-400 shrink-0">{idx + 1}.</span>
                  <span className="font-sans text-sm">{m}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

};

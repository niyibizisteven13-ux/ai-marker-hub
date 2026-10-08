import { GradingService } from './services/GradingService.js';
import { generateBatchExcelReport, StudentResultData } from '../src/services/excelExporter.ts';
import { uploadBufferToCloud } from '../src/services/cloudStorage.ts';

const gradingService = GradingService.getInstance();

export async function runGradingJobInline(job: { id?: string; data: any; updateProgress?: (p: number) => Promise<void>; updateData?: (d: any) => Promise<void> }) {
  const { examPaper, studentScripts } = job.data;
  const total = studentScripts.length;
  const results: any[] = [];

  for (let i = 0; i < total; i++) {
    const script = studentScripts[i];
    const evaluation = await gradingService.evaluateStudentScriptWithAI(examPaper, script, job.id || 'batch-job');
    results.push({
      studentId: script.studentId,
      markedScript: evaluation.markedScript,
      providers: evaluation.providers,
      providerWarnings: evaluation.providerWarnings
    });
    if (job.updateProgress) {
      await job.updateProgress(Math.round(((i + 1) / total) * 100));
    }
  }

  const rawResults: any[] = results;
  if (rawResults.length) {
    try {
      const excelResults: StudentResultData[] = rawResults.map((item) => {
        const script = item.markedScript;
        const totalScore = Number(script.totalAwardedMarks || 0);
        const maxScore = Number(script.maxTotalMarks || 0);
        const gradePercentage = maxScore > 0 ? totalScore / maxScore : 0;

        return {
          studentId: String(script.studentId || 'unknown'),
          studentName: String(script.studentName || 'Student'),
          totalScore,
          maxScore,
          gradePercentage,
          status: script.flags?.length ? 'Needs Review' : (gradePercentage >= 0.5 ? 'Passed' : 'Failed'),
          identityVerified: true,
          breakdown: script.results.map((q: any) => ({
            question: q.questionNumber || 'Q',
            score: Number(q.awardedMarks || 0),
            max: Number(q.maxMarks || 0),
            feedback: q.feedbackToStudent || '',
          })),
        };
      });

      const excelBuffer = await generateBatchExcelReport(`Batch_${job.id}`, excelResults);
      const fileKey = `batch_results_${job.id}.xlsx`;
      const fileUrl = await uploadBufferToCloud(
        excelBuffer,
        fileKey,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );

      if (job.updateData) {
        await job.updateData({ ...job.data, excelReportUrl: fileUrl });
      }
    } catch (error) {
      console.error(`Error generating Excel report for job ${job.id}:`, error);
    }
  }

  return { success: true, results };
}

export const gradingWorker = {
  on: () => {},
  close: async () => {},
};


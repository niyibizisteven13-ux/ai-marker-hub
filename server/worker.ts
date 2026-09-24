import { Worker, Job } from 'bullmq';
import { GradingService } from './services/GradingService.js';
import { generateBatchExcelReport, StudentResultData } from '../src/services/excelExporter.ts';
import { uploadBufferToCloud } from '../src/services/cloudStorage.ts';

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
};

const gradingService = GradingService.getInstance();

export const gradingWorker = new Worker(
  'exam-grading-queue',
  async (job: Job) => {
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
      await job.updateProgress(Math.round(((i + 1) / total) * 100));
    }

    return { success: true, results };
  },
  { connection: redisConnection },
);

gradingWorker.on('completed', async (job, result) => {
  console.log(`Grading worker completed job ${job.id}`);

  try {
    const rawResults: any[] = result?.results || [];
    if (!rawResults.length) return;

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

    console.log(`Excel report for job ${job.id} saved to ${fileUrl}`);
    // Update job data with report URL
    await job.updateData({ ...job.data, excelReportUrl: fileUrl });
  } catch (error) {
    console.error(`Error generating Excel report for job ${job.id}:`, error);
  }
});

gradingWorker.on('failed', (job, err) => {
  console.error(`Grading worker failed on job ${job?.id}:`, err);
});


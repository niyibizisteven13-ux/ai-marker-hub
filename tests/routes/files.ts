import { Router, Request, Response } from 'express';
import { streamFileToResponse, sendBufferDownload } from '../src/services/documentService.ts';
import path from 'path';

const router = Router();

router.get('/download/:fileId', async (req: Request, res: Response) => {
  try {
    // Resolve file path from your storage layer or uploads folder.
    // Update this to match your persistence strategy.
    const filePath = path.join(process.cwd(), 'uploads', req.params.fileId);
    await streamFileToResponse(filePath, res, { inline: false });
  } catch (err: any) {
    res.status(404).json({ error: err.message || 'Download failed.' });
  }
});

router.get('/export-marks/:studentId', (req: Request, res: Response) => {
  const csvReport = `Student ID,Score,Grade\n${req.params.studentId},88,A`;
  sendBufferDownload(res, csvReport, `Evaluation_${req.params.studentId}.csv`, 'text/csv');
});

export default router;

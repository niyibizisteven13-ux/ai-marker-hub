import PDFDocument from 'pdfkit';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class ResultsPdfService {
  private static instance: ResultsPdfService;

  private constructor() {}

  public static getInstance(): ResultsPdfService {
    if (!ResultsPdfService.instance) {
      ResultsPdfService.instance = new ResultsPdfService();
    }
    return ResultsPdfService.instance;
  }

  public async generateResultsPdf(formId: string, isAudit: boolean = false): Promise<Buffer> {
    const form = await prisma.applicationForm.findUnique({
      where: { id: formId },
      include: {
        submissions: {
          include: { extractedInsights: true }
        }
      }
    });

    if (!form) throw new Error('Form not found');

    // Rank applicants by score
    const applicants = form.submissions
      .map(s => ({
        id: s.id,
        name: this.extractName(JSON.parse(s.data)),
        score: s.extractedInsights?.score || 0,
        summary: s.extractedInsights?.summary || 'No summary available',
        selected: s.extractedInsights?.selected || false,
        scoringDetails: s.extractedInsights?.scoringDetails ? JSON.parse(s.extractedInsights.scoringDetails) : []
      }))
      .sort((a, b) => b.score - a.score);

    return new Promise((resolve) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // Title
      doc.fontSize(20).text(`${isAudit ? 'Selection Audit Report' : 'Selection Results'}: ${form.title}`, { align: 'center' });
      doc.moveDown();

      doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'right' });
      doc.moveDown();

      if (isAudit) {
        doc.fontSize(10).fillColor('red').text('CONFIDENTIAL - COMPLIANCE AUDIT DOCUMENT', { align: 'center' }).fillColor('black');
        doc.moveDown();
      }

      // Summary
      doc.fontSize(14).text('Executive Summary', { underline: true });
      doc.fontSize(11).text(`Total Applications: ${applicants.length}`);
      doc.moveDown();

      // Table Header (only for standard report or top of audit)
      if (!isAudit) {
        this.drawResultsTable(doc, applicants);
      } else {
        this.drawAuditContent(doc, applicants);
      }

      doc.end();
    });
  }

  private drawResultsTable(doc: PDFKit.PDFDocument, applicants: any[]) {
    const tableTop = doc.y;
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text('Rank', 50, tableTop);
    doc.text('Name', 100, tableTop);
    doc.text('Score', 300, tableTop);
    doc.text('Status', 400, tableTop);

    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
    doc.moveDown();

    // Rows
    doc.font('Helvetica');
    applicants.forEach((a, i) => {
      const y = doc.y;
      if (y > 700) doc.addPage();

      doc.fontSize(11);
      doc.text(`${i + 1}`, 50, doc.y);
      doc.text(a.name, 100, doc.y);
      doc.text(`${a.score.toFixed(1)}%`, 300, doc.y);
      doc.text(a.selected ? 'SELECTED' : 'Waitlist', 400, doc.y);
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('grey').text(a.summary, 100, doc.y, { width: 400 });
      doc.fillColor('black');
      doc.moveDown();
    });
  }

  private drawAuditContent(doc: PDFKit.PDFDocument, applicants: any[]) {
    applicants.forEach((a, i) => {
      if (doc.y > 650) doc.addPage();

      doc.fontSize(14).font('Helvetica-Bold').text(`${i + 1}. ${a.name} (Score: ${a.score.toFixed(1)}%)`);
      doc.fontSize(10).font('Helvetica-Oblique').text(`Status: ${a.selected ? 'SELECTED' : 'NOT SELECTED'}`);
      doc.moveDown(0.5);

      doc.fontSize(11).font('Helvetica-Bold').text('Scoring Breakdown:');
      doc.font('Helvetica');

      if (a.scoringDetails && a.scoringDetails.length > 0) {
        a.scoringDetails.forEach((d: any) => {
          doc.fontSize(10).text(`• ${d.name}: ${d.marksAwarded} marks`, { indent: 20 });
          doc.fontSize(9).fillColor('grey').text(`Reasoning: ${d.reason}`, { indent: 40 });
          doc.fillColor('black');
          doc.moveDown(0.2);
        });
      } else {
        doc.fontSize(10).text('No detailed scoring data available.', { indent: 20 });
      }

      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();
    });
  }

  private extractName(data: any): string {
    return data.name || data.fullName || data.studentName || 'Unknown Applicant';
  }
}

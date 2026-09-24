import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AiService } from '../server/services/AiService';
import { extractTextFromUpload } from '../src/services/documentService';
import { PrismaClient } from '@prisma/client';

// Mocking external services
vi.mock('../src/services/documentService', () => ({
  extractTextFromUpload: vi.fn(),
}));

const prisma = new PrismaClient();

describe('Upload and Extraction Flow', () => {
  beforeEach(async () => {
    // Clear test data if necessary
  });

  it('should store file metadata and eventually update extracted text', async () => {
    const mockFile = {
      id: 'test-file-id',
      name: 'test.txt',
      rawText: 'This is the extracted content.',
    };

    (extractTextFromUpload as any).mockResolvedValue({ rawText: mockFile.rawText, fileType: 'txt', warnings: [] });

    // Simulate what happens in server.ts
    const record = await prisma.fileRecord.create({
      data: {
        name: mockFile.name,
        mimeType: 'text/plain',
        size: 100,
        userId: 'test-user',
        path: '/tmp/test.txt'
      }
    });

    expect(record.id).toBeDefined();
    expect(record.extractedText).toBeNull();

    // Trigger extraction
    const result = await extractTextFromUpload(record.path!, record.name, record.mimeType);
    await prisma.fileRecord.update({
      where: { id: record.id },
      data: { extractedText: result.rawText }
    });

    const updated = await prisma.fileRecord.findUnique({ where: { id: record.id } });
    expect(updated?.extractedText).toBe(mockFile.rawText);
  });
});

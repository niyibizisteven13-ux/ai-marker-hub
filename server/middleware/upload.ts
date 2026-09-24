import multer from 'multer';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — generous for scans, spreadsheets, and multi-page PDFs

const ALLOWED_TYPES = [
  // Native Claude support
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  // Extracted-to-text types
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        // .xlsx
  'application/vnd.ms-excel',                                                  // .xls
  'text/csv',
  'text/plain',
  'text/markdown',
];

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    fieldSize: 20 * 1024 * 1024 // 20MB limit for text fields
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Supported: images, PDF, Word, Excel, CSV, plain text.`));
    }
  },
});

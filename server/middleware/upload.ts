import multer from 'multer';

const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;
const BATCH_MAX_FILE_SIZE = 35 * 1024 * 1024;

// List of dangerous executable extensions to block for security
const BLOCKED_EXECUTABLE_EXTENSIONS = [
  '.exe', '.dll', '.so', '.dylib', '.bat', '.cmd', '.vbs', '.scr', '.msi'
];

const createUpload = (fileSize: number) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize, fieldSize: 10 * 1024 * 1024, fields: 30, files: 10, parts: 50 },
  fileFilter: (_req, file, cb) => {
    const originalName = file.originalname?.toLowerCase() || '';
    const isExecutable = BLOCKED_EXECUTABLE_EXTENSIONS.some(ext => originalName.endsWith(ext));

    if (isExecutable) {
      cb(new Error(`Executable file types are not allowed for security reasons: ${file.originalname}`));
    } else {
      cb(null, true);
    }
  },
});

// Most interactive uploads are capped at 20 MB to keep per-request memory bounded.
export const upload = createUpload(DEFAULT_MAX_FILE_SIZE);

// Batch grading accepts exactly two large files, so it has a separate higher cap
// and stricter route-level rate limit instead of raising the limit app-wide.
export const batchUpload = createUpload(BATCH_MAX_FILE_SIZE);

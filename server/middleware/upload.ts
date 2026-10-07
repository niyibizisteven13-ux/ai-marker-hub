import multer from 'multer';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — supports large codebases, archives, high-res scans, and datasets

// List of dangerous executable extensions to block for security
const BLOCKED_EXECUTABLE_EXTENSIONS = [
  '.exe', '.dll', '.so', '.dylib', '.bat', '.cmd', '.vbs', '.scr', '.msi'
];

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    fieldSize: 10 * 1024 * 1024,
    fields: 30,
    files: 10,
    parts: 50,
  },
  fileFilter: (req, file, cb) => {
    const originalName = file.originalname?.toLowerCase() || '';
    const isExecutable = BLOCKED_EXECUTABLE_EXTENSIONS.some(ext => originalName.endsWith(ext));

    if (isExecutable) {
      cb(new Error(`Executable file types are not allowed for security reasons: ${file.originalname}`));
    } else {
      cb(null, true);
    }
  },
});

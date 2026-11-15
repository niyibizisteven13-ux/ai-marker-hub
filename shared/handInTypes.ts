/** The kinds of file a student may hand in, shared by the hand-in page (what it offers) and the server (what it accepts). */
export const CODE_EXT = ['py', 'js', 'mjs', 'ts', 'jsx', 'tsx', 'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala', 'dart', 'lua', 'pl', 'sql', 'sh', 'bat', 'ps1', 'r', 'm', 'jl', 'hs', 'vb', 'asm', 'html', 'htm', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'tex', 'ipynb', 'ino', 'v', 'vhd'];
export const SHEET_EXT = ['xlsx', 'xlsm', 'csv', 'tsv'];
export const SLIDE_EXT = ['pptx'];
export const VIDEO_EXT = ['mp4', 'mov', 'm4v'];

/** Folders that are libraries, tools or build output, not the student's work: left out of a folder hand-in. */
export const SKIP_DIRS = /(^|\/)(__MACOSX|node_modules|\.git|\.idea|\.vscode|__pycache__|venv|\.venv|dist|build|target|bin|obj)(\/|$)/i;

/** The `accept` list of the file picker. */
export const HAND_IN_ACCEPT = ['.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md', 'image/*', '.heic', '.heif', 'audio/*', '.m4a', '.mp3', '.wav', '.ogg', '.webm', '.zip',
  ...[...SHEET_EXT, ...SLIDE_EXT, ...VIDEO_EXT, ...CODE_EXT].map((e) => `.${e}`)].join(',');

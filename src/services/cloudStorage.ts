import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORTS_DIR = path.join(__dirname, '..', '..', 'exports');
const SIGNED_URL_TTL_MS = 10 * 60 * 1000;

export async function ensureExportsDirectory() {
  await fs.mkdir(EXPORTS_DIR, { recursive: true });
  return EXPORTS_DIR;
}

function buildSignedExportUrl(objectKey: string) {
  const baseUrl = `/exports/${encodeURIComponent(objectKey)}`;
  const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
  const query = new URLSearchParams({ expires: String(expiresAt) });
  return `${baseUrl}?${query.toString()}`;
}

export async function uploadBufferToCloud(buffer: Buffer, objectKey: string, contentType: string) {
  const exportsPath = await ensureExportsDirectory();
  const targetFile = path.join(exportsPath, objectKey);
  await fs.writeFile(targetFile, buffer);
  return buildSignedExportUrl(objectKey);
}

import type { Tool, ToolServices } from '../types.js';
import { err, formatSize, untrusted } from './helpers.js';

/**
 * Datasets curated in Admin → Datasets & Curations: the assistant can list them, browse their folders, read
 * any file (PDF, Word, PowerPoint, Excel, CSV, JSON, text, scans via OCR) and run the analysis engine on
 * tables, so users get answers from whole folders they could never download and paste into a chat.
 */

const TABULAR = new Set(['csv', 'tsv', 'xlsx', 'xls', 'json']);
const problem = (e: any) => String(e?.message ?? e).slice(0, 240);

export function datasetTools(services: ToolServices): Tool[] {
  const ds = services.datasets;
  if (!ds) return [];

  const listDatasets: Tool = {
    definition: {
      name: 'list_datasets',
      description: 'List the datasets curated by Bwenge admins (reports, surveys, statistics tables, curriculum, research files) with their file types and top-level folders. Call it when the user asks what data is available or names a dataset, before browsing.',
      parameters: { type: 'object', properties: {} },
    },
    async execute(_input, ctx) {
      try {
        const list = await ds.catalog(ctx.userId);
        if (!list.length) return { text: 'No datasets are available yet. Tell the user an admin can add them in Datasets & Curations.' };
        const body = list.map((d) => [
          `- ${d.name} (datasetId ${d.id}): ${d.files} files, ${formatSize(d.totalBytes)}; types ${Object.entries(d.types).map(([t, n]) => `${t} ${n}`).join(', ') || 'none'}`,
          d.description ? `  ${d.description.slice(0, 300)}` : '',
          d.folders.length ? `  Folders: ${d.folders.slice(0, 25).join(', ')}${d.folders.length > 25 ? ', …' : ''}` : '',
        ].filter(Boolean).join('\n')).join('\n');
        return { text: untrusted('DATASETS', body) };
      } catch (e) {
        return err(`Could not list datasets: ${problem(e)}`);
      }
    },
  };

  const browseDataset: Tool = {
    definition: {
      name: 'browse_dataset',
      description: 'Open a dataset folder like a file explorer: sub-folders (with file counts) and files (fileId, type, size). Use path "" for the top level and a folder path such as "2024/Districts" to go deeper, or search to find files by name anywhere in the dataset.',
      parameters: {
        type: 'object', required: ['datasetId'],
        properties: {
          datasetId: { type: 'string' },
          path: { type: 'string', description: 'Folder path inside the dataset; "" for the top level.' },
          search: { type: 'string', description: 'Words that must all appear in the file path, e.g. "census 2022".' },
        },
      },
    },
    async execute(input, ctx) {
      try {
        const r = await ds.browse(ctx.userId, String(input.datasetId), { path: input.path ? String(input.path) : '', search: input.search ? String(input.search) : undefined });
        const where = r.search ? `files matching "${r.search}"` : `folder "${r.path || '/'}"`;
        const folders = r.folders.map((f) => `📁 ${f.path}/ (${f.files} files)`);
        const files = r.files.map((f) => `📄 ${f.path} · ${f.type.toUpperCase()} · ${formatSize(f.sizeBytes)} · fileId ${f.id}${f.status !== 'indexed' ? ` · ${f.status}` : ''}`);
        const more = r.totalFiles > r.files.length ? `\n… ${r.totalFiles - r.files.length} more files; narrow with search or a sub-folder.` : '';
        return { text: untrusted(`DATASET ${r.repository.name}: ${where}`, [...folders, ...files].join('\n') || '(empty)') + more };
      } catch (e) {
        return err(`Could not open the dataset: ${problem(e)}`);
      }
    },
  };

  const readDatasetFile: Tool = {
    definition: {
      name: 'read_dataset_file',
      description: 'Read one dataset file by fileId: text page by page (PDF, Word, PowerPoint, HTML, text, scanned pages through OCR) or, for spreadsheets and CSV, the sheets with column names and rows. Use it to answer from a specific file and to learn a table\'s columns before calling analyze_data. Long files are cut off; ask for a sheet or rowOffset to see more.',
      parameters: {
        type: 'object', required: ['fileId'],
        properties: {
          fileId: { type: 'string' },
          maxChars: { type: 'integer', minimum: 2000, maximum: 120000, default: 40000 },
          sheet: { type: 'string', description: 'Only this sheet of a workbook.' },
          rowOffset: { type: 'integer', minimum: 0, description: 'First data row to show (0-based).' },
        },
      },
    },
    async execute(input, ctx) {
      try {
        const r = await ds.read(ctx.userId, String(input.fileId), { maxChars: input.maxChars, sheet: input.sheet ? String(input.sheet) : undefined, rowOffset: input.rowOffset });
        const f = r.file;
        if (!r.supported && !r.text) return err(`${f.path} cannot be read as text (${r.warnings.join(' ') || 'unsupported format'}).`);
        const head = [
          `File: ${f.path} in dataset ${f.repository} (${f.type.toUpperCase()}, ${formatSize(f.sizeBytes)}${r.pages ? `, ${r.pages} pages` : ''}).`,
          r.sheets.length ? `Sheets: ${r.sheets.map((s) => `"${s.name}" (${s.totalRows} rows; columns: ${s.columns.join(', ')})`).join('; ')}.` : '',
          TABULAR.has(f.type) || r.sheets.length ? `For any statistic over the whole table, call analyze_data with source {"type":"repository_file","id":"${f.id}"}; do not compute figures from the rows shown here.` : '',
          r.truncated ? 'The content below is cut off.' : '',
          r.warnings.length ? `Notes: ${r.warnings.slice(0, 4).join(' ')}` : '',
          `Cite it as: ${f.path} (${f.repository}).`,
        ].filter(Boolean).join('\n');
        return { text: `${head}\n\n${untrusted(`FILE ${f.path}`, r.text || '(no text found)')}` };
      } catch (e) {
        return err(`Could not read the file: ${problem(e)}`);
      }
    },
  };

  return [listDatasets, browseDataset, readDatasetFile];
}

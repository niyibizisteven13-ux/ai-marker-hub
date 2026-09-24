import { getSandbox } from './sandboxManager.js';
import fs from 'fs/promises';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import logger from '../utils/logger.js';

const PROJECT_ROOT = '/home/user/project'; // Default working directory in E2B
const LOCAL_ROOT = process.cwd();

function sandboxPath(relPath: string) {
  if (relPath.includes('..')) throw new Error('Invalid path: path escapes project root');
  return `${PROJECT_ROOT}/${relPath}`.replace(/\/+/g, '/');
}

export async function executeAgentTool(projectId: string, name: string, input: any): Promise<string> {
  const sandbox = await getSandbox(projectId);

  switch (name) {
    case 'write_file': {
      const p = sandboxPath(input.path);
      await sandbox.files.write(p, input.content);
      return `Wrote ${input.content.length} bytes to ${input.path}`;
    }
    case 'read_file': {
      const p = sandboxPath(input.path);
      return await sandbox.files.read(p);
    }
    case 'edit_file': {
      const p = sandboxPath(input.path);
      const content = await sandbox.files.read(p);
      if (!content.includes(input.old_str)) return `ERROR: old_str not found in ${input.path}`;
      await sandbox.files.write(p, content.replace(input.old_str, input.new_str));
      return `Edited ${input.path}`;
    }
    case 'list_files': {
      const p = sandboxPath(input.path || '.');
      const entries = await sandbox.files.list(p);
      return entries.map(e => e.isDir ? `${e.name}/` : e.name).join('\n');
    }
    case 'run_command': {
      const result = await sandbox.commands.run(input.command, {
        cwd: PROJECT_ROOT,
        timeoutMs: 60000,
      });
      return `stdout:\n${result.stdout}\nstderr:\n${result.stderr}${result.exitCode !== 0 ? `\nexit code: ${result.exitCode}` : ''}`;
    }
    case 'web_search': {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) return "ERROR: TAVILY_API_KEY not configured.";
      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            query: input.query,
            search_depth: input.search_depth || 'basic',
            include_answer: true,
            max_results: 5
          })
        });
        const data = await response.json();
        if (data.answer) return `ANSWER: ${data.answer}\n\nSOURCES:\n${data.results.map((r: any) => `- ${r.title}: ${r.url}`).join('\n')}`;
        return data.results.map((r: any) => `[${r.title}](${r.url}): ${r.content}`).join('\n\n');
      } catch (e: any) {
        return `Search Error: ${e.message}`;
      }
    }
    case 'read_document': {
      const fullPath = path.join(LOCAL_ROOT, input.path);
      try {
        const buffer = await fs.readFile(fullPath);
        const ext = path.extname(input.path).toLowerCase();

        if (ext === '.pdf') {
          const pdfParser = new PDFParse({ data: buffer as Uint8Array });
          const data = await pdfParser.getText();
          return data.text;
        } else if (ext === '.docx') {
          const result = await mammoth.extractRawText({ buffer });
          return result.value;
        } else if (ext === '.xlsx' || ext === '.xls') {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer);
          let output = '';
          workbook.eachSheet((sheet) => {
            output += `Sheet: ${sheet.name}\n`;
            sheet.eachRow((row) => {
              output += row.values.join(' | ') + '\n';
            });
            output += '\n';
          });
          return output;
        }
        return `Unsupported document type: ${ext}`;
      } catch (e: any) {
        return `Read Error: ${e.message}`;
      }
    }
    case 'manage_files': {
      const targetPath = path.join(LOCAL_ROOT, input.path || '.');
      if (!targetPath.startsWith(LOCAL_ROOT)) return "ERROR: Path escapes project root.";

      try {
        switch (input.action) {
          case 'list':
            const files = await fs.readdir(targetPath);
            return files.join('\n');
          case 'read':
            return await fs.readFile(targetPath, 'utf-8');
          case 'write':
            await fs.writeFile(targetPath, input.content);
            return `Successfully wrote to ${input.path}`;
          case 'search':
            const { execSync } = await import('child_process');
            const result = execSync(`grep -r "${input.pattern}" ${targetPath}`).toString();
            return result || "No matches found.";
          default:
            return "Invalid action.";
        }
      } catch (e: any) {
        return `File System Error: ${e.message}`;
      }
    }
    case 'visualize_data': {
      if (input.type === 'mermaid') {
        return `MERMAID_DIAGRAM:\n${input.definition}`;
      }
      return `CHART_DATA:\n${input.definition}`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

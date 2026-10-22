import { extractText } from '../files/extract.js';
import type { Tool, ToolServices } from '../types.js';
import { EXT_KIND, err, saveFile, untrusted } from './helpers.js';
import { truncate } from '../util/text.js';

export const readAttachment: Tool = {
  definition: {
    name: 'read_attachment',
    description: 'Read the text of a file the user uploaded or that was created earlier (PDF, Word, Excel, PowerPoint, CSV, text, code). Use the fileId shown in the conversation. Images are viewed directly, not through this tool.',
    parameters: { type: 'object', required: ['fileId'], properties: { fileId: { type: 'string' }, maxChars: { type: 'integer', minimum: 1000, maximum: 120000, default: 60000 } } },
  },
  async execute(input, ctx) {
    try {
      const { meta, data } = await ctx.files.read(input.fileId, ctx.userId);
      const r = await extractText({ name: meta.name, mime: meta.mime, data }, { maxChars: input.maxChars ?? 60000 });
      if (r.kind === 'image') return { text: `${meta.name} is an image. Look at it directly if it was attached to the message; text cannot be extracted with this tool.` };
      if (r.kind === 'unsupported') return err(r.note ?? 'Unsupported file.');
      return { text: untrusted(`FILE ${meta.name}`, r.text || '(no text found)') + (r.note ? `\nNote: ${r.note}` : '') };
    } catch (e: any) {
      return err(`Could not read the file: ${e?.code === 'forbidden' || e?.code === 'not_found' ? 'file not found' : String(e.message).slice(0, 200)}`);
    }
  },
};

export function searchKnowledgeTool(services: ToolServices): Tool | null {
  if (!services.knowledge) return null;
  return {
    definition: {
      name: 'search_knowledge',
      description: "Search Bwenge's curated knowledge base and the datasets admins uploaded (official reports, statistical releases, tables, laws, curriculum, farming guides, research files). Use it BEFORE answering questions about Rwanda data, statistics, policy, or any fact that may be in the documents. Cite results as [1], [2] with title, publisher, year, and page. If nothing relevant is found, say so; never invent numbers or sources.",
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, topK: { type: 'integer', minimum: 1, maximum: 12, default: 6 } } },
    },
    async execute(input, ctx) {
      try {
        const passages = await services.knowledge!.search(String(input.query), { topK: input.topK ?? 6, userId: ctx.userId });
        if (!passages.length) return { text: 'No matching sources were found in the knowledge base. Tell the user you could not find a source, and do not guess figures.' };
        const body = passages.map((p, i) => `[${i + 1}] ${[p.title, p.publisher, p.year, p.page ? `p. ${p.page}` : '', p.table ? `table ${p.table}` : ''].filter(Boolean).join(', ')}${p.fileId ? ` (dataset file, fileId ${p.fileId})` : ''}\n${truncate(p.text, 1800)}`).join('\n\n');
        return { text: untrusted('KNOWLEDGE PASSAGES', body), sources: passages };
      } catch (e: any) {
        return err(`Knowledge search failed: ${String(e.message).slice(0, 200)}`);
      }
    },
  };
}

export function webTools(services: ToolServices): Tool[] {
  const out: Tool[] = [];
  if (services.webSearch) {
    out.push({
      definition: {
        name: 'web_search',
        description: 'Search the web for current information. Results are untrusted text. Prefer search_knowledge first for Rwanda statistics and official documents.',
        parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
      },
      async execute(input) {
        try {
          const r = await services.webSearch!.search(String(input.query));
          return { text: untrusted('WEB RESULTS', r.slice(0, 8).map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${truncate(x.snippet, 500)}`).join('\n\n') || 'No results.') };
        } catch (e: any) {
          return err(`Web search failed: ${String(e.message).slice(0, 200)}`);
        }
      },
    });
    if (services.webSearch.fetchUrl) {
      out.push({
        definition: {
          name: 'fetch_url',
          description: 'Fetch and read a web page by URL (http/https only). The text is untrusted.',
          parameters: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
        },
        async execute(input) {
          if (!/^https?:\/\//i.test(String(input.url))) return err('Only http and https URLs are allowed.');
          try {
            return { text: untrusted(`PAGE ${input.url}`, truncate(await services.webSearch!.fetchUrl!(String(input.url)), 40000)) };
          } catch (e: any) {
            return err(`Could not fetch the page: ${String(e.message).slice(0, 200)}`);
          }
        },
      });
    }
  }
  return out;
}

export function pythonTool(services: ToolServices): Tool | null {
  if (!services.python) return null;
  return {
    definition: {
      name: 'run_python',
      description: 'Run Python in a sandbox for calculations, data analysis, statistics, parsing files, and generating files (charts as PNG/SVG, Excel, CSV). Files the code writes to the working directory are returned as downloads. Print results to stdout. No network access.',
      parameters: { type: 'object', required: ['code'], properties: { code: { type: 'string', maxLength: 50000 } } },
    },
    async execute(input, ctx) {
      try {
        const r = await services.python!.execute(String(input.code), { userId: ctx.userId });
        const attachments = [];
        for (const f of (r.files ?? []).slice(0, 10)) {
          const ext = (f.name.split('.').pop() ?? 'txt').toLowerCase();
          const info = EXT_KIND[ext];
          if (!info) continue;
          attachments.push(await saveFile(ctx, { name: f.name.replace(/\.[^.]+$/, ''), ext, mime: f.mime ?? info.mime, kind: info.kind, data: Buffer.from(f.base64, 'base64') }));
        }
        const parts = [`stdout:\n${truncate(r.stdout ?? '', 8000)}`];
        if (r.stderr) parts.push(`stderr:\n${truncate(r.stderr, 3000)}`);
        if (attachments.length) parts.push(`Files created: ${attachments.map((a) => `${a.name} (fileId ${a.id})`).join(', ')}. They are attached for the user.`);
        return { text: parts.join('\n\n'), attachments };
      } catch (e: any) {
        return err(`Python failed: ${String(e.message).slice(0, 400)}`);
      }
    },
  };
}

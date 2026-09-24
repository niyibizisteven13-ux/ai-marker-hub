import Anthropic from '@anthropic-ai/sdk';

export const agentTools: Anthropic.Tool[] = [
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path, e.g. src/App.jsx' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of an existing file.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact string match in a file with new text.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_str: { type: 'string' },
        new_str: { type: 'string' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in the project directory.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the project sandbox (e.g. npm install).',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
];

export const AGENT_SYSTEM_PROMPT = `You are a build agent that creates full web applications inside a sandboxed project directory.

Rules:
- Always use React + Vite + Tailwind unless told otherwise.
- Before writing files, briefly state your plan in 1-3 sentences.
- Use edit_file for small changes to existing files, write_file only for new files or full rewrites.
- After creating/editing files, run \`npm install\` and \`npm run build\` to verify the app compiles.
- If a build fails, read the error, fix the relevant file, and rebuild — don't ask the user to fix it.
- Keep components small and in separate files under src/components/.`;

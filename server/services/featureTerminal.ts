import { Sandbox, CommandExitError } from 'e2b';
import type { ProjectFiles } from './featureBuilder.js';

const workdir = '/home/user/bwenge-app';
const ttl = 12 * 60_000;
const sessions = new Map<string, { sandbox: Sandbox; revision: number; expiresAt: number; key: string }>();
const running = new Set<string>();

export class TerminalConflict extends Error {}

export function terminalConfigured() {
  return Boolean(process.env.E2B_API_KEY && process.env.BWENGE_TERMINAL_TEMPLATE);
}

async function openTerminal(revision: number, files: ProjectFiles) {
  const template = process.env.BWENGE_TERMINAL_TEMPLATE;
  if (!template) throw new Error('Terminal template is unavailable.');
  const sandbox = await Sandbox.create(template, {
    apiKey: process.env.E2B_API_KEY,
    timeoutMs: ttl,
    network: {
      allowPublicTraffic: false,
      allowOut: ['registry.npmjs.org'],
      denyOut: ['0.0.0.0/0', '::/0'],
    },
  });
  try {
    await sandbox.commands.run(`mkdir -p ${workdir}/src`, { timeoutMs: 5_000 });
    await sandbox.files.write([
      { path: `${workdir}/src/App.jsx`, data: files['App.jsx'] },
      { path: `${workdir}/src/styles.css`, data: files['styles.css'] },
      { path: `${workdir}/package.json`, data: JSON.stringify({
        name: 'bwenge-app', private: true, type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '19.1.1', 'react-dom': '19.1.1' },
        devDependencies: { vite: '6.4.5' },
      }, null, 2) },
      { path: `${workdir}/vite.config.js`, data: "export default { esbuild: { jsx: 'automatic' } };\n" },
      { path: `${workdir}/index.html`, data: '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bwenge app</title><div id="root"></div><script type="module" src="/src/main.jsx"></script></html>' },
      { path: `${workdir}/src/main.jsx`, data: "import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './styles.css';\ncreateRoot(document.getElementById('root')).render(<App />);\n" },
    ]);
    return { sandbox, revision, expiresAt: Date.now() + ttl - 30_000 };
  } catch (error) {
    await sandbox.kill().catch(() => undefined);
    throw error;
  }
}

function collectOutput() {
  let output = '';
  return {
    append(chunk: string) { output = (output + chunk).slice(-24_000); },
    value() { return output; },
  };
}

export async function executeFeatureCommand(
  userId: string, key: string, revision: number, files: ProjectFiles, input: { command: string } | { reset: true },
) {
  if (!terminalConfigured()) throw new Error('Terminal environment is unavailable.');
  if (running.has(userId)) throw new TerminalConflict('Another terminal command is running.');
  running.add(userId);
  try {
    for (const [id, session] of sessions) {
      if (Date.now() >= session.expiresAt) sessions.delete(id);
    }
    const prior = sessions.get(userId);
    if ('reset' in input) {
      sessions.delete(userId);
      await prior?.sandbox.kill().catch(() => undefined);
      return { output: 'Terminal reset. The next command opens a workspace from the saved revision.', exitCode: 0 };
    }

    if (prior && (prior.revision !== revision || prior.key !== key)) {
      throw new TerminalConflict('Reset the terminal to open the newly selected project or revision.');
    }
    const session = prior ?? { ...await openTerminal(revision, files), key };
    sessions.set(userId, session);
    const output = collectOutput();
    try {
      const result = await session.sandbox.commands.run(input.command, {
        cwd: workdir,
        timeoutMs: 60_000,
        onStdout: output.append,
        onStderr: output.append,
      });
      return { output: output.value(), exitCode: result.exitCode };
    } catch (error) {
      if (error instanceof CommandExitError) return { output: output.value(), exitCode: error.exitCode };
      throw error;
    }
  } finally { running.delete(userId); }
}

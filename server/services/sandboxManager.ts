import { Sandbox } from 'e2b';

const activeSandboxes = new Map<string, Sandbox>();

export async function getSandbox(projectId: string): Promise<Sandbox> {
  let sandbox = activeSandboxes.get(projectId);
  if (!sandbox) {
    sandbox = await Sandbox.create({ apiKey: process.env.E2B_API_KEY });
    activeSandboxes.set(projectId, sandbox);
  }
  return sandbox;
}

export async function killSandbox(projectId: string) {
  const sandbox = activeSandboxes.get(projectId);
  if (sandbox) {
    await sandbox.kill();
    activeSandboxes.delete(projectId);
  }
}

export async function initSandboxProject(projectId: string) {
  const sandbox = await getSandbox(projectId);
  // Using a single command to bootstrap the project
  await sandbox.commands.run(
    `mkdir -p project && cd project && npm create vite@latest . -- --template react && npm install -D tailwindcss postcss autoprefixer && npx tailwindcss init -p`,
    { timeoutMs: 180000 }
  );
}

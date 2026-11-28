import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { ToolRegistry } from './ai/tools/registry.js';

export const starterNames = ['business', 'profile', 'research', 'custom'] as const;
export type Starter = typeof starterNames[number];
export type ProjectFiles = { 'App.jsx': string; 'styles.css': string };

const labels: Record<Starter, string> = {
  business: 'Customer app', profile: 'Portfolio', research: 'Research library', custom: 'New app',
};

export function starterFiles(kind: Starter): ProjectFiles {
  return {
    'App.jsx': `export default function App() {
  return <main><h1>${labels[kind]}</h1><p>Your project is ready to edit.</p></main>;
}`,
    'styles.css': 'body { margin: 0; font: 16px system-ui, sans-serif; color: #172033; background: #f7f7fb; } main { max-width: 48rem; margin: auto; padding: 3rem 1.25rem; }',
  };
}

export function featureBuilderTools(files: ProjectFiles) {
  const path = { type: 'string', enum: ['App.jsx', 'styles.css'] };
  return new ToolRegistry([
    {
      definition: { name: 'read_project_file', description: 'Read App.jsx or styles.css from this project.',
        parameters: { type: 'object', properties: { path }, required: ['path'], additionalProperties: false } },
      execute: async (input: { path: keyof ProjectFiles }) => ({ text: files[input.path] }),
    },
    {
      definition: { name: 'write_project_file', description: 'Replace App.jsx or styles.css with complete source code.',
        parameters: { type: 'object', properties: { path, content: { type: 'string', maxLength: 24_000 } },
          required: ['path', 'content'], additionalProperties: false } },
      execute: async (input: { path: keyof ProjectFiles; content: string }) => {
        files[input.path] = input.content;
        return { text: `Updated ${input.path}.` };
      },
    },
    {
      definition: { name: 'check_project_build', description: 'Compile the current draft and return any errors.',
        parameters: { type: 'object', properties: {}, additionalProperties: false } },
      execute: async () => {
        try { await compileFeaturePreview(files); return { text: 'Build passed.' }; }
        catch (error) { return { text: String(error).slice(0, 1600), isError: true }; }
      },
    },
  ]);
}

const requireReactPath = createRequire(import.meta.url).resolve;

const escapeClosingTag = (code: string, tag: string) => code.replace(new RegExp(`</${tag}`, 'gi'), match => '<\\/' + match.slice(2));

export async function compileFeaturePreview(files: ProjectFiles): Promise<string> {
  const result = await build({
    stdin: {
      contents: "import { createRoot } from 'react-dom/client'; import App from 'builder-app'; createRoot(document.getElementById('root')).render(<App />);",
      resolveDir: process.cwd(),
      loader: 'jsx',
    },
    bundle: true,
    jsx: 'automatic',
    platform: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'feature-builder-imports',
      setup(plugin) {
        plugin.onResolve({ filter: /^builder-app$/ }, ({ importer }) =>
          importer === '<stdin>' ? { path: 'App.jsx', namespace: 'builder' } : undefined);
        plugin.onResolve({ filter: /.*/, namespace: 'builder' }, ({ path }) =>
          /^(react|react\/jsx-runtime|react-dom|react-dom\/client)$/.test(path)
            ? { path: requireReactPath(path) }
            : { errors: [{ text: 'Project imports are limited to React. Put styles in styles.css.' }] });
        plugin.onLoad({ filter: /.*/, namespace: 'builder' }, () => ({ contents: files['App.jsx'], loader: 'jsx' }));
      },
    }],
  });
  const js = escapeClosingTag(result.outputFiles[0].text, 'script');
  const css = escapeClosingTag(files['styles.css'], 'style');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'"><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
}


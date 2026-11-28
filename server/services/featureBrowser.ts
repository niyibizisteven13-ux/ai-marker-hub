import { z } from 'zod';
import { browserActionLimit } from '../../shared/featureBrowser.js';
import { browserSandbox, screenshotSizes } from './featureScreenshot.js';

export const browserRequestSchema = z.object({
  viewport: z.enum(['phone', 'desktop']),
  revision: z.number().int().positive().optional(),
  actions: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('click'), x: z.number().min(0).lt(1), y: z.number().min(0).lt(1) }).strict(),
    z.object({ type: z.literal('type'), text: z.string().min(1).max(280) }).strict(),
    z.object({ type: z.literal('scroll'), direction: z.enum(['up', 'down']) }).strict(),
  ])).max(browserActionLimit),
}).strict();

export const featureBrowserDriver = String.raw`
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { StringDecoder } = require('node:string_decoder');
const { width, height, actions } = JSON.parse(fs.readFileSync('/tmp/bwenge-browser-input.json', 'utf8'));
const chromium = spawn('/usr/bin/chromium', [
  '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
  '--user-data-dir=/tmp/bwenge-interactive-profile', '--remote-debugging-pipe', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const pending = new Map();
let seq = 0;
let buffered = '';
const decoder = new StringDecoder('utf8');
const diagnostics = [];
const record = message => {
  if (typeof message === 'string' && diagnostics.length < 8) diagnostics.push(message.slice(0, 300));
};
chromium.stdio[4].on('data', chunk => {
  buffered += decoder.write(chunk);
  const messages = buffered.split('\0');
  buffered = messages.pop() || '';
  for (const raw of messages) {
    const packet = JSON.parse(raw);
    if (packet.id !== undefined) {
      const request = pending.get(packet.id);
      pending.delete(packet.id);
      if (packet.error) request?.reject(new Error(packet.error.message));
      else request?.resolve(packet.result);
    } else if (packet.method === 'Runtime.exceptionThrown') {
      const details = packet.params.exceptionDetails;
      record(details.exception?.description || details.text);
    } else if (packet.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(packet.params.type)) {
      record(packet.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '));
    } else if (packet.method === 'Network.loadingFailed') {
      record('Request failed: ' + packet.params.errorText);
    }
  }
});
const failPending = error => {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
};
chromium.on('error', failPending);
chromium.on('exit', () => failPending(new Error('Chromium exited')));
function rpc(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    chromium.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const { targetId } = await rpc('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await rpc('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => rpc(method, params, sessionId);
  await call('Page.enable');
  await call('Network.enable');
  await call('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'file://*', 'ftp://*'] });
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const { frameTree } = await call('Page.getFrameTree');
  await call('Page.setDocumentContent', { frameId: frameTree.frame.id, html: fs.readFileSync('/tmp/bwenge-browser.html', 'utf8') });
  await wait(250);
  for (const action of actions) {
    if (action.type === 'click') {
      const x = Math.floor(action.x * width);
      const y = Math.floor(action.y * height);
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    } else if (action.type === 'type') {
      await call('Input.insertText', { text: action.text });
    } else {
      await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: height / 2, deltaX: 0, deltaY: action.direction === 'down' ? 420 : -420 });
    }
    await wait(100);
  }
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync('/tmp/bwenge-browser.png', Buffer.from(screenshot.data, 'base64'));
  process.stdout.write(JSON.stringify(diagnostics));
}
run().then(() => chromium.kill(), () => { chromium.kill(); process.exitCode = 1; });
`;

export async function runFeatureBrowser(html: string, input: z.infer<typeof browserRequestSchema>) {
  const sandbox = await browserSandbox();
  try {
    await sandbox.files.write([
      { path: '/tmp/bwenge-browser.html', data: html },
      { path: '/tmp/bwenge-browser.cjs', data: featureBrowserDriver },
      { path: '/tmp/bwenge-browser-input.json', data: JSON.stringify({ ...screenshotSizes[input.viewport], actions: input.actions }) },
    ]);
    const { stdout } = await sandbox.commands.run('node /tmp/bwenge-browser.cjs', { timeoutMs: 16_000 });
    const diagnostics = z.array(z.string().max(300)).max(8).parse(JSON.parse(stdout));
    const png = Buffer.from(await sandbox.files.read('/tmp/bwenge-browser.png', { format: 'bytes' }));
    if (png.length <= 24 || png.length > 3_000_000 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error('The browser did not produce a valid capture.');
    }
    return { png, diagnostics };
  } finally { await sandbox.kill().catch(() => undefined); }
}

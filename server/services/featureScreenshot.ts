import { Sandbox } from 'e2b';

export const screenshotSizes = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;

export function screenshotsConfigured() {
  return Boolean(process.env.E2B_API_KEY && process.env.BWENGE_SCREENSHOT_TEMPLATE);
}

async function browserSandbox() {
  const template = process.env.BWENGE_SCREENSHOT_TEMPLATE;
  if (!template || !screenshotsConfigured()) throw new Error('Screenshot environment is unavailable.');
  return Sandbox.create(template, {
    apiKey: process.env.E2B_API_KEY,
    timeoutMs: 60_000,
    allowInternetAccess: false,
    network: { allowPublicTraffic: false },
  });
}

export async function renderFeatureScreenshot(html: string, viewport: keyof typeof screenshotSizes) {
  const sandbox = await browserSandbox();
  try {
    await sandbox.files.write('/tmp/bwenge-preview.html', html);
    await sandbox.commands.run(chromiumScreenshotCommand(viewport), { timeoutMs: 20_000 });
    const png = Buffer.from(await sandbox.files.read('/tmp/bwenge-preview.png', { format: 'bytes' }));
    if (png.length < 24 || png.length > 5_000_000 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error('The screenshot did not produce a valid PNG.');
    }
    return png;
  } finally { await sandbox.kill().catch(() => undefined); }
}


export function chromiumScreenshotCommand(viewport: keyof typeof screenshotSizes) {
  const { width, height } = screenshotSizes[viewport];
  return [
    '/usr/bin/chromium', '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-background-networking', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--virtual-time-budget=3000', `--window-size=${width},${height}`,
    '--user-data-dir=/tmp/bwenge-chrome', '--screenshot=/tmp/bwenge-preview.png', 'file:///tmp/bwenge-preview.html',
  ].join(' ');
}

export function browserCheckDocument(html: string) {
  return html.replace('</head>', () => `<script>
    let errors = 0;
    window.addEventListener('error', () => errors++);
    window.addEventListener('unhandledrejection', () => errors++);
    setTimeout(() => {
      const root = document.getElementById('root');
      const empty = !root?.firstChild;
      const overflow = document.documentElement.scrollWidth > innerWidth + 1;
      const unnamed = Array.from(root?.querySelectorAll('button, a[href]') ?? [])
        .filter(el => !el.textContent.trim() && !el.getAttribute('aria-label')?.trim() &&
          !el.getAttribute('aria-labelledby') && !el.getAttribute('title') && !el.querySelector('img[alt]:not([alt=""])')).length;
      const marker = document.createElement('meta');
      marker.name = 'bwenge-browser-check';
      marker.content = [Number(empty), Number(overflow), errors, unnamed].join(',');
      document.head.append(marker);
    }, 1200);
  </script></head>`);
}

export function readBrowserCheck(stdout: string) {
  const match = stdout.match(/<meta name="bwenge-browser-check" content="([01]),([01]),(\d+),(\d+)">/);
  if (!match) throw new Error('Browser checks did not finish.');
  return {
    rendered: match[1] === '0',
    horizontalOverflow: match[2] === '1',
    runtimeErrors: Number(match[3]),
    controlsWithoutNames: Number(match[4]),
  };
}

export async function checkFeatureBrowser(html: string, viewport: keyof typeof screenshotSizes) {
  const sandbox = await browserSandbox();
  try {
    await sandbox.files.write('/tmp/bwenge-preview.html', browserCheckDocument(html));
    const command = chromiumScreenshotCommand(viewport)
      .replace('--screenshot=/tmp/bwenge-preview.png', '--dump-dom');
    const { stdout } = await sandbox.commands.run(command, { timeoutMs: 15_000 });
    return readBrowserCheck(stdout);
  } finally { await sandbox.kill().catch(() => undefined); }
}

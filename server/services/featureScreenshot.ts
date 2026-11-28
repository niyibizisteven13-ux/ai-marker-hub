import { Sandbox } from 'e2b';

export const screenshotSizes = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;

export function screenshotsConfigured() {
  return Boolean(process.env.E2B_API_KEY && process.env.BWENGE_SCREENSHOT_TEMPLATE);
}

export async function renderFeatureScreenshot(html: string, viewport: keyof typeof screenshotSizes) {
  const template = process.env.BWENGE_SCREENSHOT_TEMPLATE;
  if (!template || !screenshotsConfigured()) throw new Error('Screenshot environment is unavailable.');
  const sandbox = await Sandbox.create(template, {
    apiKey: process.env.E2B_API_KEY,
    timeoutMs: 60_000,
    allowInternetAccess: false,
    network: { allowPublicTraffic: false },
  });
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

import { prisma } from '../db.js';
import { checkFeatureBrowser, screenshotsConfigured } from './featureScreenshot.js';
import { publicReleasePrefix, publicReleaseSchema } from './featurePublicRelease.js';

let cursor: string | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

async function sweep() {
  if (running) return;
  running = true;
  try {
    const releases = await prisma.appSetting.findMany({
      where: { key: { startsWith: publicReleasePrefix, ...(cursor ? { gt: cursor } : {}) } },
      orderBy: { key: 'asc' },
      take: 5,
    });
    for (const row of releases) {
      const release = publicReleaseSchema.safeParse(row.value);
      if (!release.success) continue;
      const checkedAt = new Date().toISOString();
      const checks = await checkFeatureBrowser(release.data.html, 'phone').catch(() => null);
      await prisma.appSetting.updateMany({
        where: { key: row.key, value: { equals: release.data } },
        data: { value: { ...release.data, monitor: { checkedAt, checks } } },
      });
    }
    cursor = releases.length === 5 ? releases[4].key : undefined;
  } finally { running = false; }
}

export function startFeatureReleaseMonitor() {
  if (timer || process.env.BWENGE_RELEASE_MONITOR !== 'true' || !screenshotsConfigured()) return;
  const tick = () => void sweep().catch(() => undefined);
  timer = setInterval(tick, 15 * 60_000);
  timer.unref();
}

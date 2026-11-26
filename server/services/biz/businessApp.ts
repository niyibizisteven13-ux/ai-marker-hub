import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function findBusinessApk(slug: string): Promise<string | null> {
  const directory = process.env.BWENGE_BIZ_APK_DIR || resolve('.bwenge-business-apks');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return null;
  const filename = resolve(directory, slug + '.apk');
  const file = await stat(filename).catch(() => null);
  return file?.isFile() && file.size > 0 ? filename : null;
}

const ANDROID_WORKFLOW = 'https://api.github.com/repos/niyibizisteven13-ux/ai-marker-hub/actions/workflows/biz-android-apk.yml';

export async function requestBusinessApk(slug: string): Promise<'requested' | 'unconfigured' | 'failed'> {
  const token = process.env.BWENGE_BIZ_APK_WORKFLOW_TOKEN;
  if (!token) return 'unconfigured';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return 'failed';
  const response = await fetch(ANDROID_WORKFLOW + '/dispatches', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { business_slug: slug } }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  return response?.ok ? 'requested' : 'failed';
}

export async function latestBusinessApkBuild(slug: string): Promise<string | null> {
  const token = process.env.BWENGE_BIZ_APK_WORKFLOW_TOKEN;
  if (!token || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return null;
  try {
    const response = await fetch(ANDROID_WORKFLOW + '/runs?event=workflow_dispatch&branch=main&per_page=50', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { workflow_runs?: Array<{ display_title: string; status: string; conclusion?: string }> };
    const run = data.workflow_runs?.find(entry => entry.display_title === 'Bwenge4Biz APK · ' + slug);
    return run ? run.conclusion || run.status : null;
  } catch { return null; }
}

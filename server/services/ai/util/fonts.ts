import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

/** Resolve Inter TTF files shipped by @expo-google-fonts/inter (OFL licensed). */
export function interFontPath(weight: 'regular' | 'bold' = 'regular'): string {
  return weight === 'bold'
    ? require.resolve('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf')
    : require.resolve('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf');
}

const cache = new Map<string, Promise<Buffer>>();
export function loadInter(weight: 'regular' | 'bold' = 'regular'): Promise<Buffer> {
  const p = interFontPath(weight);
  let hit = cache.get(p);
  if (!hit) {
    hit = readFile(p);
    cache.set(p, hit);
  }
  return hit;
}

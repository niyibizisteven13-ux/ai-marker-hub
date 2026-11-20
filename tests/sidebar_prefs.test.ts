import test from 'node:test';
import assert from 'node:assert/strict';
import { readMode, readPins, saveMode, setPin } from '../src/utils/sidebarPrefs.js';
import { publicPath } from '../src/components/sidebar/AgentsPanel.js';

// The sidebar: MySEB and Ventures are off by default (added in Settings → Connections); a profile's public link is /p/<name>, a business's is /b/<name>.
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
(globalThis as any).window = { dispatchEvent: () => true };

test('MySEB and Ventures are not in the sidebar until the person adds them; the choice is remembered', () => {
  assert.deepEqual(readPins(), { myseb: false, ventures: false }); setPin('myseb', true); assert.deepEqual(readPins(), { myseb: true, ventures: false }); setPin('ventures', true); setPin('myseb', false); assert.deepEqual(readPins(), { myseb: false, ventures: true });
  store.set('bwenge-sidebar-pins', 'not json'); assert.deepEqual(readPins(), { myseb: false, ventures: false }, 'a damaged value never breaks the sidebar');
});
test('the sidebar opens on Chat; Agents is remembered', () => { assert.equal(readMode(), 'chat'); saveMode('agents'); assert.equal(readMode(), 'agents'); store.set('bwenge-sidebar-mode', 'junk'); assert.equal(readMode(), 'chat'); });
test('the public link: bwenge.space/p/<name> for a profile, /b/<name> for everything else', () => { assert.equal(publicPath({ slug: 'aline', category: 'profile' }), '/p/aline'); assert.equal(publicPath({ slug: 'grace', category: 'restaurant' }), '/b/grace'); assert.equal(publicPath({ slug: 'kv', category: 'creator' }), '/b/kv'); });

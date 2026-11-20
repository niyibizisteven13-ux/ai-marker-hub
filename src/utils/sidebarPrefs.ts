import { useEffect, useState } from 'react';

/**
 * Shortcuts a person chose to show in the left sidebar. MySEB and Ventures are not shown there by default (the sidebar stays about chat, learning, tasks,
 * forms, practice and files; Bwenge4biz and Bwenge4profile live under Agents). Settings → Connections turns a shortcut on. Stored on this device.
 */
export type Pin = 'myseb' | 'ventures';
const KEY = 'bwenge-sidebar-pins'; const MODE_KEY = 'bwenge-sidebar-mode'; const EVENT = 'bwenge-sidebar-prefs';
export type Pins = Record<Pin, boolean>;
const none = (): Pins => ({ myseb: false, ventures: false });
export const readPins = (): Pins => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return { myseb: v?.myseb === true, ventures: v?.ventures === true }; } catch { return none(); } };
export const setPin = (pin: Pin, on: boolean) => { try { localStorage.setItem(KEY, JSON.stringify({ ...readPins(), [pin]: on })); } catch { /* private mode: the shortcut just does not stick */ } try { window.dispatchEvent(new Event(EVENT)); } catch { /* no window */ } };
export function usePins(): Pins { const [p, setP] = useState<Pins>(readPins); useEffect(() => { const h = () => setP(readPins()); window.addEventListener(EVENT, h); window.addEventListener('storage', h); return () => { window.removeEventListener(EVENT, h); window.removeEventListener('storage', h); }; }, []); return p; }
export type SidebarMode = 'chat' | 'agents';
export const readMode = (): SidebarMode => { try { return localStorage.getItem(MODE_KEY) === 'agents' ? 'agents' : 'chat'; } catch { return 'chat'; } };
export const saveMode = (m: SidebarMode) => { try { localStorage.setItem(MODE_KEY, m); } catch { /* optional */ } };

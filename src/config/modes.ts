export interface ChatMode {
  id: 'auto' | 'fast' | 'deep';
  labelKey: string;
  descriptionKey: string;
  shortLabel: string;
  routerHint: string;
}

export const CHAT_MODES: ChatMode[] = [
  {
    id: 'auto',
    labelKey: 'modeAuto',
    descriptionKey: 'modeAutoDesc',
    shortLabel: 'Auto',
    routerHint: 'auto-balanced',
  },
  {
    id: 'fast',
    labelKey: 'modeFast',
    descriptionKey: 'modeFastDesc',
    shortLabel: 'Fast',
    routerHint: 'realtime-fast',
  },
  {
    id: 'deep',
    labelKey: 'modeDeep',
    descriptionKey: 'modeDeepDesc',
    shortLabel: 'Deep',
    routerHint: 'reasoning-deep',
  },
];

import { z } from 'zod';
import { BizError } from './service.js';
import { CUSTOMER_LAYOUTS, THEMES, type Business } from './model.js';

export const customerDesignSchema = z.object({
  theme: z.enum(THEMES).optional(),
  customerLayout: z.enum(CUSTOMER_LAYOUTS).optional(),
  tagline: z.string().trim().max(120).optional(),
  about: z.string().trim().max(1500).optional(),
  appName: z.string().trim().min(1).max(40).optional(),
  appIcon: z.enum(['logo', 'cover']).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Choose at least one change.');

export type CustomerDesign = z.infer<typeof customerDesignSchema>;

export function designImage(business: Business, source: 'logo' | 'cover') {
  const id = source === 'logo' ? business.logoId : business.coverId;
  return id && business.media.some(file => file.id === id && file.kind === 'image' && file.visible && !file.scope) ? id : undefined;
}

export function ownerDesignPatch(business: Business, design: CustomerDesign) {
  const { appIcon, ...patch } = design;
  if (!appIcon) return patch;
  const appIconId = designImage(business, appIcon);
  if (!appIconId) throw new BizError('Choose an existing public logo or cover photo for the app icon.');
  return { ...patch, appIconId };
}

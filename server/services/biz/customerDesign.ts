import { z } from 'zod';
import { BizError } from './service.js';
import { applyProfile, applyProfileData, clean, CUSTOMER_LAYOUTS, THEMES, type Business } from './model.js';

export const customerDesignSchema = z.object({
  theme: z.enum(THEMES).optional(),
  customerLayout: z.enum(CUSTOMER_LAYOUTS).optional(),
  tagline: z.string().trim().max(120).optional(),
  about: z.string().trim().max(1500).optional(),
  headline: z.string().trim().max(90).optional(),
  appName: z.string().trim().min(1).max(40).optional(),
  appIcon: z.enum(['logo', 'cover']).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Choose at least one change.');

export type CustomerDesign = z.infer<typeof customerDesignSchema>;

export function designImage(business: Business, source: 'logo' | 'cover') {
  const id = source === 'logo' ? business.logoId : business.coverId;
  return id && business.media.some(file => file.id === id && file.kind === 'image' && file.visible && !file.scope) ? id : undefined;
}

export function ownerDesignPatch(business: Business, design: CustomerDesign) {
  const { appIcon, headline, ...patch } = design;
  if (business.category === 'profile') {
    if (appIcon || patch.appName !== undefined || patch.customerLayout !== undefined) {
      throw new BizError('App branding and customer layout are available for businesses.');
    }
    return { ...patch, ...(headline === undefined ? {} : { profile: { headline } }) };
  }
  if (headline !== undefined) throw new BizError('Use the business tagline for customer pages.');
  if (!appIcon) return patch;
  const appIconId = designImage(business, appIcon);
  if (!appIconId) throw new BizError('Choose an existing public logo or cover photo for the app icon.');
  return { ...patch, appIconId };
}


export function previewCustomerDesign(business: Business, design: CustomerDesign) {
  const draft = structuredClone(business);
  const patch = ownerDesignPatch(draft, design);
  applyProfile(draft, patch);
  if ('profile' in patch && patch.profile) applyProfileData(draft, patch.profile);
  if (patch.appName !== undefined) draft.appName = clean(patch.appName, 40);
  if ('appIconId' in patch) draft.appIconId = patch.appIconId;
  return draft;
}

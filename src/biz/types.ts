export type { Business, PublicBusiness, PublicMedia, Product, Media, Enquiry, DayStats, Hours, Day, Theme, Category } from '../../server/services/biz/model';
export const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'shop', label: 'Shop' }, { id: 'restaurant', label: 'Restaurant or café' }, { id: 'salon', label: 'Salon or barber' }, { id: 'farm', label: 'Farm' },
  { id: 'services', label: 'Services' }, { id: 'school', label: 'School or training' }, { id: 'health', label: 'Health' }, { id: 'transport', label: 'Transport' }, { id: 'craft', label: 'Crafts' }, { id: 'other', label: 'Other' },
];
export const DAYS: Array<{ id: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'; label: string }> = [
  { id: 'mon', label: 'Monday' }, { id: 'tue', label: 'Tuesday' }, { id: 'wed', label: 'Wednesday' }, { id: 'thu', label: 'Thursday' }, { id: 'fri', label: 'Friday' }, { id: 'sat', label: 'Saturday' }, { id: 'sun', label: 'Sunday' },
];
/** The colour a business chooses for its page. `on` is the text colour that stays readable on it. */
export const THEMES: Record<string, { label: string; accent: string; on: string }> = {
  gold: { label: 'Gold', accent: '#E9A23B', on: '#1A1405' }, teal: { label: 'Teal', accent: '#0F9D8F', on: '#FFFFFF' }, green: { label: 'Green', accent: '#1E9E5A', on: '#FFFFFF' },
  blue: { label: 'Blue', accent: '#2F6FED', on: '#FFFFFF' }, rose: { label: 'Rose', accent: '#DB4F8E', on: '#FFFFFF' }, violet: { label: 'Violet', accent: '#7C5CF0', on: '#FFFFFF' }, ink: { label: 'Ink', accent: '#0E1722', on: '#FFFFFF' },
};
export const rwf = (n: number | null | undefined) => (n === null || n === undefined ? 'Ask for price' : `${n.toLocaleString('en-US')} RWF`);
export const pageUrl = (slug: string, origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.bwenge.space') => `${origin}/b/${slug}`;

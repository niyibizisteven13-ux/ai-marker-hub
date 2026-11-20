import type { Kind } from '../../biz/types';

/**
 * What the studio shows for each kind of venture. A shop lives on orders and stock, a salon on bookings, a school on enrolments, a content creator on
 * audience, content and brand deals, and a personal profile (Bwenge4profile) on what the person has done and who has looked. Same data and the same
 * assistant underneath; the menu, its order, the words and the home screen change. `[id, label]` pairs: the id picks the screen, the label is what the menu says.
 */
export type NavId = 'dashboard' | 'chat' | 'profile' | 'sales' | 'expenses' | 'programs' | 'products' | 'customers' | 'reports' | 'messages' | 'public' | 'feed' | 'trackers' | 'agent' | 'secrets' | 'settings';
/** Same rule as the server (`kindOf` in model.ts; a test keeps them equal). */
export const kindOf = (c: string): Kind => (c === 'profile' ? 'profile' : c === 'creator' ? 'creator' : c === 'school' ? 'learn' : c === 'salon' || c === 'health' || c === 'services' || c === 'transport' ? 'book' : 'sell');
export const KIND_NAV: Record<Kind, Array<[NavId, string]>> = {
  sell: [['dashboard', 'Dashboard'], ['chat', 'Ask the agent'], ['sales', 'Sales and orders'], ['expenses', 'Costs and spending'], ['programs', 'Programs'], ['products', 'Products and stock'], ['customers', 'Customers'], ['reports', 'Reports'], ['messages', 'Messages'], ['public', 'Public page'], ['feed', 'Feed'], ['trackers', 'Trackers'], ['agent', 'Business agent'], ['secrets', 'Secrets and payments'], ['settings', 'Settings']],
  book: [['dashboard', 'Dashboard'], ['chat', 'Ask the agent'], ['messages', 'Bookings and requests'], ['sales', 'Income'], ['products', 'Services and prices'], ['customers', 'Clients'], ['expenses', 'Costs and spending'], ['programs', 'Programs'], ['reports', 'Reports'], ['public', 'Public page'], ['feed', 'Feed'], ['trackers', 'Trackers'], ['agent', 'Business agent'], ['secrets', 'Secrets and payments'], ['settings', 'Settings']],
  learn: [['dashboard', 'Dashboard'], ['chat', 'Ask the agent'], ['messages', 'Enquiries'], ['products', 'Courses and fees'], ['customers', 'Students'], ['sales', 'Fees received'], ['expenses', 'Costs and spending'], ['programs', 'Programs'], ['reports', 'Reports'], ['public', 'Public page'], ['feed', 'News feed'], ['trackers', 'Trackers'], ['agent', 'Business agent'], ['secrets', 'Secrets and payments'], ['settings', 'Settings']],
  creator: [['dashboard', 'Audience'], ['chat', 'Ask the agent'], ['feed', 'Content'], ['messages', 'Brand deals'], ['products', 'Rates and packages'], ['sales', 'Earnings'], ['expenses', 'Costs and spending'], ['reports', 'Reports'], ['public', 'Public page'], ['trackers', 'Content plan'], ['agent', 'Business agent'], ['secrets', 'Secrets and payments'], ['settings', 'Settings']],
  profile: [['dashboard', 'Overview'], ['profile', 'My profile'], ['feed', 'Posts and videos'], ['public', 'Public page'], ['messages', 'Messages'], ['chat', 'Ask the agent'], ['settings', 'Settings']],
};
export const KIND_PHONE: Record<Kind, NavId[]> = {
  sell: ['dashboard', 'chat', 'sales', 'products'], book: ['dashboard', 'messages', 'products', 'customers'], learn: ['dashboard', 'messages', 'products', 'customers'],
  creator: ['dashboard', 'feed', 'messages', 'sales'], profile: ['dashboard', 'profile', 'feed', 'public'],
};
/** Words for the page being made (the first screen). */
export const KIND_INTRO: Record<'business' | 'creator' | 'profile', { title: string; text: string; name: string; placeholder: string; button: string }> = {
  business: { title: 'Give your business a page and a notebook', text: 'Customers get one short link to your products, photos, hours and WhatsApp. You get a private dashboard for sales, expenses and stock, and an assistant that writes it all down when you talk to it.', name: 'Business name', placeholder: 'Mama Grace Café', button: 'Create my page' },
  creator: { title: 'Run your content like a business', text: 'One link for your videos, rates and collaborations. You see who watches and taps, which posts do best, the brand requests that come in and what you earn.', name: 'Your name or channel name', placeholder: 'Kigali Vlogs', button: 'Create my creator page' },
  profile: { title: 'Build your profile', text: 'Show what you have done: where you studied, what you built, events you attended, with pictures and videos. You get one link to put in an application letter, an email or a WhatsApp message.', name: 'Your full name', placeholder: 'Aline Uwase', button: 'Create my profile' },
};
/** The business categories offered when someone makes a business (creators and profiles have their own start). */
export const BUSINESS_CATEGORIES = ['shop', 'restaurant', 'salon', 'farm', 'services', 'school', 'health', 'transport', 'craft', 'other'];
export const startKind = (category: string): 'business' | 'creator' | 'profile' => (category === 'profile' ? 'profile' : category === 'creator' ? 'creator' : 'business');

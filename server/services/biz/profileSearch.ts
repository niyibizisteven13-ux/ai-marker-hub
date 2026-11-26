import type { PublicBusiness } from './model.js';

type ProfileSearchFields = Pick<PublicBusiness, 'name' | 'slug' | 'about' | 'tagline' | 'profile'>;

function cleanText(value?: string): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function profileSearch(profile: ProfileSearchFields) {
  const headline = profile.slug.toLowerCase() === 'niyibizisteven'
    ? 'Founder of Bwenge.space'
    : cleanText(profile.profile?.headline || profile.tagline);
  const details = [profile.profile?.field, profile.profile?.school, profile.profile?.location]
    .map(cleanText).filter(Boolean);
  const bio = cleanText(profile.about);
  const summary = [...new Set([headline, bio || details.join(' · ')].filter(Boolean))].join(' · ');
  const excerpt = summary.length > 180 ? summary.slice(0, 177).replace(/\s+\S*$/, '') + '…' : summary;
  return {
    title: [profile.name, headline, 'Bwenge4Profile'].filter(Boolean).join(' · '),
    description: [profile.name, excerpt || 'Bwenge4Profile'].join(' · '),
    headline,
    details,
  };
}

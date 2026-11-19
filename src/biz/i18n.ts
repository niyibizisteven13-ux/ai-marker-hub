import { createContext, useContext } from 'react';
import type { Lang, PublicBusiness, PublicPost } from './types';

/**
 * The public page in Kinyarwanda. English is the base: `tx("English words")` gives the Kinyarwanda for the page's own labels when the visitor picks RW
 * (anything not listed stays English, so a missing word never breaks the page). The business's OWN words (tagline, about, products, sections,
 * posts) come from the translation its owner or agent saved (`translations.rw`). The Kinyarwanda here should be read by a native speaker.
 */
export const RW: Record<string, string> = {
  // sections and tabs
  'Overview': 'Ahabanza', 'Menu': 'Menu', 'Products': 'Ibicuruzwa', 'Services': 'Serivisi', 'Produce': 'Umusaruro', 'Courses': 'Amasomo', 'Collection': 'Ibyo dukora', 'Products and services': 'Ibicuruzwa na serivisi',
  'Updates': 'Amakuru mashya', 'Gallery': 'Amafoto', 'About': 'Ibitwerekeye', 'Contact': 'Twandikire', 'Page sections': 'Ibice by’urupapuro', 'Quick actions': 'Ibyihutirwa',
  // buttons and actions
  'Order': 'Tumiza', 'Order now': 'Tumiza ubu', 'Order produce': 'Tumiza umusaruro', 'Book now': 'Fata igihe ubu', 'Request now': 'Saba ubu', 'Enrol now': 'Iyandikishe ubu', 'Add': 'Ongeramo', 'Choose': 'Hitamo',
  'Book a table': 'Fata ameza', 'Book appointment': 'Fata igihe', 'Ask about delivery': 'Baza ibyo gutwara', 'Request a quote': 'Saba igiciro', 'Ask about enrolment': 'Baza uko wiyandikisha', 'Request a ride': 'Saba kugutwara', 'Custom order': 'Itegeko rihariye',
  'Pay now': 'Ishyura ubu', 'Pay online': 'Ishyura kuri murandasi', 'WhatsApp': 'WhatsApp', 'Call': 'Hamagara', 'Directions': 'Inzira', 'Share': 'Sangiza', 'Message': 'Ubutumwa', 'Copy': 'Kopera', 'Save QR': 'Bika QR', 'Install app': 'Shyiramo porogaramu', 'Open map': 'Fungura ikarita', 'Done': 'Byarangiye', 'Try again': 'Ongera ugerageze', 'Close': 'Funga', 'Next': 'Ibikurikira', 'Previous': 'Ibibanza',
  // status and place
  'Open now': 'Irakinguye', 'Closed now': 'Irafunze', 'Closed': 'Irafunze', 'Find us': 'Aho turi', 'Opening hours': 'Amasaha dukoreramo', 'Out of stock': 'Byashize', 'Ask for price': 'Baza igiciro', 'Pinned': 'Byashyizwe hejuru',
  'Monday': 'Kuwa mbere', 'Tuesday': 'Kuwa kabiri', 'Wednesday': 'Kuwa gatatu', 'Thursday': 'Kuwa kane', 'Friday': 'Kuwa gatanu', 'Saturday': 'Kuwa gatandatu', 'Sunday': 'Ku cyumweru',
  // paying
  'How to pay': 'Uko wishyura', 'MTN MoMo Pay code': 'Kode ya MTN MoMo Pay', 'Check the name on your phone before you pay.': 'Reba izina kuri telefoni yawe mbere yo kwishyura.', 'Scan to open on your phone': 'Sikana ufungure kuri telefoni yawe',
  'Tip: in your browser menu choose “Add to Home screen” to keep': 'Inama: muri menu ya browser hitamo “Add to Home screen” kugira ngo ubike', 'View your order': 'Reba ibyo watumije', 'Your order': 'Ibyo watumije', 'Total': 'Yose hamwe', 'Send order': 'Ohereza itegeko', 'Send order button': 'Ohereza itegeko',
  'Check your phone': 'Reba kuri telefoni yawe', 'The payment was not completed': 'Kwishyura ntibyarangiye', 'Preview: nothing is sent.': 'Igeragezwa: nta kintu cyoherezwa.',
  'Your MTN or Airtel number, 0788 123 456': 'Nimero yawe ya MTN cyangwa Airtel, 0788 123 456', 'Amount in RWF': 'Amafaranga muri RWF', 'Note (delivery place, time…)': 'Icyo wongeraho (aho bijya, igihe…)',
  // forms
  'Send us a message': 'Twandikire ubutumwa', 'Your name': 'Izina ryawe', 'Your phone number or email': 'Nimero ya telefoni cyangwa imeri', 'What would you like to ask or order?': 'Ni iki wifuza kubaza cyangwa gutumiza?', 'Your message': 'Ubutumwa bwawe', 'Send message': 'Ohereza ubutumwa', 'Sending…': 'Birimo koherezwa…',
  'About: anything': 'Ku bijyanye na: ikintu cyose', 'About which product': 'Ku kihe gicuruzwa', 'Message sent. The business will reply to you.': 'Ubutumwa bwoherejwe. Ubucuruzi buzagusubiza.', 'Your mobile money number': 'Nimero yawe ya mobile money', 'Your order summary': 'Incamake y’ibyo watumije',
  'Report this page': 'Menyesha ikibazo kuri uru rupapuro', 'Made with Bwenge4biz': 'Byakozwe na Bwenge4biz', 'Send report': 'Ohereza raporo', 'Reason': 'Impamvu', 'It looks like a scam': 'Bisa n’uburiganya', 'It sells something illegal': 'Igurisha ibitemewe', 'It is offensive': 'Irarogoya', 'It copies someone else': 'Yigana undi', 'Something else': 'Ikindi', 'More detail (optional)': 'Ibisobanuro byinshi (si itegeko)', 'Thank you. Bwenge will look at this page.': 'Murakoze. Bwenge izasuzuma uru rupapuro.',
  // feed
  'Love': 'Kunda', 'Remove love': 'Kuramo urukundo', 'Comments': 'Ibitekerezo', 'Add a comment…': 'Andika igitekerezo…', 'Add a comment': 'Andika igitekerezo', 'Post': 'Ohereza', 'Business': 'Ubucuruzi', 'more': 'byinshi', 'Share this update': 'Sangiza aya makuru', 'Open photo': 'Fungura ifoto', 'Play video': 'Kina video',
  // presets: restaurant, shop, salon, farm, services, school, health, transport, craft
  'Popular this week': 'Ibikunzwe muri iki cyumweru', 'What we sell': 'Ibyo ducuruza', 'Our services and prices': 'Serivisi zacu n’ibiciro', 'Fresh from the farm': 'Bishya biva ku murima', 'What we do': 'Ibyo dukora', 'Programmes and fees': 'Amasomo n’amafaranga', 'Care we offer': 'Ubuvuzi dutanga', 'Rides and deliveries': 'Gutwara abantu n’ibintu', 'Handmade with care': 'Byakozwe n’intoki neza', 'What we offer': 'Ibyo dutanga',
  'Fresh food, made for you': 'Ibiryo bishya, bikorewe wowe', 'Good products, fair prices': 'Ibicuruzwa byiza, ibiciro byiza', 'Look and feel your best': 'Isa neza wumve umerewe neza', 'Straight from the farm to you': 'Biva ku murima bigera kuri wowe', 'Reliable help, clear prices': 'Ubufasha bwizewe, ibiciro bisobanutse', 'Learn skills that open doors': 'Wige ubumenyi bukinguriye inzugi', 'Care you can trust': 'Ubuvuzi wizera', 'Safe, on-time transport': 'Ingendo zizewe kandi ku gihe', 'Made by hand in Rwanda': 'Byakozwe n’intoki mu Rwanda', 'Welcome': 'Murakaza neza',
  'Fresh daily': 'Bishya buri munsi', 'Order ahead': 'Tumiza hakiri kare', 'Pay by mobile money': 'Ishyura ukoresheje mobile money', 'Pick up in store': 'Ubyifatire mu iduka', 'Delivery on request': 'Dutwara iyo ubisabye', 'Appointments': 'Gufata igihe', 'Walk-ins welcome': 'Abaje batabanje gufata igihe barakirwa', 'Fresh harvest': 'Umusaruro mushya', 'Bulk orders': 'Amategeko manini', 'Free quote': 'Igiciro ku buntu', 'Fast reply': 'Igisubizo cyihuse', 'Qualified teachers': 'Abarimu b’inzobere', 'Flexible hours': 'Amasaha ahinduka', 'Friendly staff': 'Abakozi b’inshuti', 'On time': 'Ku gihe', 'Fair prices': 'Ibiciro byiza', 'Handmade': 'Byakozwe n’intoki', 'Custom orders': 'Amategeko yihariye',
};
export const rwDay = (d: string) => RW[d] ?? d;
export type Tx = (s: string) => string;
export const makeTx = (lang: Lang): Tx => (lang === 'rw' ? (s) => RW[s] ?? s : (s) => s);
export const TxContext = createContext<Tx>((s) => s);
export const useTx = () => useContext(TxContext);

/** The public business in the chosen language: the owner's translation replaces tagline, about, product and section texts where it has them. */
export function localize(b: PublicBusiness, lang: Lang): PublicBusiness {
  const t = lang === 'en' ? undefined : b.translations?.[lang]; if (!t) return b;
  return {
    ...b, tagline: t.tagline || b.tagline, about: t.about || b.about,
    products: b.products.map((p) => { const x = t.products?.[p.id]; return x ? { ...p, name: x.name || p.name, description: x.description || p.description, unit: x.unit || p.unit } : p; }),
    sections: b.sections?.map((s) => { const x = t.sections?.[s.id]; return x ? { ...s, title: x.title || s.title, body: x.body || s.body, button: x.button || s.button, items: x.items?.length ? x.items : s.items } : s; }),
  };
}
export const localizePosts = (posts: PublicPost[], b: PublicBusiness, lang: Lang): PublicPost[] => { const t = lang === 'en' ? undefined : b.translations?.[lang]?.posts; return t ? posts.map((p) => (t[p.id] ? { ...p, text: t[p.id] } : p)) : posts; };
export const initialLang = (b: PublicBusiness): Lang => {
  try { const s = localStorage.getItem('bz-lang'); if (s === 'en' || s === 'rw') return s; } catch { /* optional */ }
  if (b.lang) return b.lang; return typeof navigator !== 'undefined' && /^rw|kin/i.test(navigator.language) && b.translations?.rw ? 'rw' : 'en';
};

Object.assign(RW, { 'Sent. The business will contact you.': 'Byoherejwe. Ubucuruzi buzakwandikira.', 'Send': 'Ohereza' });
Object.assign(RW, { 'love': 'urukundo', 'loves': 'urukundo', 'comment': 'igitekerezo', 'View all': 'Reba byose', 'Language': 'Ururimi' });
Object.assign(RW, { 'Ask a question or place an order. Leave your phone number or email so the business can reply.': 'Baza ikibazo cyangwa utumize. Shyiraho nimero ya telefoni cyangwa imeri kugira ngo ubucuruzi bugusubize.' });

/**
 * What a page says and offers depends on the kind of business: a café shows a menu and "Order now", a salon shows services and "Book",
 * a farm shows produce. Only wording and the main buttons change; the data is the same for every kind.
 */
export interface Preset {
  itemsTitle: string; itemsHint: string; add: string; order: string;
  /** A second main button that opens WhatsApp with a ready message (booking, quote, enrolment, ride). Absent for kinds that only order. */
  second?: { label: string; message: (name: string) => string };
  promo: string; highlights: string[];
}
const P = (x: Preset) => x;
export const PRESETS: Record<string, Preset> = {
  restaurant: P({ itemsTitle: 'Menu', itemsHint: 'Popular this week', add: 'Add', order: 'Order now', second: { label: 'Book a table', message: (n) => `Hello ${n}, I would like to book a table. Date and time: ` }, promo: 'Fresh food, made for you', highlights: ['Fresh daily', 'Order ahead', 'Pay by mobile money'] }),
  shop: P({ itemsTitle: 'Products', itemsHint: 'What we sell', add: 'Add', order: 'Order now', promo: 'Good products, fair prices', highlights: ['Pick up in store', 'Delivery on request', 'Pay by mobile money'] }),
  salon: P({ itemsTitle: 'Services', itemsHint: 'Our services and prices', add: 'Choose', order: 'Book now', second: { label: 'Book appointment', message: (n) => `Hello ${n}, I would like to book an appointment. Service, date and time: ` }, promo: 'Look and feel your best', highlights: ['Appointments', 'Walk-ins welcome', 'Pay by mobile money'] }),
  farm: P({ itemsTitle: 'Produce', itemsHint: 'Fresh from the farm', add: 'Add', order: 'Order produce', second: { label: 'Ask about delivery', message: (n) => `Hello ${n}, can you deliver to my area? Location: ` }, promo: 'Straight from the farm to you', highlights: ['Fresh harvest', 'Bulk orders', 'Pay by mobile money'] }),
  services: P({ itemsTitle: 'Services', itemsHint: 'What we do', add: 'Choose', order: 'Request now', second: { label: 'Request a quote', message: (n) => `Hello ${n}, I would like a quote for: ` }, promo: 'Reliable help, clear prices', highlights: ['Free quote', 'Fast reply', 'Pay by mobile money'] }),
  school: P({ itemsTitle: 'Courses', itemsHint: 'Programmes and fees', add: 'Choose', order: 'Enrol now', second: { label: 'Ask about enrolment', message: (n) => `Hello ${n}, I would like to know about enrolment. Course: ` }, promo: 'Learn skills that open doors', highlights: ['Qualified teachers', 'Flexible hours', 'Pay by mobile money'] }),
  health: P({ itemsTitle: 'Services', itemsHint: 'Care we offer', add: 'Choose', order: 'Book now', second: { label: 'Book appointment', message: (n) => `Hello ${n}, I would like to book an appointment. Reason, date and time: ` }, promo: 'Care you can trust', highlights: ['Appointments', 'Friendly staff', 'Pay by mobile money'] }),
  transport: P({ itemsTitle: 'Services', itemsHint: 'Rides and deliveries', add: 'Choose', order: 'Request now', second: { label: 'Request a ride', message: (n) => `Hello ${n}, I need a ride. From, to and time: ` }, promo: 'Safe, on-time transport', highlights: ['On time', 'Fair prices', 'Pay by mobile money'] }),
  craft: P({ itemsTitle: 'Collection', itemsHint: 'Handmade with care', add: 'Add', order: 'Order now', second: { label: 'Custom order', message: (n) => `Hello ${n}, I would like a custom order: ` }, promo: 'Made by hand in Rwanda', highlights: ['Handmade', 'Custom orders', 'Pay by mobile money'] }),
  other: P({ itemsTitle: 'Products and services', itemsHint: 'What we offer', add: 'Add', order: 'Order now', promo: 'Welcome', highlights: ['Fast reply', 'Fair prices', 'Pay by mobile money'] }),
};
export const presetFor = (category: string): Preset => PRESETS[category] ?? PRESETS.other;

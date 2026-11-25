export const restaurantWindows = [
  { item: 'Breakfast', from: '06:00', to: '10:00' },
  { item: 'Lunch', from: '11:00', to: '15:00' },
  { item: 'Dinner', from: '17:00', to: '22:00' },
];

export const restaurantCard = {
  items: restaurantWindows.map(({ item }) => item),
  windows: restaurantWindows,
  checkIn: 'self' as const,
  linkCheckIn: true,
  cardColor: '#ffffff',
  arrivalColor: '#86efac',
};

export function cardPaper(color: string) {
  return `color-mix(in srgb, ${color} 45%, white)`;
}

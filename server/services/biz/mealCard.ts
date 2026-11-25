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
// The server supplies the Kigali calendar date. The golden angle spaces successive
// hues apart while keeping the same paper on every device throughout that date.
export function dailyMealPaper(date: string, tint = '#ffffff') {
  const day = Math.floor(Date.parse(date + 'T00:00:00Z') / 86_400_000);
  const hue = ((day * 137.508) % 360 + 360) % 360;
  return `color-mix(in srgb, hsl(${hue.toFixed(2)} 78% 81%) 90%, ${tint})`;
}

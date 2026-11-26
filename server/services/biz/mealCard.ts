export const MEAL_TICK_WINDOW_MS = 120_000;

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

const mealPalette = [
  '#fed7aa', '#bbf7d0', '#ddd6fe', '#bae6fd', '#fecdd3', '#fde68a', '#99f6e4',
];
export const weekDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export function mealColorKey(day: string, item: string) {
  return day + '-' + item.toLowerCase().trim();
}
export function mealColor(colors: Record<string, string>, day: string, item: string) {
  const index = weekDays.findIndex(d => d === day);
  const meal = item.toLowerCase().trim();
  const offset = meal === 'breakfast' ? 0 : meal === 'lunch' ? 2 : 4;
  return colors[mealColorKey(day, item)] ?? mealPalette[(index + offset + 7) % 7];
}

// Choose the higher-contrast foreground for the owner's exact background color.
export function mealInk(color: string) {
  const linear = (start: number) => {
    const v = parseInt(color.slice(start, start + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5) > 0.179 ? '#000000' : '#ffffff';
}

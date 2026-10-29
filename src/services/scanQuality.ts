/** Fast capture hints, not a handwriting-confidence estimate. */
export function scanQualityWarnings(width: number, height: number, rgba: ArrayLike<number>): string[] {
  const warnings: string[] = [];
  if (Math.min(width, height) < 700) warnings.push('Low-resolution scan. Move closer or use a clearer photo.');
  let sum = 0, squares = 0, count = 0;
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    const grey = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    sum += grey; squares += grey * grey; count++;
  }
  if (count && Math.sqrt(Math.max(0, squares / count - (sum / count) ** 2)) < 6)
    warnings.push('Very little detail is visible. Check for blur, glare, a blank page, or missing writing.');
  return warnings;
}

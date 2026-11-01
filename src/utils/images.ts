/**
 * Shrinks a picture the user chose before it is stored (a form logo, banner or background, an app background), so
 * pages stay fast. Logos keep transparency (PNG); photos become JPEG.
 */
export async function resizeImageFile(file: File, opts: { maxSide: number; type?: 'image/jpeg' | 'image/png'; quality?: number; maxChars?: number }): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif|bmp|svg\+xml)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP picture.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a picture under 20 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('This picture could not be opened.')); i.src = url; });
    const type = opts.type ?? 'image/jpeg';
    const maxChars = opts.maxChars ?? 1_400_000;
    for (const [side, q] of [[opts.maxSide, opts.quality ?? 0.84], [Math.round(opts.maxSide * 0.8), 0.75], [Math.round(opts.maxSide * 0.6), 0.68]] as const) {
      const w0 = img.naturalWidth || 512, h0 = img.naturalHeight || 512;
      const scale = Math.min(1, side / Math.max(w0, h0));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * scale)); c.height = Math.max(1, Math.round(h0 * scale));
      const g = c.getContext('2d')!;
      if (type === 'image/jpeg') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL(type, q);
      if (data.length <= maxChars) return data;
    }
    throw new Error('This picture is too large even after shrinking it. Try a smaller one.');
  } finally { URL.revokeObjectURL(url); }
}

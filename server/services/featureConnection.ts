import { z } from 'zod';

export const featureConnectionSchema = z.object({
  kind: z.enum(['business', 'profile', 'research']),
  id: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,90}$/),
}).strict();

const publicationSchema = z.object({
  title: z.string().max(250),
  authors: z.string().max(500),
  abstract: z.string().max(5_000),
  discipline: z.string().max(100),
  publishedAt: z.string().optional(),
});

export async function readFeatureConnection(userId: string, connection: z.infer<typeof featureConnectionSchema>) {
  if (connection.kind === 'research') {
    const { prisma } = await import('../db.js');
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: [`research-paper:${connection.id}`, `research-published:${connection.id}`] } },
    });
    const owner = z.object({ ownerId: z.string() }).safeParse(rows.find(row => row.key.startsWith('research-paper:'))?.value);
    const published = publicationSchema.safeParse(rows.find(row => row.key.startsWith('research-published:'))?.value);
    return owner.success && owner.data.ownerId === userId && published.success
      ? { kind: 'research', id: connection.id, ...published.data } : null;
  }
  const { bizService } = await import('./biz/runtime.js');
  const service = await bizService();
  const owner = (await service.list(userId)).find(page => page.slug === connection.id &&
    (connection.kind === 'profile' ? page.category === 'profile' : page.category !== 'profile'));
  if (!owner) return null;
  const page = await service.publicBySlug(owner.slug);
  if (!page) return null;
  return {
    kind: connection.kind,
    slug: page.slug,
    name: page.name,
    tagline: page.tagline,
    about: page.about.slice(0, 2_000),
    hours: page.hours,
    products: page.products.slice(0, 15).map(({ name, price, available }) => ({ name, price, available })),
    headline: page.profile?.headline,
    skills: page.profile?.skills.slice(0, 15),
  };
}

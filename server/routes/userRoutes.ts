import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

router.get('/me', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated.' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, avatarUrl: true, settings: true },
    });

    if (!user) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user });
  } catch (err) {
    console.error('Fetch profile error:', err);
    return res.status(500).json({ error: 'Failed to load profile.' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated.' });

    const {
      name,
      email,
      avatarUrl,
      password,
      defaultStrictness,
      autoSummarize,
      preferredLanguage,
      theme,
    } = req.body;

    const normalizedEmail = email ? String(email).toLowerCase().trim() : undefined;
    if (normalizedEmail) {
      const existingEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingEmail && existingEmail.id !== userId) {
        return res.status(400).json({ error: 'Email is already in use.' });
      }
    }

    const userData: any = {};
    if (name) userData.name = name;
    if (normalizedEmail) userData.email = normalizedEmail;
    if (avatarUrl !== undefined) userData.avatarUrl = avatarUrl || null;
    if (password) {
      userData.passwordHash = await bcrypt.hash(password, 10);
    }

    const settingsData: any = {};
    if (defaultStrictness) settingsData.defaultStrictness = defaultStrictness;
    if (typeof autoSummarize === 'boolean') settingsData.autoSummarize = autoSummarize;
    if (preferredLanguage) settingsData.preferredLanguage = preferredLanguage;
    if (theme) settingsData.theme = theme;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...userData,
        settings: {
          upsert: {
            create: {
              defaultStrictness: settingsData.defaultStrictness || 'STANDARD',
              autoSummarize: typeof settingsData.autoSummarize === 'boolean' ? settingsData.autoSummarize : true,
              preferredLanguage: settingsData.preferredLanguage || 'en',
              theme: settingsData.theme || 'dark',
            },
            update: settingsData,
          },
        },
      },
      include: { settings: true },
    });

    return res.json({ user: updatedUser });
  } catch (err) {
    console.error('Update settings error:', err);
    return res.status(500).json({ error: 'Failed to save settings.' });
  }
});

export default router;

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';

const router = Router();

router.get('/me', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated.' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, avatarUrl: true, role: true, settings: true, subscription: true },
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
      longTermMemory,
      agentTone,
      customInstructions,
    } = req.body;

    if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100)) {
      return res.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
    }
    if (email !== undefined && (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (password !== undefined && (typeof password !== 'string' || password.length < 12 || password.length > 128)) {
      return res.status(400).json({ error: 'Password must be between 12 and 128 characters.' });
    }
    if (avatarUrl !== undefined && avatarUrl !== null && (typeof avatarUrl !== 'string' || avatarUrl.length > 2048)) {
      return res.status(400).json({ error: 'Avatar URL must be a valid short URL.' });
    }
    if (defaultStrictness !== undefined && !['LENIENT', 'STANDARD', 'STRICT'].includes(defaultStrictness)) return res.status(400).json({ error: 'Invalid strictness setting.' });
    if (theme !== undefined && !['dark', 'light'].includes(theme)) return res.status(400).json({ error: 'Invalid theme setting.' });
    if (preferredLanguage !== undefined && (typeof preferredLanguage !== 'string' || preferredLanguage.length > 16)) return res.status(400).json({ error: 'Invalid language setting.' });
    if (longTermMemory !== undefined && typeof longTermMemory !== 'boolean') return res.status(400).json({ error: 'Invalid memory setting.' });
    if (agentTone !== undefined && !['PROFESSIONAL', 'ENCOURAGING', 'STRICT', 'ACADEMIC'].includes(agentTone)) return res.status(400).json({ error: 'Invalid agent tone.' });
    if (customInstructions !== undefined && (typeof customInstructions !== 'string' || customInstructions.length > 2000)) return res.status(400).json({ error: 'Custom instructions must be 2,000 characters or fewer.' });

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
      userData.passwordHash = await bcrypt.hash(password, 12);
    }

    const settingsData: any = {};
    if (defaultStrictness) settingsData.defaultStrictness = defaultStrictness;
    if (typeof autoSummarize === 'boolean') settingsData.autoSummarize = autoSummarize;
    if (preferredLanguage) settingsData.preferredLanguage = preferredLanguage;
    if (theme) settingsData.theme = theme;
    if (typeof longTermMemory === 'boolean') settingsData.longTermMemory = longTermMemory;
    if (agentTone) settingsData.agentTone = agentTone;
    if (typeof customInstructions === 'string') settingsData.customInstructions = customInstructions.trim() || null;

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

    const { passwordHash: _passwordHash, ...safeUser } = updatedUser;
    return res.json({ user: safeUser });
  } catch (err) {
    console.error('Update settings error:', err);
    return res.status(500).json({ error: 'Failed to save settings.' });
  }
});

export default router;

import { Router } from 'express';
import { AppearanceError, sanitizeAppearance } from '../services/appearance.js';
import { planFor } from '../services/billing/plans.js';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';

const router = Router();

/** The saved appearance with its background picture (the sign-in response leaves the picture out). */
router.get('/appearance', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated.' });
    const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { appearance: true } as any }).catch(() => null);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json({ appearance: (settings as any)?.appearance ?? null });
  } catch {
    res.status(500).json({ error: 'Could not load your appearance.' });
  }
});

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

router.get('/export', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated.' });
    const [user, workspace, projects, forms, batches, files] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, avatarUrl: true, role: true, createdAt: true, settings: true } }),
      prisma.workspaceState.findUnique({ where: { userId }, select: { data: true, updatedAt: true } }),
      prisma.studioProject.findMany({ where: { userId }, select: { id: true, title: true, examPaper: true, scripts: true, createdAt: true, updatedAt: true } }),
      prisma.applicationForm.findMany({ where: { userId }, select: { id: true, title: true, schema: true, createdAt: true, updatedAt: true } }),
      prisma.batchJob.findMany({ where: { userId }, include: { results: true }, orderBy: { createdAt: 'desc' } }),
      prisma.fileRecord.findMany({ where: { userId }, select: { id: true, name: true, mimeType: true, size: true, createdAt: true } }),
    ]);
    const parseJson = (value: string) => { try { return JSON.parse(value); } catch { return value; } };
    const exportedAt = new Date().toISOString();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bwenge-account-export-${exportedAt.slice(0, 10)}.json"`);
    return res.json({ exportedAt, user, workspace: workspace ? { ...workspace, data: parseJson(workspace.data) } : null, projects: projects.map((project) => ({ ...project, examPaper: parseJson(project.examPaper), scripts: parseJson(project.scripts) })), forms: forms.map((form) => ({ ...form, schema: parseJson(form.schema) })), batches, files });
  } catch (err) {
    console.error('Export account data error:', err);
    return res.status(500).json({ error: 'Could not prepare your account export.' });
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
      currentPassword,
      defaultStrictness,
      autoSummarize,
      preferredLanguage,
      theme,
      longTermMemory,
      agentTone,
      customInstructions,
      appearance,
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
    if (password !== undefined && (typeof currentPassword !== 'string' || !currentPassword)) {
      return res.status(400).json({ error: 'Enter your current password to change it.' });
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

    let appearanceJson: string | null | undefined;
    if (appearance !== undefined) {
      try {
        let incoming: any = appearance;
        if (typeof incoming === 'string') { try { incoming = JSON.parse(incoming); } catch { /* sanitize reports it */ } }
        // A picture background sent without the picture keeps the one already saved (devices that have not
        // downloaded it yet must not erase it).
        if (incoming && typeof incoming === 'object' && incoming.background === 'image' && !incoming.image) {
          const prev = await prisma.userSettings.findUnique({ where: { userId }, select: { appearance: true } as any }).catch(() => null);
          try { const old = JSON.parse((prev as any)?.appearance ?? '{}'); if (old.image) incoming = { ...incoming, image: old.image }; } catch { /* none */ }
        }
        appearanceJson = appearance === null ? null : sanitizeAppearance(incoming);
      }
      catch (e) { return res.status(400).json({ error: e instanceof AppearanceError ? e.message : 'Invalid appearance setting.' }); }
    }

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
      const existingUser = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
      if (!existingUser || !(await bcrypt.compare(currentPassword, existingUser.passwordHash))) {
        return res.status(403).json({ error: 'Your current password is incorrect.' });
      }
      userData.passwordHash = await bcrypt.hash(password, 12);
    }

    const settingsData: any = {};
    if (defaultStrictness) settingsData.defaultStrictness = defaultStrictness;
    if (typeof autoSummarize === 'boolean') settingsData.autoSummarize = autoSummarize;
    if (preferredLanguage) settingsData.preferredLanguage = preferredLanguage;
    if (theme) settingsData.theme = theme;
    if (appearanceJson !== undefined) {
      settingsData.appearance = appearanceJson;
      // The light/dark choice is also kept in theme, for older clients.
      if (appearanceJson && !theme) { const mode = JSON.parse(appearanceJson).mode; if (mode === 'light' || mode === 'dark') settingsData.theme = mode; }
    }
    if (typeof longTermMemory === 'boolean') {
      // Memory across chats is a PRO feature: turning it on needs a plan that includes it.
      const wasOn = Boolean((await prisma.userSettings.findUnique({ where: { userId } }).catch(() => null))?.longTermMemory);
      if (longTermMemory && !wasOn && !(await planFor(userId)).limits.memory) {
        return res.status(402).json({ error: 'Memory across all chats is part of the Pro plans. Upgrade to turn it on.', code: 'UPGRADE_REQUIRED', upgrade: { plan: 'PRO', url: '/upgrade?reason=memory' } });
      }
      settingsData.longTermMemory = longTermMemory;
    }
    if (agentTone) settingsData.agentTone = agentTone;
    if (typeof customInstructions === 'string') settingsData.customInstructions = customInstructions.trim() || null;

    // Profile fields and settings are saved in two plain steps (a nested upsert is not supported everywhere the
    // app runs, and a silently dropped setting looks saved but is lost at the next sign-in).
    if (Object.keys(userData).length) await prisma.user.update({ where: { id: userId }, data: userData });
    if (Object.keys(settingsData).length) {
      await prisma.userSettings.upsert({
        where: { userId },
        create: { userId, defaultStrictness: 'STANDARD', autoSummarize: true, preferredLanguage: 'en', theme: 'dark', ...settingsData },
        update: settingsData,
      });
    }
    const updatedUser = await prisma.user.findUnique({ where: { id: userId }, include: { settings: true } });
    if (!updatedUser) return res.status(404).json({ error: 'Account not found.' });

    const { passwordHash: _passwordHash, ...safeUser } = updatedUser;
    return res.json({ user: safeUser });
  } catch (err) {
    console.error('Update settings error:', err);
    return res.status(500).json({ error: 'Failed to save settings.' });
  }
});

export default router;

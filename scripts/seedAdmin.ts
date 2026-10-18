import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../server/db.js';

async function seed() {
  try {
    await prisma.$connect();
    const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.TEAM_INITIAL_PASSWORD || '';
    if (!email || password.length < 12) {
      throw new Error('Set INITIAL_ADMIN_EMAIL and TEAM_INITIAL_PASSWORD (at least 12 characters) before seeding an admin.');
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error(`An account already exists for ${email}; refusing to overwrite its password or role.`);
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        name: process.env.INITIAL_ADMIN_NAME?.trim() || 'Administrator',
        passwordHash,
        role: 'ADMIN',
        settings: { create: {} },
      },
    });
    console.log('Initial admin account created successfully:', user.email, user.role);
  } catch (err) {
    console.error('Failed to seed master admin:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seed();

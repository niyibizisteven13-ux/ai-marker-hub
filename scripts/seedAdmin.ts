import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../server/db.js';

async function seed() {
  try {
    await prisma.$connect();
    const email = 'niyibizisteven13@gmail.com';
    const passwordHash = await bcrypt.hash('Steven123@45', 12);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      const user = await prisma.user.create({
        data: {
          email,
          name: 'Master Admin',
          passwordHash,
          role: 'ADMIN',
          settings: { create: {} }
        }
      });
      console.log('Master admin account created successfully:', user.email, user.role);
    } else {
      const user = await prisma.user.update({
        where: { email },
        data: { role: 'ADMIN', passwordHash }
      });
      console.log('Master admin account updated successfully:', user.email, user.role);
    }
  } catch (err) {
    console.error('Failed to seed master admin:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seed();

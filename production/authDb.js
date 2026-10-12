import bcrypt from 'bcryptjs';

const salt = bcrypt.genSaltSync(10);
const demoHash = bcrypt.hashSync('Demo#2026', salt);
const adminHash = bcrypt.hashSync('Admin#2026', salt);

export const usersDB = [
  {
    id: 'usr-demo-1',
    name: 'Demo User',
    email: 'demo@example.com',
    passwordHash: demoHash,
  },
  {
    id: 'usr-admin-1',
    name: 'Admin User',
    email: 'admin@bwenge.ai',
    passwordHash: adminHash,
  }
];

export async function createUser(name, email, passwordPlain) {
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(passwordPlain, salt);
  const newUser = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    email: email.toLowerCase(),
    passwordHash,
  };

  usersDB.push(newUser);
  return newUser;
}

export function findUserByEmail(email) {
  if (!email) return null;
  const target = email.toLowerCase().trim();
  return usersDB.find((user) => user.email === target || user.name.toLowerCase() === target);
}

export function findUserById(id) {
  return usersDB.find((user) => user.id === id);
}

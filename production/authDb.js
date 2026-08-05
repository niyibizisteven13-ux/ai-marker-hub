import bcrypt from 'bcryptjs';

export const usersDB = [];

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
  return usersDB.find((user) => user.email === email.toLowerCase());
}

export function findUserById(id) {
  return usersDB.find((user) => user.id === id);
}
